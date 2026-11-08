// Static source-contract checks only.
// Run from repository root with: deno test --allow-read supabase/functions/tests/pqr-source-contract.test.ts
// These checks do NOT invoke Supabase, Resend, Turnstile, Storage, or production APIs.
// They do not replace isolated integration tests.

function assertIncludes(source: string, fragment: string, label: string) {
  if (!source.includes(fragment)) throw new Error(`FAIL: ${label} — missing: ${fragment}`);
}
function assertExcludes(source: string, fragment: string, label: string) {
  if (source.includes(fragment)) throw new Error(`FAIL: ${label} — unexpected: ${fragment}`);
}

const submitUrl = new URL("../pqr-submit/index.ts", import.meta.url);
const adminUrl = new URL("../pqr-admin/index.ts", import.meta.url);
const submit = await Deno.readTextFile(submitUrl);
const admin = await Deno.readTextFile(adminUrl);

Deno.test("pqr-submit: restricts methods and allowed origins", () => {
  assertIncludes(submit, 'req.method !== "POST"', "POST-only handler");
  assertIncludes(submit, 'req.method === "OPTIONS"', "CORS preflight");
  assertIncludes(submit, '"https://nofeki.com", "https://www.nofeki.com"', "origin allowlist");
  assertIncludes(submit, "if (origin && !allowedOrigins.has(origin))", "reject foreign origins");
});

Deno.test("pqr-submit: validates consent, Turnstile and rate limiting before insert", () => {
  assertIncludes(submit, "if (!consent)", "privacy consent");
  assertIncludes(submit, "TURNSTILE_SECRET_KEY", "Turnstile secret requirement");
  assertIncludes(submit, "challenges.cloudflare.com/turnstile/v0/siteverify", "Turnstile verification");
  assertIncludes(submit, 'admin.rpc("pqr_consume_rate_limit"', "rate limit RPC");
  const rateCheck = submit.indexOf('admin.rpc("pqr_consume_rate_limit"');
  const insert = submit.indexOf('admin.from("pqr_submissions").insert');
  if (rateCheck < 0 || insert < 0 || rateCheck > insert) throw new Error("FAIL: rate limit must precede PQR insert");
});

Deno.test("pqr-submit: validates attachment type, size and file signature", () => {
  assertIncludes(submit, "5 * 1024 * 1024", "5 MiB limit");
  assertIncludes(submit, '"application/pdf"', "PDF MIME");
  assertIncludes(submit, '"image/jpeg"', "JPEG MIME");
  assertIncludes(submit, '"image/png"', "PNG MIME");
  assertIncludes(submit, "signatureOk", "binary signature check");
  assertIncludes(submit, 'admin.storage.from("pqr-attachments").remove([attachmentPath])', "orphan cleanup after failed insert");
});

Deno.test("pqr-submit: preserves successful radication if notification metadata update fails", () => {
  assertIncludes(submit, "notification_status_persisted: !notificationUpdateError", "persistence status surfaced");
  assertIncludes(submit, "PQR created but notification status could not be saved", "operational warning");
  assertIncludes(submit, "}, 201, origin)", "successful radication response");
});

Deno.test("pqr-admin: authenticates user and checks admin allowlist", () => {
  assertIncludes(admin, 'db.auth.getUser(token)', "server-side token validation");
  assertIncludes(admin, "ADMIN_EMAILS.includes(user.email.toLowerCase())", "admin allowlist");
  assertIncludes(admin, "return reply({ok:false,error:\"Inicia sesión.\"},401,origin)", "missing token response");
});

Deno.test("pqr-admin: validates status, notes and response inputs", () => {
  assertIncludes(admin, 'statuses.includes(next)', "status allowlist");
  assertIncludes(admin, "if (!note)", "non-empty internal note");
  assertIncludes(admin, "response.length<5", "minimum response length");
});

Deno.test("pqr-admin: does not silently report missing response history", () => {
  assertIncludes(admin, "history_saved:historySaved", "history persistence result");
  assertIncludes(admin, "history_warning:historyWarning", "history warning result");
  assertIncludes(admin, "PQR response sent but history insert failed", "history failure log");
});

Deno.test("pqr-admin: keeps response action from changing the administrator-selected status", () => {
  assertIncludes(admin, "const nextStatus=row.status", "preserve selected status");
  assertIncludes(admin, "The status is exclusively controlled by the explicit \"status\" action.", "status separation comment");
});

Deno.test("both PQR handlers: do not expose service credentials in response bodies", () => {
  assertExcludes(submit, "SERVICE_KEY:", "submit response literal credential field");
  assertExcludes(admin, "SERVICE_KEY:", "admin response literal credential field");
});
