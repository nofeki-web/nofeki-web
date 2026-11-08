# NOFEKI PQR — Edge Functions source audit and change proposal
Date: 2026-11-08
Branch inspected: `recovery/pqr-admin-retry-fix-20261108`
Comparison: repository default-branch source vs recovery-branch source.

## Scope and evidence boundary

Inspected:
- `supabase/functions/pqr-submit/index.ts`
- `supabase/functions/pqr-admin/index.ts`

The actions `status`, `respond`, and `retry_notification` are branches inside `pqr-admin`; they are not separate Edge Functions in these source files. Attempts to fetch paths named `status/index.ts`, `retry_notification/index.ts`, `pqr-status/index.ts`, and `pqr-admin/respond/index.ts` returned 404.

This is a source-code comparison only. The repository default branch is not asserted to be the live deployed source. No live Supabase function bundle, environment variables, production logs, database state, or provider account was accessed in this audit. Do not treat these findings as confirmation of live production behavior.

## Executive findings

The recovery branch contains meaningful hardening compared with the repository default-branch snapshots, but neither inspected function implements the Transactional Outbox yet.

Critical:
1. `pqr-submit` commits the submission, then sends two emails sequentially, then writes notification status. A crash or second-email failure can leave partial delivery and ambiguous status. A client retry can create another submission because there is no inbound idempotency key.
2. `pqr-admin/respond` sends the email before persisting response history. If history insert fails, the recipient has already received the response; a retry can send it again.
3. `pqr-admin/status` updates the submission and inserts its history event in separate requests. A failure between them leaves status changed without its event. Repeated/concurrent updates can produce stale or duplicate history.
4. `pqr-admin/retry_notification` sends first, then updates notification status and writes an event. It has the same ambiguous delivery window and has no dedupe key.

High:
5. Admin authorization is an email allowlist in source. It should remain narrow for now; a future role-based policy should be based on trusted server-side authorization, not editable user metadata.
6. The rate-limit RPC is invoked before attachment upload and submission insert. Failed downstream attempts may consume a rate-limit slot; verify whether this is desired and whether the RPC itself is atomic.
7. Attachment upload and submission insert are separate operations. The code attempts cleanup if insert fails, but cleanup failure is not handled as a durable orphan record/reconciliation task.
8. The recovery branch adds stronger request parsing, payload byte limits, Turnstile hostname verification, and an RPC rate limiter. It also records notification persistence failure explicitly. These changes should be preserved during refactoring.

## Function-by-function comparison

### A. `pqr-submit`

Recovery branch improvements over default-branch source:
- Validates JSON object shape and enforces body size using encoded byte length.
- Uses Cloudflare Turnstile and validates the returned hostname.
- Uses a dedicated `pqr_consume_rate_limit` RPC rather than a read-count-then-insert check.
- Uses Cloudflare/proxy IP headers rather than the caller-provided first X-Forwarded-For value.
- Validates base64 decoding and file signature; validates MIME/extension and 5 MiB file size.
- Adds no-store and nosniff response headers.
- Reports whether notification status persistence succeeded.

Remaining issues:
- No client idempotency key/fingerprint is accepted or persisted. A retry after a lost HTTP response can create a second PQR.
- Submission insert and notification intents are not one transaction.
- Confirmation and internal emails are sent serially; first can succeed while second fails.
- A crash after provider acceptance but before status update leaves ambiguous delivery.
- A notification-status update failure is only logged; no durable outbox/reconciliation item exists.
- Uploaded file cleanup failure after submission insert failure is not persisted for later cleanup.
- Rate-limit slot is consumed before storage and insert. Confirm whether this should count failed attempts.
- `x-real-ip` fallback is safe only if the hosting/proxy layer overwrites it; verify the trust boundary rather than accepting arbitrary client headers.

Required target:
- Keep the improved validation, Turnstile, file signature checks, and rate-limit RPC.
- Require or generate a stable request idempotency key; persist its fingerprint and original submission result.
- Call one atomic database mutation that creates submission + initial history + outbox notification intents.
- Do not send email in this request handler.
- Return the same reference on a repeated request with the same key/fingerprint; reject same key with different fingerprint.

### B. `pqr-admin` — authorization and read paths

Both snapshots:
- Require a bearer token and validate it with `auth.getUser(token)`.
- Restrict access using the hard-coded email allowlist `nofeki07@gmail.com`.
- Return submission detail and event history; create a 5-minute signed URL for an attachment.

Risks/limitations:
- Email allowlist is a narrow single-admin control, not a scalable role model. Do not widen it casually.
- GET detail uses `select("*")`; return only fields the admin UI actually needs, especially if new sensitive fields are added later.
- Search builds an `or` filter from user input. Keep input bounded and test punctuation/wildcards that may break PostgREST filter parsing.
- Signed URL creation and detail retrieval should be audited; keep URL expiry short and avoid logging the URL.

