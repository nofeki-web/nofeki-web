# NOFEKI PQR — idempotent submission and initial Outbox integration
Date: 2026-11-09
Branch: recovery/pqr-admin-retry-fix-20261108
Status: implementation specification; not deployed and not an executable migration.

## 1. Current implementation facts
Static inspection of the branch confirms:
- `pqr-submit` validates Turnstile, consumes `pqr_consume_rate_limit`, uploads an optional file to `pqr-attachments`, inserts `pqr_submissions`, then sends applicant confirmation and internal alert directly through Resend.
- The current form sends no idempotency key. The Edge Function CORS allowlist does not include `Idempotency-Key`.
- The attachment path is currently derived from a newly generated reference. If the DB insert fails, the function attempts to remove the uploaded object.
- The notification pair is sequential and represented by one `notification_status` on the submission. A failure in the second send can leave the first email already accepted while the submission reports a generic failed state.
- The deployed/repository admin flow still performs direct status update + event insert, direct response email + event insert, and generic confirmation retry. It does not call the candidate RPCs or Outbox.

## 2. Required client contract
For each new user intention to submit a PQR:
1. Generate one cryptographically random UUID before the first POST.
2. Send it in `Idempotency-Key`; do not accept a fingerprint from the browser.
3. Keep the same key for ambiguous network retries of the same unchanged payload.
4. Generate a new key only after the previous attempt is confirmed complete, or the user explicitly starts a materially different submission.
5. Do not persist name, email, subject, message, file bytes, Turnstile token, or other PII in browser storage for this feature. If recovery across refresh is required, persist only the UUID and a non-sensitive attempt state, subject to product/privacy approval.
6. Renew Turnstile for each HTTP attempt. Never reuse an expired Turnstile token.
7. On definitive success, clear the attempt key and draft according to current UX. On 409 fingerprint conflict, explain that the previous attempt key cannot be reused for changed content and require a new submission intention.

CORS must allow `Idempotency-Key` in `Access-Control-Allow-Headers`. The header must be required for the new version of the endpoint; coordinate frontend and backend rollout so the old form is not broken.

## 3. Server canonicalization and fingerprint
The Edge Function must:
- Validate all existing fields, consent, origin, Turnstile, rate limit, attachment MIME, size and signature checks.
- Normalize text consistently (trim and defined Unicode normalization; do not silently rewrite user meaning).
- Compute SHA-256 server-side over a versioned canonical representation containing request type, full name, normalized email, subject, message, consent/policy version, and attachment SHA-256 + byte length (or explicit null).
- Include a fingerprint version in the stored metadata so canonicalization can evolve safely.
- Never trust a client-supplied hash or attachment path.
- Avoid logging raw PQR content, attachment data, email addresses, idempotency keys, or Turnstile tokens.

## 4. Transaction and attachment saga
PostgreSQL cannot atomically commit a Supabase Storage upload. Treat the file as a compensating side effect, not as part of a fictional cross-service transaction.

Recommended sequence:
1. Validate and hash the attachment in memory.
2. Reserve the idempotency key server-side with a unique constraint and fingerprint. A concurrent duplicate must wait/replay or receive a controlled in-progress response; it must never create a second submission.
3. For a newly claimed request, upload to a deterministic private object path derived from the server-side request UUID, with overwrite disabled.
4. If the object already exists during a retry, verify its bytes/hash against the expected digest before reusing it. Never overwrite an object for a different fingerprint.
5. Finalize the PQR row, request result, and the two independent Outbox events in one PostgreSQL transaction. The request row must bind the request key, fingerprint, submission ID, attachment path and durable result.
6. If finalization fails, preserve enough state to retry safely or enqueue a compensating cleanup. Do not delete an object merely because the HTTP response was lost; the transaction may already have committed.
7. A periodic cleanup process may remove only old uploaded objects whose request is definitively abandoned and which are not referenced by any submission. It must be auditable and conservative.

The reserve/finalize contract must have bounded leases or explicit recoverable states so a process crash after upload does not leave a permanent in-progress request. This requires a dedicated submission-request state machine; it is not covered by the current admin-only `pqr_admin_requests` table.

## 5. Initial notification Outbox
Create two independent rows in the same transaction that creates the PQR:
- `applicant_confirmation`
- `internal_alert`

Each event must have:
- unique deterministic `event_key` bound to submission + event type + template version;
- status, attempt count, max attempts, available_at, lease token and lease expiry;
- sanitized last error code and timestamps;
- no duplicated PII or message body in Outbox.

