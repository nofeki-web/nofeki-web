import test from 'node:test';
import assert from 'node:assert/strict';

class Mutex {
  #tail = Promise.resolve();
  async run(fn) {
    let release;
    const previous = this.#tail;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

// In-memory adapter used only to test the contract. Its mutex models the
// atomic uniqueness decision; it is NOT PostgreSQL and cannot prove DB races.
class AtomicMemoryStore {
  #mutex = new Mutex();
  #operations = new Map();
  #submissions = new Map([['pqr-1', 'received']]);
  #events = [];
  failNextSentPersist = false;

  async reserve({ key, hash, submissionId = 'pqr-1', type = 'response' }) {
    return this.#mutex.run(async () => {
      const existing = this.#operations.get(key);
      if (existing) {
        if (existing.hash !== hash || existing.submissionId !== submissionId || existing.type !== type) {
          return { decision: 'key_conflict', operationId: existing.id, status: existing.status };
        }
        const decision = existing.status === 'sent' ? 'already_sent'
          : existing.status === 'uncertain' ? 'uncertain'
          : existing.status === 'failed' ? 'failed' : 'in_progress';
        return { decision, operationId: existing.id, status: existing.status };
      }
      const row = { id: `op-${this.#operations.size + 1}`, key, hash, submissionId, type,
        status: 'reserved', attemptCount: 0, providerMessageId: null };
      this.#operations.set(key, row);
      return { decision: 'claimed', operationId: row.id, status: row.status };
    });
  }

  async markSending(key) {
    return this.#mutex.run(async () => {
      const row = this.#operations.get(key);
      if (!row || row.status !== 'reserved') return false;
      row.status = 'sending';
      row.attemptCount += 1;
      return true;
    });
  }

  async finish(key, outcome, providerMessageId = null) {
    return this.#mutex.run(async () => {
      const row = this.#operations.get(key);
      if (!row || row.status !== 'sending') return false;
      if (outcome === 'sent' && this.failNextSentPersist) {
        this.failNextSentPersist = false;
        throw new Error('injected_persistence_failure');
      }
      row.status = outcome;
      row.providerMessageId = providerMessageId;
      return true;
    });
  }

  async forceUncertain(key) { return this.finish(key, 'uncertain'); }
  getOperation(key) { const row = this.#operations.get(key); return row ? structuredClone(row) : null; }

  async changeStatusAndEvent(submissionId, newStatus, { failEvent = false } = {}) {
    return this.#mutex.run(async () => {
      const oldStatus = this.#submissions.get(submissionId);
      if (!oldStatus) throw new Error('submission_not_found');
      const eventCount = this.#events.length;
      try {
        this.#submissions.set(submissionId, newStatus);
        if (failEvent) throw new Error('injected_event_insert_failure');
        this.#events.push({ submissionId, oldStatus, newStatus });
        return { oldStatus, newStatus, eventCount: this.#events.length };
      } catch (error) {
        this.#submissions.set(submissionId, oldStatus);
        this.#events.length = eventCount;
        throw error;
      }
    });
  }
  getSubmissionStatus(id) { return this.#submissions.get(id); }
  get events() { return structuredClone(this.#events); }
}

class FakeResend {
  calls = 0;
  constructor(mode = 'accept') { this.mode = mode; }
  async send() {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.mode === 'reject') {
      const error = new Error('provider_rejected');
      error.definitive = true;
      throw error;
    }
    if (this.mode === 'timeout') {
      const error = new Error('provider_timeout_ambiguous');
      error.definitive = false;
      throw error;
    }
    return { id: `fake-message-${this.calls}` };
  }
}

async function deliver({ store, provider, key, hash, submissionId = 'pqr-1', type = 'response' }) {
  const reservation = await store.reserve({ key, hash, submissionId, type });
  if (reservation.decision !== 'claimed') return reservation;
  const claimed = await store.markSending(key);
  if (!claimed) return { decision: 'in_progress', operationId: reservation.operationId };
  try {
    const result = await provider.send();
    try {
      await store.finish(key, 'sent', result.id);
      return { decision: 'sent', operationId: reservation.operationId };
    } catch {
      // Provider may have accepted the message. Never assume it did not.
      try { await store.forceUncertain(key); } catch { /* leave sending; reconciliation required */ }
      return { decision: 'uncertain', operationId: reservation.operationId };
    }
  } catch (error) {
    const outcome = error.definitive === true ? 'failed' : 'uncertain';
    await store.finish(key, outcome);
    return { decision: outcome, operationId: reservation.operationId };
  }
}

test('50 concurrent calls with same key produce one claim and one provider call', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('accept');
  const results = await Promise.all(Array.from({ length: 50 }, () => deliver({ store, provider, key: 'same-key', hash: 'a'.repeat(64) })));
  assert.equal(results.filter((x) => x.decision === 'sent').length, 1);
  assert.equal(provider.calls, 1);
  assert.equal(store.getOperation('same-key').status, 'sent');
});