Required target:
- Preserve server-side token validation and least-privilege admin authorization.
- Move admin authorization to a trusted server-side role/allowlist source with explicit audit trail, after reviewing the existing user/role model.
- Return explicit field allowlists rather than `*`.
- Add request correlation IDs and safe operational logs.

### C. `pqr-admin` action `status`

Current pattern:
1. Update `pqr_submissions.status`.
2. Separately insert `pqr_events` row.

Failure mode: step 1 can commit while step 2 fails. A retry can add a duplicate event; concurrent admins can overwrite one another based on stale `row.status`. No expected-version/expected-status guard exists.

Recovery branch still uses two independent Supabase calls. It validates the next status and preserves an event note, but does not make the change atomic.

Required target:
- Replace the two writes with one database RPC/transaction.
- Validate allowed transition server-side.
- Use expected status/version to reject stale updates.
- Persist status + event + deterministic outbox event in the same transaction.
- Dedupe by stable transition request ID.
- Only set `responded_at` on the defined transition; do not overwrite it on unrelated actions.

### D. `pqr-admin` action `respond`

Default-branch behavior sends email first, then updates status to `Respondida` if email was accepted, then inserts response event.
Recovery-branch behavior improves this by preserving the admin-selected status and reporting whether history was saved, but it still sends email before the DB writes.

Failure mode: provider can accept the email and then the DB update/history insert can fail. The response may be sent with no durable record. Retrying may send a duplicate.

Required target:
- One atomic RPC persists response content, response history, and outbox event.
- Worker sends email after transaction commit.
- Store a stable response request ID/event key and suppress duplicate submissions.
- Keep current recovery-branch rule: sending a response must not silently change status; status transition remains an explicit admin action.
- Minimize retention of response content and avoid logging it.

### E. `pqr-admin` action `retry_notification`

Current pattern sends confirmation email, updates `notification_status`, then inserts retry event. Recovery branch checks database errors, which is better than default branch, but delivery still precedes durable event recording.

Required target:
- Admin action should enqueue/requeue a specific notification event, not send directly.
- Require an explicit notification/event ID and dedupe key; do not retry all notifications implicitly.
- Record operator, reason, previous status, and retry request ID.
- Worker applies the same lease/fencing/provider-idempotency behavior as normal delivery.
- A delivered event cannot be retried unless an authorized admin creates an explicit new delivery intent.

## Prioritized implementation plan

### P0 — Preserve and define
- Keep recovery-branch validation and Turnstile improvements.
- Freeze current production behavior; no deployment while source-to-live parity is unknown.
- Confirm live deployed function versions and actual database columns/RPC signatures.

### P1 — Database transaction layer (isolated test project only)
- Add private outbox table and unique event key.
- Add inbound request idempotency table/unique key.
- Implement atomic RPCs for create submission, status transition, admin response, and notification retry request.
- Add narrow worker claim/finalize/retry RPC contracts with lock token fencing.
- Review RLS, grants, schema exposure, function ownership, and EXECUTE permissions.

### P2 — Worker and provider
- Implement worker outside the request path.
- Verify Resend idempotency behavior and key retention from current provider documentation/test account.
- Add retry/backoff/dead-letter and reconciliation metrics.
- Test provider accepted + worker crash ambiguity.

### P3 — Edge Function integration
- `pqr-submit`: validate → atomic create RPC → return reference; no email send.
- `pqr-admin/status`: atomic transition RPC.
- `pqr-admin/respond`: atomic response/outbox RPC.
- `pqr-admin/retry_notification`: explicit enqueue retry RPC.
- Preserve GET/admin authorization while tightening field selection and audit logs.

### P4 — Verification and rollout gate
- Run actual Node test file, Deno checks, PostgreSQL integration and concurrency tests.
- Exercise every failure-injection case in an isolated project.
- Confirm provider semantics and run security advisors.
- Prepare backup/restore and rollback plan.
- Request explicit approval before any production deployment.

## Files compared

- Recovery branch `pqr-submit/index.ts` blob: `acec264c2843b40096bbed28dac99c56132639af`
- Default branch `pqr-submit/index.ts` blob: `5506309beca46d109f55eec7ef275572a972d954`
- Recovery branch `pqr-admin/index.ts` blob: `a439bbf1bf6803b870de8185598e25a03992f8f4`
- Default branch `pqr-admin/index.ts` blob: `6d2ce7c0c97b8da091af645e0ad06a87fd287985`

## Change-control statement

This audit created no code changes to the two Edge Functions, no migration, no RPC, no Supabase database changes, no environment variable changes, and no deployment.