The worker loads only the minimum recipient and template data from the submission. The applicant confirmation and internal alert must not share one delivery status. A successful first email must remain delivered if the second fails.

The internal alert contains personal information and the PQR message. Restrict its recipient to a server-configured address; do not allow client-selected recipients. Consider sending a minimal alert with a secure admin link instead of copying the full message into email.

## 6. Worker delivery semantics
- Claim a bounded batch using `FOR UPDATE SKIP LOCKED`; every claim rotates a fresh fencing token.
- Commit the claim before the network call.
- Send to Resend using the stable `event_key` as `Idempotency-Key`; do not mint a new key per retry.
- Finish/retry must require the current lease token. Consider also requiring `locked_until > now()` and document whether an expired but not yet reclaimed worker may finish.
- Classify outcomes: accepted, definitive rejection, transient failure, and ambiguous/unknown (timeout or connection loss after request may have reached provider).
- Do not mark an ambiguous result as definitively failed and blindly resend with a new key. Reuse the same key while within provider idempotency retention; quarantine/manual reconciliation after that retention boundary.
- A provider acceptance is not proof of final inbox delivery. UI wording should say accepted/sent by provider, not delivered to inbox.
- Dead-letter recovery must target one exact event, retain the original event key, record operator and reason, and require an explicit authorization path.

## 7. Rate limiting
A same-key replay must not consume another new-submission quota slot. The idempotency reservation and rate-limit decision need a defined atomic ordering:
- Only a newly claimed idempotency key consumes a submission quota.
- Replays of the same key/fingerprint return the original result without a second quota charge.
- Concurrent same-key requests must not race into multiple quota increments.
- Turnstile verification remains per HTTP attempt.
The implementation should either include the quota decision in the reservation RPC/transaction or use a tested reservation protocol that can roll back/release a denied claim safely. Do not simply move a read-before-write check into Edge Function code.

## 8. API response contract
- New claim: return 201 with the radicado only after PQR + request result + both Outbox events are committed. Notification status should be `queued`, not `sent`.
- Same key + same fingerprint, completed: return the same radicado/result with an explicit `replayed: true`; do not create rows or send emails.
- Same key + same fingerprint, active lease: return 202 (or a documented retryable 409) with a safe retry hint; do not create another submission.
- Same key + different fingerprint: 409 conflict.
- Rate limit: 429 only for a newly claimed request.
- Temporary infrastructure issue before durable commit: 503; client retains the same key.
- Never return a success response if the database did not durably persist the PQR and notification intents.

## 9. UI and observability
- Show “Solicitud radicada” once the database transaction commits.
- Show two independent notification states: queued, processing, accepted by provider, retry scheduled, dead/requires review.
- Do not imply email failure means the PQR itself failed.
- Admin retry action selects a specific failed/dead event; never reconstructs and resends a generic confirmation from the submission row.
- Log correlation ID, safe request UUID hash, submission ID, event ID, stage and sanitized error code. Keep PII and secrets out of logs.

## 10. Acceptance tests before rollout
1. Same key + same payload sequential replay returns the same reference and creates one submission.
2. Same key + same payload with 20 concurrent clients creates one submission and two initial Outbox events only.
3. Same key + changed payload returns 409 and creates no second row.
4. Lost HTTP response after commit; retry returns original reference.
5. Crash after reservation, before upload; same-key retry recovers.
6. Crash after upload, before finalize; same-key retry verifies/reuses object and completes.
7. DB finalize failure does not delete an object that a committed submission references.
8. Abandoned unreferenced upload is cleaned only after the defined grace period.
9. Duplicate/replayed attempt does not consume another rate-limit slot.
10. Applicant confirmation succeeds while internal alert fails; states remain independent.
11. Worker crash after provider acceptance but before finish uses the same provider idempotency key on retry.
12. Expired lease is reclaimed; stale worker cannot finish or reschedule after a new token is issued.
13. Unauthenticated callers cannot access private request/outbox data or execute privileged RPCs.
14. Existing Turnstile, origin, file signature, file size, consent, rate-limit and admin allowlist defenses remain intact.

## 11. Rollout boundary
No production changes are authorized by this specification. The safe rollout is additive and coordinated:
1. isolated PostgreSQL schema + tests;
2. compatible Edge API version and worker;
3. frontend form and admin panel updated to the new contracts;
4. feature flag / controlled activation;
5. verify logs, rate limit, attachment cleanup and notification states;
6. separate explicit approval for production migration/deployment.
