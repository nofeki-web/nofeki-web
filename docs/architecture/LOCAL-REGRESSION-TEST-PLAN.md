# NOFEKI — Local/Staging Regression Test Plan

**Status:** prepared; not executed  
**Date:** 2026-11-07  
**Target:** disposable local Supabase or isolated staging only  
**Production data:** do not copy without an approved anonymization and privacy plan

## Entry gates

- [ ] Recover and reconcile remote migration history before any `db reset`, `db push`, or migration repair.
- [ ] Keep the remote production project unchanged.
- [ ] Use synthetic test users and synthetic records.
- [ ] Confirm Auth, Storage buckets, Edge Function secrets, and email/Turnstile test configuration for the isolated environment.
- [ ] Verify two independent user identities and capture their UUIDs.
- [ ] Confirm a rollback/rebuild path for the disposable environment.

## Test identities

Create two synthetic users, User A and User B. Do not use real customer accounts.

## Gastos and user isolation

| ID | Scenario | Expected result |
|---|---|---|
| G-01 | User A creates an expense | Expense belongs to A |
| G-02 | User B queries expenses | No A records returned |
| G-03 | User B attempts update/delete using A's expense ID | No row changed |
| G-04 | Insert expense with invalid amount/type/date | Rejected by API/database |
| G-05 | Repeat same per-user idempotency key | One expense only |
| G-06 | Same idempotency key used by B | B's row remains isolated from A |

## Shortcut authorization

| ID | Scenario | Expected result |
|---|---|---|
| S-01 | A creates token | Raw token returned once; hash stored |
| S-02 | A registers expense with valid token | Expense attributed to A |
| S-03 | Invalid token | Rejected |
| S-04 | Revoked token | Rejected immediately |
| S-05 | Expired token | Rejected |
| S-06 | A tries to create second active authorization | Rejected or prior authorization revoked only according to approved flow |
| S-07 | B attempts to revoke A's authorization ID | No row changed |
| S-08 | Generate one-time link code | Code expires within five minutes |
| S-09 | Redeem link code twice/concurrently | Exactly one redemption succeeds |
| S-10 | Redeem expired or consumed code | Rejected |
| S-11 | Categories lookup with A token | Only A categories plus documented defaults |
| S-12 | Categories lookup with revoked token | Rejected |

## Budget and income

| ID | Scenario | Expected result |
|---|---|---|
| B-01 | A saves a monthly budget | One budget for A/month |
| B-02 | Save budget categories | Replacement occurs atomically |
| B-03 | Invalid mode/month/amount/categories | Entire transaction rejected |
| B-04 | B queries A budget/category IDs | No data disclosed |
| B-05 | Manual mode | No income amount and zero savings target per current RPC contract |
| B-06 | Income mode | Income amount required |
| I-01 | A creates income transaction | Belongs to A |
| I-02 | B queries or mutates A income ID | No access |

## PQR intake and administration

| ID | Scenario | Expected result |
|---|---|---|
| P-01 | Valid PQR with valid Turnstile | One submission and reference code |
| P-02 | Missing/invalid consent | Rejected |
| P-03 | Invalid/expired Turnstile token | Rejected |
| P-04 | Rate limit exceeded | HTTP 429 |
| P-05 | Invalid MIME or file signature | Rejected |
| P-06 | Attachment over 5 MB | Rejected |
| P-07 | Failed DB insert after attachment upload | Attachment cleanup attempted |
| P-08 | Non-admin authenticated user calls admin endpoint | HTTP 403 |
| P-09 | Unauthenticated caller calls admin endpoint | HTTP 401 |
| P-10 | Status update and event insertion | Both commit or neither commits after atomic RPC implementation |
| P-11 | Notification retry with DB persistence failure | Response reports partial failure accurately |
| P-12 | PQR query includes hostile search characters | No query injection; result safely constrained |

## Platform authorization (future)

- [ ] A user with Gastos entitlement can open Gastos.
- [ ] A user without OPS entitlement cannot invoke OPS backend APIs, even if they bypass the UI.
- [ ] An OPS license assigned to a user grants only the intended OPS product/modules.
- [ ] Revoking a license blocks subsequent backend requests.
- [ ] Organization member roles cannot grant access outside their organization.
- [ ] User-editable metadata cannot grant roles, licenses, or permissions.
- [ ] Gastos data remains isolated from OPS data.

## Acceptance

No test is considered passed from code inspection alone. Record environment, test timestamp, request/response, and result for each ID. Execute only after the local/staging database is reconstructed and isolated.
