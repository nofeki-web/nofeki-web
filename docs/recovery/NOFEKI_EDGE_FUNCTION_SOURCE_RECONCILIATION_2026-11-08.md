# NOFEKI recovery branch — Edge Function source reconciliation
Date: 2026-11-08
Repository: nofeki-web/nofeki-web
Branch: recovery/pqr-admin-retry-fix-20261108
Supabase project: bxjgodhqseoxrnshqtfr

## Branch comparison
Compared `main` with `recovery/pqr-admin-retry-fix-20261108`:
- 51 commits ahead, 0 behind.
- 37 changed paths: 29 documentation/recovery artifacts and 8 Edge Function source paths.
- This branch is not documentation-only and must not be merged wholesale.

## Live production Edge Function source check
Fetched all eight live function sources through the Supabase read-only function inspection action and compared the complete `index.ts` text against the recovery branch copy.

| Function | Live version | verify_jwt | Branch source |
|---|---:|---:|---|
| registrar-gasto-atajo | 9 | false | Exact match |
| crear-token-atajo | 7 | true | Exact match |
| gestionar-atajos | 7 | false | Exact match |
| categorias-atajo | 9 | false | Exact match |
| crear-codigo-vinculacion-atajo | 3 | true | Exact match |
| canjear-codigo-vinculacion-atajo | 4 | false | Exact match |
| pqr-submit | 6 | false | Different |
| pqr-admin | 9 | false | Different |

The six exact matches are source-text comparisons, not a redeployment or runtime test. The live versions and verify_jwt settings were read from Supabase.

## PQR differences requiring isolated regression tests

### pqr-submit
The recovery copy checks the result of updating notification status after the PQR row has already been created. If that status update fails, it logs the failure and still returns HTTP 201 with the PQR reference and `notification_status_persisted: false`. Production currently awaits the update without checking its returned error, then returns HTTP 201.

Potential benefit: makes notification-status persistence failure visible without falsely telling the applicant that the already-created PQR itself failed. Regression test must confirm no duplicate PQR is created and the reference is preserved when notification metadata update fails.

### pqr-admin
The recovery copy checks errors from both:
1. Updating `pqr_submissions` with the retry email status.
2. Inserting the `notification_retry` event into `pqr_events`.

Production currently awaits both calls but does not inspect their returned `error` values. The recovery copy also sets explicit stage labels before the notification send, status update and event insert, so the outer error log identifies the failing stage.

Potential benefit: failed audit/status writes become explicit HTTP 500 failures rather than silently returning success. Regression test must cover successful send + successful writes, failed email + successful writes, status update failure, event insert failure, and retry idempotency/duplicate notification behavior.

## Security / deployment notes
- Do not change `verify_jwt` settings as part of this reconciliation.
- Do not deploy either PQR recovery source until the isolated regression matrix passes.
- The six matching functions do not need redeployment just because their copies are present in this branch.
- Before any merge, split documentation-only commits/files from the eight Edge Function paths. Review CI workflows and Vercel auto-deploy behavior before opening or merging a PR.
- No production function, schema, policy, Auth setting, Storage setting, or environment variable was changed during this inspection.

## TLS 1.2 compatibility action
Supabase has announced removal of four CBC-mode TLS 1.2 cipher suites from project HTTP APIs on November 10, 2026 at the earliest. This affects Auth, Data API, Storage, Realtime and Edge Functions on the project API domain/custom domains; direct Postgres, pooler and Management API are not affected. TLS 1.3 is unchanged.

NOFEKI client inventory to validate:
- iOS Shortcuts (the actual iPhone/iOS version and network stack used by users)
- NOFEKI web app in supported browsers
- Any server-side integration calling Supabase HTTP APIs
- Any third-party webhook/client using Auth, Storage, Data API, Realtime or Edge Functions

A successful request before the removal date is not proof of future compatibility. Validate supported OS/runtime/TLS library or TLS 1.3 support; if an actual TLS handshake error occurs, diagnose the client runtime rather than changing CORS or function authentication.

References:
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated
- https://supabase.com/docs/guides/security/tls
- https://supabase.com/kb/troubleshooting/tls-handshake-failures-after-cbc-cipher-removal

## Decision
Keep this branch unmerged. The PQR source changes are candidates for isolated testing only. The next safe technical milestone is to test the two PQR differences in an isolated database/environment after cost approval, then produce a narrowly scoped change set.
