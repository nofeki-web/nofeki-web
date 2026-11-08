import test from "node:test";
import assert from "node:assert/strict";

class ConflictError extends Error {}
class LabStore {
  constructor() { this.submissions = new Map(); this.requests = new Map(); this.events = new Map(); this.outbox = new Map(); this.seq = 0; }
  snapshot() { return structuredClone({ submissions: this.submissions, requests: this.requests, events: this.events, outbox: this.outbox, seq: this.seq }); }
  restore(s) { Object.assign(this, s); }
  transaction(fn) {
    const before = this.snapshot();
    try { return fn(); } catch (error) { this.restore(before); throw error; }
  }
  createSubmission(key, fingerprint, subject, failAt = null) {
    return this.transaction(() => {
      const prior = this.requests.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictError("idempotency_key_reused_with_different_payload");
        return { replayed: true, submission: this.submissions.get(prior.submissionId) };
      }
      const id = `sub-${++this.seq}`;
      const submission = { id, subject, status: "Recibida", version: 1 };
      this.submissions.set(id, submission);
      if (failAt === "after_submission") throw new Error("injected_failure_after_submission");
      this.requests.set(key, { fingerprint, submissionId: id });
      this.events.set(`${id}:submitted`, { submissionId: id, type: "submitted" });
      if (failAt === "after_event") throw new Error("injected_failure_after_event");
      this.outbox.set(`${id}:submitted:v1`, { submissionId: id, type: "submitted" });
      return { replayed: false, submission };
    });
  }
  transition(id, expectedVersion, newStatus, requestId) {
    return this.transaction(() => {
      const eventKey = `${id}:transition:${requestId}`;
      const existing = this.events.get(eventKey);
      if (existing) return { replayed: true, event: existing };
      const row = this.submissions.get(id);
      if (!row) throw new Error("not_found");
      if (row.version !== expectedVersion) throw new ConflictError("stale_version");
      const from = row.status;
      row.status = newStatus; row.version += 1;
      const event = { submissionId: id, type: "status_changed", from, to: newStatus, version: row.version };
      this.events.set(eventKey, event);
      this.outbox.set(`${eventKey}:notify`, { submissionId: id, type: "status_changed" });
      return { replayed: false, event };
    });
  }
}

test("same inbound key and fingerprint returns original submission", () => {
  const db = new LabStore(); const a = db.createSubmission("K1", "H1", "PQR demo"); const b = db.createSubmission("K1", "H1", "PQR demo");
  assert.equal(a.submission.id, b.submission.id); assert.equal(b.replayed, true); assert.equal(db.submissions.size, 1);
});
test("same inbound key with different fingerprint conflicts without mutation", () => {
  const db = new LabStore(); db.createSubmission("K1", "H1", "first");
  assert.throws(() => db.createSubmission("K1", "H2", "second"), ConflictError);
  assert.equal(db.submissions.size, 1); assert.equal(db.outbox.size, 1);
});
test("new submission commits case, request key, history and outbox together", () => {
  const db = new LabStore(); db.createSubmission("K1", "H1", "demo");
  assert.equal(db.submissions.size, 1); assert.equal(db.requests.size, 1); assert.equal(db.events.size, 1); assert.equal(db.outbox.size, 1);
});
test("failure after case insert rolls the complete transaction back", () => {
  const db = new LabStore(); assert.throws(() => db.createSubmission("K1", "H1", "demo", "after_submission"));
  assert.equal(db.submissions.size, 0); assert.equal(db.requests.size, 0); assert.equal(db.events.size, 0); assert.equal(db.outbox.size, 0);
});
test("failure after history insert also rolls the complete transaction back", () => {
  const db = new LabStore(); assert.throws(() => db.createSubmission("K1", "H1", "demo", "after_event"));
  assert.equal(db.submissions.size, 0); assert.equal(db.requests.size, 0); assert.equal(db.events.size, 0); assert.equal(db.outbox.size, 0);
});
test("valid status transition changes version and creates history plus outbox", () => {
  const db = new LabStore(); const { submission } = db.createSubmission("K1", "H1", "demo");
  const result = db.transition(submission.id, 1, "En revisión", "R1");
  assert.equal(result.replayed, false); assert.equal(db.submissions.get(submission.id).version, 2);
  assert.equal(db.events.size, 2); assert.equal(db.outbox.size, 2);
});
test("stale expected version rejects transition without partial writes", () => {
  const db = new LabStore(); const { submission } = db.createSubmission("K1", "H1", "demo");
  assert.throws(() => db.transition(submission.id, 99, "Cerrada", "R2"), ConflictError);
  assert.equal(db.submissions.get(submission.id).status, "Recibida"); assert.equal(db.events.size, 1); assert.equal(db.outbox.size, 1);
});
test("repeated transition request ID is replayed without duplicate event", () => {
  const db = new LabStore(); const { submission } = db.createSubmission("K1", "H1", "demo");
  const a = db.transition(submission.id, 1, "En revisión", "R1"); const b = db.transition(submission.id, 1, "En revisión", "R1");
  assert.equal(a.event, b.event); assert.equal(b.replayed, true); assert.equal(db.events.size, 2); assert.equal(db.outbox.size, 2);
});
