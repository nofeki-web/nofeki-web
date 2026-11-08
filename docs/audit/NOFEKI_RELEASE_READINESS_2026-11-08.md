# NOFEKI release readiness — 2026-11-08

## Git comparison
Compared `main` with `recovery/pqr-admin-retry-fix-20261108`:
- Status: ahead
- Ahead: 17 commits
- Behind: 0 commits
- Merge base is current `main` head at comparison time.
- The current comparison reports 10 changed paths: two audit documents and eight function source paths (one PQR function file plus seven additional source snapshots; pqr-admin is modified).

No merge or pull request was opened. This avoids triggering repository CI/CD or deployment automation before its behavior is confirmed.

## Static review outcomes
- Device expense endpoint verifies device token hash, revocation timestamp and expiration before insert.
- Database has a unique index on `(user_id, idempotency_key)`, which is the authoritative duplicate guard under concurrency.
- Session-oriented functions validate bearer token with Supabase Auth and scope data by authenticated user ID.
- Linking-code redemption conditionally claims an unused, unexpired code before creating the authorization. A failed authorization after claim consumes the code; user must issue a fresh code.
- Revocation writes `revoked_at`; the expense endpoint checks this field on every request.
- PQR notification status persistence now checks and logs the database update error, while retaining HTTP success for an already-persisted PQR submission and exposing `notification_status_persisted`.
- PQR admin retry now checks both submission update and audit event insert errors.

## Test plan (not executed against production)
The available connected workflow can inspect deployed source and GitHub contents, but does not provide a free isolated Supabase database/runtime for exercising these endpoints end-to-end. Therefore no live mutation tests were attempted.

| Area | Required test cases | Expected result |
|---|---|---|
| Expense token | missing, malformed, unknown, revoked, expired | 401; no expense inserted |
| Expense payload | invalid amount/date/type/oversized body | 400/413; no insert |
| Duplicate expense | same idempotency key twice; concurrent same-key requests | one row only; retry returns existing row |
| Device management | invalid session; list; revoke own authorization; attempt revoke another user's ID | 401 or scoped result; other user's authorization unchanged |
| Linking code | expired, reused, malformed code | rejected; no authorization |
| Linking concurrency | redeem same code twice simultaneously | only one claim succeeds |
| Single active device | create/redeem while active device exists | conflict; no second active authorization |
| Categories | missing/invalid/revoked/expired token | rejected; no private categories disclosed |
| PQR intake | invalid consent, invalid Turnstile, wrong hostname, rate limit exceeded | rejected with appropriate 4xx |
| PQR attachments | oversized file, invalid MIME/signature, unsupported type | rejected; no orphaned object |
| PQR email | provider unavailable/not configured; status update DB error | PQR remains stored; notification state is explicit and observable |
| PQR admin | unauthenticated user; non-admin; failed DB update/event insert | denied or explicit failure; never false success |

## Release recommendation
Do not merge or deploy yet. First:
1. Run the above matrix against a local/free test database when the user's personal computer is available.
2. Verify no GitHub Actions or Vercel deployment is triggered by the eventual PR/merge.
3. Review the final diff and confirm the expected frontend contract for `notification_status_persisted`.
4. Deploy only after explicit approval, one function at a time, with a rollback plan.

Production database and deployed Edge Functions were not changed during this work.
