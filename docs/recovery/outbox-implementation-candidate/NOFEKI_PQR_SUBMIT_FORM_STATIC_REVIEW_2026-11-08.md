# PQR submit + form candidate static review
Date: 2026-11-08
Branch: `recovery/pqr-outbox-implementation-20261108`

## Files reviewed
- `docs/recovery/outbox-implementation-candidate/frontend/pqr.html`
- `docs/recovery/outbox-implementation-candidate/pqr-submit/index.ts`
- `docs/recovery/outbox-implementation-candidate/NOFEKI_PQR_SUBMISSION_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql`

## Implemented in candidate branch
- Browser creates a UUID idempotency key, stores it in sessionStorage, sends it as `Idempotency-Key`, retains it after network/5xx failures, removes it after success, and clears it after a 409 payload/key conflict.
- Edge candidate requires and validates UUID key.
- Submission UUID and reference are deterministic from the request key, stabilizing the attachment object path across retries.
- Edge computes SHA-256 fingerprint over normalized business fields and attachment hash, excluding Turnstile token and volatile IP.
- Existing attachment object is downloaded and hash-compared after upload conflict; it is never overwritten blindly.
- Edge calls `pqr_create_submission_v2`; no synchronous Resend calls or post-insert notification UPDATE remain.
- New radication returns 201; replay returns 200; payload/key conflict returns 409.
- On RPC error, only an object uploaded by the current invocation is compensated; cleanup failure is logged without PII.
- Existing Turnstile, host validation, 5/hour rate limit, field validation, consent, MIME/signature and 5 MiB checks are retained.

## Static review findings / unresolved before runtime
1. The frontend's `sessionStorage` key is per-tab/session. Cross-device retries are not deduplicated unless the same key is preserved by the client; this is acceptable for first web iteration but must be stated.
2. The rate limiter runs before the RPC, so repeated retries consume rate-limit quota. This is conservative for abuse protection but may inconvenience legitimate repeated failures. Revisit in isolated integration tests without weakening anti-abuse controls.
3. Storage and PostgreSQL are not a distributed transaction. A hard crash after upload and before RPC can leave an orphan; a reconciler is still required.
4. The SQL RPC depends on the previously drafted `private.pqr_outbox` schema and grants. Both SQL candidates remain uncompiled/unexecuted.
5. The RPC currently does not write a separate initial-history row. Existing UI/history contract must be reviewed before adding it.
6. No Deno/browser/PostgreSQL runtime is available in the current environment. This is source review, not runtime validation.

## Explicitly not done
No production source changed; no Supabase SQL, Storage, Edge Function deployment, frontend deployment, secrets, PR, merge or email activity.
