import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildMail, constantTimeEqual, retryDelaySeconds, sanitizeErrorCode, type OutboxEvent, type Submission } from "./core.ts";

const base: Submission = { id:"s1", reference_code:"PQR-1", request_type:"Petición", full_name:"Ana <script>alert(1)</script>", email:"ana@example.test", subject:"Ayuda", message:"Hola <img src=x>" };
const event = (event_type: OutboxEvent["event_type"]): OutboxEvent => ({ outbox_id:"o1", submission_id:"s1", source_event_id:"e1", event_key:"k1", event_type, lease_token:"l1", attempt_number:1, lease_expires_at:"2030-01-01T00:00:00Z" });

Deno.test("constantTimeEqual accepts equal secrets and rejects mismatch/length", () => {
  assertEquals(constantTimeEqual("secret","secret"), true);
  assertEquals(constantTimeEqual("secret","secreT"), false);
  assertEquals(constantTimeEqual("secret","secret-long"), false);
  assertEquals(constantTimeEqual("",""), true);
});
Deno.test("buildMail escapes applicant-controlled fields", () => {
  const mail = buildMail(event("internal_alert"), base, null, "pqr@nofeki.test");
  assertEquals(mail.html.includes("<script>"), false);
  assertEquals(mail.html.includes("&lt;script&gt;"), true);
  assertEquals(mail.html.includes("&lt;img"), true);
});
Deno.test("buildMail requires configured internal recipient", () => {
  assertThrows(() => buildMail(event("internal_alert"), base, null), Error, "missing_notify_recipient");
});
Deno.test("buildMail creates applicant confirmation", () => {
  const mail = buildMail(event("applicant_confirmation"), base, null);
  assertEquals(mail.to, base.email);
  assertEquals(mail.subject.includes("PQR-1"), true);
});
Deno.test("buildMail requires a formal response body", () => {
  assertThrows(() => buildMail(event("admin_response"), base, null), Error, "missing_response_event");
});
Deno.test("buildMail escapes formal response and preserves line breaks", () => {
  const mail = buildMail(event("admin_response"), base, "<b>Respuesta</b>\nSiguiente");
  assertEquals(mail.html.includes("<b>Respuesta</b>"), false);
  assertEquals(mail.html.includes("&lt;b&gt;Respuesta&lt;/b&gt;<br>Siguiente"), true);
});
Deno.test("retry delay is bounded and monotonic", () => {
  assertEquals(retryDelaySeconds(1), 30);
  assertEquals(retryDelaySeconds(2), 120);
  assertEquals(retryDelaySeconds(999), 21600);
  assertEquals(retryDelaySeconds(0), 30);
});
Deno.test("error sanitizer only persists approved error classes", () => {
  assertEquals(sanitizeErrorCode(new Error("resend_http_429")), "resend_http_429");
  assertEquals(sanitizeErrorCode(new Error("submission_lookup_failed")), "submission_lookup_failed");
  assertEquals(sanitizeErrorCode(new Error("provider returned secret recipient data")), "transient_delivery_error");
});
