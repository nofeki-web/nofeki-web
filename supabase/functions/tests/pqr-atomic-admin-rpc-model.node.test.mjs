import test from "node:test";
import assert from "node:assert/strict";

class Mutex {
  tail = Promise.resolve();
  async run(fn) {
    let release;
    const prior = this.tail;
    this.tail = new Promise(resolve => { release = resolve; });
    await prior;
    try { return await fn(); } finally { release(); }
  }
}

// In-memory transaction model only. It exercises contract semantics, not PostgreSQL locks/RPC.
class PqrStore {
  constructor(status = "En gestión", version = 3) {
    this.row = { status, version };
    this.events = [];
    this.outbox = [];
    this.requests = new Map();
    this.mutex = new Mutex();
    this.failAt = null;
  }
  async transition({ id, fingerprint, expectedStatus, expectedVersion, target, reason = "" }) {
    return this.mutex.run(async () => {
      const oldRequest = this.requests.get(id);
      if (oldRequest) {
        if (oldRequest.fingerprint !== fingerprint || oldRequest.target !== target) {
          return { ok: false, code: "PT409_KEY_CONFLICT" };
        }
        return { ...oldRequest.result, replay: true };
      }
      if (this.row.status !== expectedStatus || this.row.version !== expectedVersion) {
        return { ok: false, code: "PT409_STALE_VERSION" };
      }
      const allowed = {
        "Recibida": ["En revisión"],
        "En revisión": ["En gestión"],
        "En gestión": ["Respondida"],
        "Respondida": ["Cerrada", "En gestión"],
        "Cerrada": []
      };
      if (target === this.row.status) {
        const result = { ok: true, noop: true, status: this.row.status, version: this.row.version };
        this.requests.set(id, { fingerprint, target, result });
        return result;
      }
      if (!allowed[this.row.status]?.includes(target)) return { ok: false, code: "PT422_TRANSITION" };
      if (this.row.status === "Respondida" && target === "En gestión" && !reason.trim()) {
        return { ok: false, code: "PT422_REASON_REQUIRED" };
      }
      const before = { ...this.row };
      const eventCount = this.events.length;
      const outboxCount = this.outbox.length;
      try {
        this.row.status = target;
        this.row.version += 1;
        if (this.failAt === "after_update") throw new Error("injected_after_update");
        this.events.push({ from: before.status, to: target, reason: reason.trim() || null });
        if (this.failAt === "after_event") throw new Error("injected_after_event");
        const result = { ok: true, noop: false, status: target, version: this.row.version, eventCount: this.events.length };
        this.requests.set(id, { fingerprint, target, result });
        return result;
      } catch (error) {
        this.row = before;
        this.events.length = eventCount;
        this.outbox.length = outboxCount;
        this.requests.delete(id);
        throw error;
      }
    });
  }
}

test("stale concurrent transitions: only one expected version can win", async () => {
  const db = new PqrStore("En gestión", 3);
  const base = { expectedStatus: "En gestión", expectedVersion: 3 };
  const [a, b] = await Promise.all([
    db.transition({ ...base, id: "req-a", fingerprint: "a".repeat(64), target: "Respondida" }),
    db.transition({ ...base, id: "req-b", fingerprint: "b".repeat(64), target: "Respondida" })
  ]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].filter(x => x.code === "PT409_STALE_VERSION").length, 1);
  assert.equal(db.events.length, 1);
});

test("same idempotency key and payload replays persisted result", async () => {
  const db = new PqrStore();
  const args = { id: "req-1", fingerprint: "a".repeat(64), expectedStatus: "En gestión", expectedVersion: 3, target: "Respondida" };
  const first = await db.transition(args);
  const replay = await db.transition(args);
  assert.equal(first.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(db.events.length, 1);
});

test("same idempotency key with different fingerprint conflicts", async () => {
  const db = new PqrStore();
  await db.transition({ id: "req-1", fingerprint: "a".repeat(64), expectedStatus: "En gestión", expectedVersion: 3, target: "Respondida" });
  const result = await db.transition({ id: "req-1", fingerprint: "b".repeat(64), expectedStatus: "En gestión", expectedVersion: 3, target: "Respondida" });
  assert.equal(result.code, "PT409_KEY_CONFLICT");
  assert.equal(db.events.length, 1);
});

test("failure after status update rolls back state, version, and audit", async () => {
  const db = new PqrStore();
  db.failAt = "after_update";
  await assert.rejects(db.transition({ id: "req-1", fingerprint: "a".repeat(64), expectedStatus: "En gestión", expectedVersion: 3, target: "Respondida" }));
  assert.deepEqual(db.row, { status: "En gestión", version: 3 });
  assert.equal(db.events.length, 0);
  assert.equal(db.requests.size, 0);
});

test("failure after audit insert rolls back all database-side effects", async () => {
  const db = new PqrStore();
  db.failAt = "after_event";
  await assert.rejects(db.transition({ id: "req-1", fingerprint: "a".repeat(64), expectedStatus: "En gestión", expectedVersion: 3, target: "Respondida" }));
  assert.deepEqual(db.row, { status: "En gestión", version: 3 });
  assert.equal(db.events.length, 0);
  assert.equal(db.outbox.length, 0);
  assert.equal(db.requests.size, 0);
});

test("Respondida to En gestión requires reason and records it", async () => {
  const db = new PqrStore("Respondida", 4);
  const missing = await db.transition({ id: "req-1", fingerprint: "a".repeat(64), expectedStatus: "Respondida", expectedVersion: 4, target: "En gestión" });
  assert.equal(missing.code, "PT422_REASON_REQUIRED");
  const accepted = await db.transition({ id: "req-2", fingerprint: "b".repeat(64), expectedStatus: "Respondida", expectedVersion: 4, target: "En gestión", reason: "Aporte adicional del solicitante" });
  assert.equal(accepted.ok, true);
  assert.equal(db.events[0].reason, "Aporte adicional del solicitante");
});
