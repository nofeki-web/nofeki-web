# NOFEKI Edge Functions — source reconciliation and review
Date: 2026-11-08

## Scope
Reviewed the eight active Supabase Edge Functions in project `bxjgodhqseoxrnshqtfr`. Their deployed source snapshots have been synchronized into this GitHub branch under `supabase/functions/<function>/index.ts`. This is a source backup/reconciliation only: no function was deployed and no production database writes were made.

## Active versions and JWT mode

| Function | Active version | verify_jwt | Main responsibility |
|---|---:|---:|---|
| registrar-gasto-atajo | 9 | false | Expense registration using revocable device token |
| crear-token-atajo | 7 | true | Create device token for logged-in user |
| gestionar-atajos | 7 | false | List/revoke current user's device authorizations |
| categorias-atajo | 9 | false | Read categories using device token |
| crear-codigo-vinculacion-atajo | 3 | true | Issue one-time linking code for logged-in user |
| canjear-codigo-vinculacion-atajo | 4 | false | Redeem one-time code into device token |
| pqr-submit | 6 | false | Public PQR intake with Turnstile and rate limit |
| pqr-admin | 9 | false | Authenticated admin PQR operations |

For functions with `verify_jwt=false`, the code must and does implement its own relevant authentication: device-token validation or explicit session validation, depending on the endpoint. This setting alone is not a vulnerability.

## Findings

### Positive controls verified in source
- `registrar-gasto-atajo` hashes the device token, rejects missing/short/oversized tokens, checks `revoked_at IS NULL`, and checks expiration before inserting.
- A live unique index exists on `gastos(user_id, idempotency_key)`, supporting race-safe duplicate prevention. The endpoint also handles unique-conflict retries.
- `crear-token-atajo` validates the user's access token against Auth and uses the atomic `issue_shortcut_authorization` RPC.
- `gestionar-atajos` validates the user session and scopes list/revoke operations by the authenticated `user.id`.
- Linking codes are stored as hashes, expire after five minutes, and are claimed by updating only unused, unexpired rows. Redemption calls the atomic authorization RPC.
- PQR intake checks consent, validates Turnstile hostname, applies a database rate-limit RPC, checks attachment MIME/signature/size, and uses a private storage bucket.
- Admin PQR validates the bearer session and an explicit administrator email allowlist.

### Items requiring follow-up (not changed)
1. **PQR submit notification persistence:** after the PQR row is inserted, the follow-up update that stores notification status does not inspect the returned database error. The submission itself remains created, but its notification status may be stale if this update fails. Improve error handling/observability without turning a successfully created PQR into a misleading failed submission.
2. **Device token CORS:** `registrar-gasto-atajo` and `categorias-atajo` allow wildcard origins. Their authorization relies on a high-entropy revocable device token, not browser cookies. Do not restrict origins until the iOS Shortcuts request path is tested; CORS is not a substitute for token security.
3. **One-time linking flow:** if the code is successfully claimed but the atomic authorization RPC then rejects because an active device already exists, the code is consumed. This is safe against reuse but requires the user to request a fresh code. Confirm the UI communicates this clearly.
4. **Origin allowlist maintenance:** `gestionar-atajos` includes several historical Vercel deployment origins. Remove obsolete origins only after verifying the currently deployed frontend and preview workflow.
5. **PQR rate-limit source IP:** code uses `cf-connecting-ip` first and `x-real-ip` as fallback. Ensure the function is only reached through the expected trusted proxy path; do not trust arbitrary caller-supplied forwarding headers in a bypass path.
6. **PQR notification update and admin retry:** the `retry_notification` branch in the isolated GitHub patch now checks both database write errors. It has not been deployed.

## Repository synchronization
The branch contains source snapshots for all eight active functions under `supabase/functions/`. The `pqr-admin` file includes the separately prepared retry-notification error-handling patch. The other seven are synchronized from their deployed active versions for comparison and future controlled release.

## Release gate
Before deployment: review diffs against `main`; test token missing/invalid/revoked/expired, duplicate expense submission, one active device, code expired/used, revocation, category lookup, PQR Turnstile/rate-limit/attachment/email outcomes, and admin authorization. Deploy one function at a time only after the test environment and rollback plan are ready.
