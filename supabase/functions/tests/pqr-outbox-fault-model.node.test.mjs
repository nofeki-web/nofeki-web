import test from "node:test";
import assert from "node:assert/strict";

class Outbox {
  constructor() {
    this.rows = new Map();
    this.nextToken = 0;
  }
  enqueue(eventKey, payload) {
    if (this.rows.has(eventKey)) return { inserted: false, row: this.rows.get(eventKey) };
    const row = { eventKey, payload, status: "pending", attempts: 0, availableAt: 0, lockToken: null, lockedUntil: 0, deliveredAt: null, lastError: null };
    this.rows.set(eventKey, row);
    return { inserted: true, row };
  }
  claim(now, leaseMs, worker) {
    const row = [...this.rows.values()]
      .filter(r => (r.status === "pending" && r.availableAt <= now) || (r.status === "processing" && r.lockedUntil <= now))
      .sort((a,b) => a.availableAt - b.availableAt)[0];
    if (!row) return null;
    row.status = "processing";
    row.lockToken = `${worker}-${++this.nextToken}`;
    row.lockedUntil = now + leaseMs;
    row.attempts += 1;
    return { eventKey: row.eventKey, lockToken: row.lockToken, payload: row.payload };
  }
  delivered(eventKey, token, now, providerMessageId) {
    const row = this.rows.get(eventKey);
    if (!row || row.status !== "processing" || row.lockToken !== token) return false;
    row.status = "delivered"; row.deliveredAt = now; row.providerMessageId = providerMessageId;
    row.lockToken = null; row.lockedUntil = 0; return true;
  }
  retry(eventKey, token, nextAt, error) {
    const row = this.rows.get(eventKey);
    if (!row || row.status !== "processing" || row.lockToken !== token) return false;
    row.status = "pending"; row.availableAt = nextAt; row.lastError = error;
    row.lockToken = null; row.lockedUntil = 0; return true;
  }
  dead(eventKey, token, error) {
    const row = this.rows.get(eventKey);
    if (!row || row.status !== "processing" || row.lockToken !== token) return false;
    row.status = "dead"; row.lastError = error; row.lockToken = null; row.lockedUntil = 0; return true;
  }
}

test("event_key deduplicates repeated database intents", () => {
  const q = new Outbox();
  assert.equal(q.enqueue("pqr:1:submitted:v1", { id: 1 }).inserted, true);
  assert.equal(q.enqueue("pqr:1:submitted:v1", { id: 1 }).inserted, false);
  assert.equal(q.rows.size, 1);
});

test("two workers cannot claim the same unexpired lease", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const a = q.claim(100, 1000, "worker-a");
  const b = q.claim(100, 1000, "worker-b");
  assert.ok(a); assert.equal(b, null);
  assert.equal(q.rows.get("e1").attempts, 1);
});

test("expired lease can be reclaimed by another worker", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const a = q.claim(100, 50, "worker-a");
  const b = q.claim(151, 50, "worker-b");
  assert.ok(a); assert.ok(b); assert.notEqual(a.lockToken, b.lockToken);
  assert.equal(q.rows.get("e1").attempts, 2);
});

test("stale worker cannot finalize after lease was reclaimed", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const a = q.claim(0, 10, "worker-a");
  const b = q.claim(11, 10, "worker-b");
  assert.equal(q.delivered("e1", a.lockToken, 12, "provider-a"), false);
  assert.equal(q.delivered("e1", b.lockToken, 12, "provider-b"), true);
  assert.equal(q.rows.get("e1").providerMessageId, "provider-b");
});

test("transient provider failure schedules a retry", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const claim = q.claim(0, 100, "worker");
  assert.equal(q.retry("e1", claim.lockToken, 500, "provider_503"), true);
  assert.equal(q.claim(499, 100, "worker-2"), null);
  assert.ok(q.claim(500, 100, "worker-2"));
});

test("permanent provider failure moves event to dead letter", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const claim = q.claim(0, 100, "worker");
  assert.equal(q.dead("e1", claim.lockToken, "invalid_recipient"), true);
  assert.equal(q.claim(1000, 100, "worker-2"), null);
  assert.equal(q.rows.get("e1").status, "dead");
});

test("delivered event is not claimable again", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const claim = q.claim(0, 100, "worker");
  assert.equal(q.delivered("e1", claim.lockToken, 10, "msg-1"), true);
  assert.equal(q.claim(1000, 100, "worker-2"), null);
});

test("provider accepted then worker crashed: retry risk is explicit", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  const first = q.claim(0, 10, "worker-a");
  // Simulate provider accepted email but process died before delivered() was committed.
  const second = q.claim(11, 10, "worker-b");
  assert.ok(second);
  assert.equal(q.rows.get("e1").status, "processing");
  assert.notEqual(first.lockToken, second.lockToken);
  // This model cannot guarantee exactly-once external delivery; provider idempotency is required.
});

test("invalid or stale lock token cannot mutate row", () => {
  const q = new Outbox(); q.enqueue("e1", {});
  q.claim(0, 100, "worker");
  assert.equal(q.delivered("e1", "forged-token", 1, "msg"), false);
  assert.equal(q.retry("e1", "forged-token", 10, "error"), false);
  assert.equal(q.rows.get("e1").status, "processing");
});
