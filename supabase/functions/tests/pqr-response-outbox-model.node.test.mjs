import test from "node:test";
import assert from "node:assert/strict";

// Model of the SQL contract. Not PostgreSQL integration and not proof of SQL compilation.
class ResponseModel {
  constructor() {
    this.submission = { status: "En gestión", version: 5, email: "applicant@example.test" };
    this.requests = new Map();
    this.events = [];
    this.outbox = [];
    this.failAt = null;
  }
  async respond({ requestId, fingerprint, response }) {
    const old = this.requests.get(requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) return { ok: false, code: "PT409_KEY_CONFLICT" };
      return { ...old.result, replayed: true };
    }
    if (this.submission.status !== "En gestión") return { ok: false, code: "PT409_STALE_STATUS" };
    if (response.trim().length < 5 || response.trim().length > 5000) return { ok: false, code: "PT422_RESPONSE" };

    const before = { ...this.submission };
    const eventsBefore = this.events.length;
    const outboxBefore = this.outbox.length;
    try {
      const event = { id: "event-" + (this.events.length + 1), type: "response_sent", response: response.trim(), email_status: null };
      this.events.push(event);
      if (this.failAt === "after_event") throw new Error("injected_after_event");
      const outbox = { id: "outbox-" + (this.outbox.length + 1), source_event_id: event.id, event_key: "pqr:submission:response:" + event.id, status: "pending" };
      this.outbox.push(outbox);
      if (this.failAt === "after_outbox") throw new Error("injected_after_outbox");
      this.submission.status = "Respondida";
      this.submission.version += 1;
      const result = { ok: true, status: this.submission.status, event_id: event.id, outbox_id: outbox.id };
      this.requests.set(requestId, { fingerprint, result });
      return result;
    } catch (e) {
      this.submission = before;
      this.events.length = eventsBefore;
      this.outbox.length = outboxBefore;
      this.requests.delete(requestId);
      throw e;
    }
  }
}

test("response creates one event, one linked outbox item and moves to Respondida", async () => {
  const db = new ResponseModel();
  const result = await db.respond({ requestId: "r1", fingerprint: "a".repeat(64), response: "Hemos revisado su solicitud y damos respuesta." });
  assert.equal(result.status, "Respondida");
  assert.equal(db.events.length, 1);
  assert.equal(db.outbox.length, 1);
  assert.equal(db.outbox[0].source_event_id, db.events[0].id);
  assert.equal(db.events[0].email_status, null);
});

test("same response request replays without duplicating event or outbox", async () => {
  const db = new ResponseModel();
  const args = { requestId: "r1", fingerprint: "a".repeat(64), response: "Hemos revisado su solicitud y damos respuesta." };
  const first = await db.respond(args);
  const replay = await db.respond(args);
  assert.equal(first.event_id, replay.event_id);
  assert.equal(replay.replayed, true);
  assert.equal(db.events.length, 1);
  assert.equal(db.outbox.length, 1);
});

test("same request id with changed response fingerprint conflicts", async () => {
  const db = new ResponseModel();
  await db.respond({ requestId: "r1", fingerprint: "a".repeat(64), response: "Hemos revisado su solicitud y damos respuesta." });
  const result = await db.respond({ requestId: "r1", fingerprint: "b".repeat(64), response: "Respuesta diferente y válida." });
  assert.equal(result.code, "PT409_KEY_CONFLICT");
  assert.equal(db.events.length, 1);
  assert.equal(db.outbox.length, 1);
});

test("failure while inserting outbox rolls back response, event and idempotency", async () => {
  const db = new ResponseModel();
  db.failAt = "after_outbox";
  await assert.rejects(db.respond({ requestId: "r1", fingerprint: "a".repeat(64), response: "Hemos revisado su solicitud y damos respuesta." }));
  assert.deepEqual(db.submission, { status: "En gestión", version: 5, email: "applicant@example.test" });
  assert.equal(db.events.length, 0);
  assert.equal(db.outbox.length, 0);
  assert.equal(db.requests.size, 0);
});
