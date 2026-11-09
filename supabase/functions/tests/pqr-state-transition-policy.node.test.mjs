import test from "node:test";
import assert from "node:assert/strict";

const allowed = new Map([
  ["Recibida", new Set(["En revisión"])],
  ["En revisión", new Set(["En gestión"])],
  ["En gestión", new Set(["Respondida"])],
  ["Respondida", new Set(["Cerrada", "En gestión"])],
  ["Cerrada", new Set()],
]);

function transition(state, target, { reason = "", hasFormalResponse = false } = {}) {
  if (!allowed.has(state) || !allowed.has(target)) return { ok: false, code: "INVALID_STATUS" };
  if (state === target) return { ok: true, noop: true, state };
  if (!allowed.get(state).has(target)) return { ok: false, code: "TRANSITION_NOT_ALLOWED" };
  if (state === "Respondida" && target === "En gestión" && !reason.trim()) {
    return { ok: false, code: "REOPEN_REASON_REQUIRED" };
  }
  if (target === "Respondida" && !hasFormalResponse) {
    return { ok: false, code: "FORMAL_RESPONSE_REQUIRED" };
  }
  return { ok: true, noop: false, state: target, audit: { from: state, to: target, reason: reason.trim() || null } };
}

test("permits only the approved forward path", () => {
  assert.equal(transition("Recibida", "En revisión").ok, true);
  assert.equal(transition("En revisión", "En gestión").ok, true);
  assert.equal(transition("En gestión", "Respondida", { hasFormalResponse: true }).ok, true);
  assert.equal(transition("Respondida", "Cerrada").ok, true);
});

test("rejects skipped stages and direct closure without response", () => {
  assert.equal(transition("Recibida", "En gestión").code, "TRANSITION_NOT_ALLOWED");
  assert.equal(transition("Recibida", "Respondida", { hasFormalResponse: true }).code, "TRANSITION_NOT_ALLOWED");
  assert.equal(transition("En gestión", "Cerrada").code, "TRANSITION_NOT_ALLOWED");
});

test("requires a formal persisted response before Respondida", () => {
  assert.equal(transition("En gestión", "Respondida").code, "FORMAL_RESPONSE_REQUIRED");
});

test("allows reopening Respondida only with a reason", () => {
  assert.equal(transition("Respondida", "En gestión").code, "REOPEN_REASON_REQUIRED");
  const result = transition("Respondida", "En gestión", { reason: "El usuario aportó información adicional" });
  assert.equal(result.ok, true);
  assert.equal(result.audit.reason, "El usuario aportó información adicional");
});

test("Cerrada is terminal", () => {
  for (const target of allowed.keys()) {
    if (target !== "Cerrada") assert.equal(transition("Cerrada", target).ok, false);
  }
});

test("same-state request is an idempotent no-op without audit event", () => {
  const result = transition("En gestión", "En gestión");
  assert.equal(result.ok, true);
  assert.equal(result.noop, true);
  assert.equal("audit" in result, false);
});

test("unknown states are rejected", () => {
  assert.equal(transition("Pendiente", "Cerrada").code, "INVALID_STATUS");
});