test('same key with altered payload is rejected as key_conflict', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('accept');
  await deliver({ store, provider, key: 'key-1', hash: 'a'.repeat(64) });
  const result = await deliver({ store, provider, key: 'key-1', hash: 'b'.repeat(64) });
  assert.equal(result.decision, 'key_conflict');
  assert.equal(provider.calls, 1);
});

test('already sent operation never calls provider a second time', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('accept');
  await deliver({ store, provider, key: 'key-sent', hash: 'c'.repeat(64) });
  const result = await deliver({ store, provider, key: 'key-sent', hash: 'c'.repeat(64) });
  assert.equal(result.decision, 'already_sent');
  assert.equal(provider.calls, 1);
});

test('definitive provider rejection is failed and does not reuse same key', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('reject');
  const result = await deliver({ store, provider, key: 'key-failed', hash: 'd'.repeat(64) });
  assert.equal(result.decision, 'failed');
  assert.equal(store.getOperation('key-failed').status, 'failed');
  assert.equal((await store.reserve({ key: 'key-failed', hash: 'd'.repeat(64) })).decision, 'failed');
  assert.equal(provider.calls, 1);
});

test('ambiguous timeout becomes uncertain and blocks automatic retry', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('timeout');
  const result = await deliver({ store, provider, key: 'key-timeout', hash: 'e'.repeat(64) });
  const retry = await deliver({ store, provider, key: 'key-timeout', hash: 'e'.repeat(64) });
  assert.equal(result.decision, 'uncertain');
  assert.equal(retry.decision, 'uncertain');
  assert.equal(provider.calls, 1);
});

test('provider accepted but persistence failed: uncertain state prevents blind resend', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('accept');
  store.failNextSentPersist = true;
  const result = await deliver({ store, provider, key: 'key-db-fail', hash: 'f'.repeat(64) });
  const retry = await deliver({ store, provider, key: 'key-db-fail', hash: 'f'.repeat(64) });
  assert.equal(result.decision, 'uncertain');
  assert.equal(retry.decision, 'uncertain');
  assert.equal(provider.calls, 1);
});

test('status update and event insert roll back together on event failure', async () => {
  const store = new AtomicMemoryStore();
  await assert.rejects(store.changeStatusAndEvent('pqr-1', 'in_progress', { failEvent: true }), /injected_event_insert_failure/);
  assert.equal(store.getSubmissionStatus('pqr-1'), 'received');
  assert.equal(store.events.length, 0);
});

test('successful status update persists both status and event', async () => {
  const store = new AtomicMemoryStore();
  const result = await store.changeStatusAndEvent('pqr-1', 'in_progress');
  assert.equal(result.oldStatus, 'received');
  assert.equal(store.getSubmissionStatus('pqr-1'), 'in_progress');
  assert.equal(store.events.length, 1);
});

test('separate authorized operation keys are independent', async () => {
  const store = new AtomicMemoryStore();
  const provider = new FakeResend('accept');
  await deliver({ store, provider, key: 'confirm-key', hash: '1'.repeat(64), type: 'initial_confirmation' });
  await deliver({ store, provider, key: 'internal-key', hash: '2'.repeat(64), type: 'internal_notification' });
  assert.equal(provider.calls, 2);
  assert.equal(store.getOperation('confirm-key').status, 'sent');
  assert.equal(store.getOperation('internal-key').status, 'sent');
});
