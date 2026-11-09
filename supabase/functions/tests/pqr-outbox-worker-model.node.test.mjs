import test from "node:test";
import assert from "node:assert/strict";

const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600, 7200, 14400, 21600];

function makeOutbox({ maxAttempts = 8 } = {}) {
  return {
    status: "pending", attempts: 0, maxAttempts, availableAt: 0,
    leaseToken: null, lockedUntil: null, deliveredAt: null,
    eventKey: "pqr:submission:response:event",
  };
}
function claim(row, now, leaseSeconds = 180) {
  if (!((row.status === "pending" && row.availableAt <= now) ||
        (row.status === "processing" && row.lockedUntil <= now))) return null;
  row.status = "processing";
  row.attempts += 1;
  row.leaseToken = `lease-${row.attempts}`;
  row.lockedUntil = now + leaseSeconds;
  return { token: row.leaseToken, attempt: row.attempts, eventKey: row.eventKey };
}
function finish(row, token, now, providerId) {
  if (row.status !== "processing" || row.leaseToken !== token) return false;
  row.status = "delivered";
  row.deliveredAt = now;
  row.providerMessageId = providerId;
  row.leaseToken = null;
  row.lockedUntil = null;
  return true;
}
function retry(row, token, now, errorCode) {
  if (row.status !== "processing" || row.leaseToken !== token) return "stale_lease";
  row.status = row.attempts >= row.maxAttempts ? "dead" : "pending";
  row.availableAt = now + RETRY_DELAYS_SECONDS[Math.min(row.attempts - 1, 7)];
  row.lastErrorCode = errorCode;
  row.leaseToken = null;
  row.lockedUntil = null;
  return row.status;
}

test("claim is exclusive while lease is active", () => {
  const row = makeOutbox();
  const first = claim(row, 100);
  assert.ok(first);
  assert.equal(claim(row, 101), null);
  assert.equal(row.attempts, 1);
});

test("expired lease is reclaimed with a new fencing token", () => {
  const row = makeOutbox();
  const first = claim(row, 100, 30);
  const second = claim(row, 131, 30);
  assert.ok(first && second);
  assert.notEqual(first.token, second.token);
  assert.equal(finish(row, first.token, 132, "resend-old"), false);
  assert.equal(finish(row, second.token, 132, "resend-new"), true);
  assert.equal(row.status, "delivered");
});

test("retry uses progressive bounded delays and clears lease", () => {
  const row = makeOutbox();
  const first = claim(row, 100);
  assert.equal(retry(row, first.token, 100, "resend_http_503"), "pending");
  assert.equal(row.availableAt, 130);
  assert.equal(row.leaseToken, null);
  assert.equal(claim(row, 129), null);
  assert.ok(claim(row, 130));
});

test("maximum attempts move event to dead letter", () => {
  const row = makeOutbox({ maxAttempts: 2 });
  const first = claim(row, 0);
  assert.equal(retry(row, first.token, 0, "temporary"), "pending");
  const second = claim(row, row.availableAt);
  assert.equal(retry(row, second.token, row.availableAt, "temporary"), "dead");
  assert.equal(claim(row, row.availableAt + 999999), null);
});

test("provider accepted but finish timed out: retry keeps same idempotency key", () => {
  const row = makeOutbox();
  const first = claim(row, 0);
  const keyAfterAmbiguousProviderResult = first.eventKey;
  assert.equal(retry(row, first.token, 0, "outbox_finish_rpc_failed"), "pending");
  const second = claim(row, row.availableAt);
  assert.equal(second.eventKey, keyAfterAmbiguousProviderResult);
});

test("delivered event cannot be claimed or finished twice", () => {
  const row = makeOutbox();
  const first = claim(row, 0);
  assert.equal(finish(row, first.token, 1, "resend-id"), true);
  assert.equal(claim(row, 999999), null);
  assert.equal(finish(row, first.token, 2, "resend-id-2"), false);
  assert.equal(row.providerMessageId, "resend-id");
});

test("total scheduled retry delay remains within 24-hour provider key retention", () => {
  const total = RETRY_DELAYS_SECONDS.reduce((sum, value) => sum + value, 0);
  assert.equal(total, 49350);
  assert.ok(total < 24 * 60 * 60);
});
