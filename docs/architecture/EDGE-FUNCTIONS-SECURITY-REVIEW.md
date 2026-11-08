# NOFEKI — Edge Functions Security and Workflow Review

**Inspection date:** 2026-11-07  
**Project:** `bxjgodhqseoxrnshqtfr`  
**Method:** retrieved deployed Edge Function source and read-only PostgreSQL function/trigger definitions  
**Production changes:** none

## Scope and deployed inventory

All eight deployed functions inspected are ACTIVE:
- `registrar-gasto-atajo` v9 — `verify_jwt=false`
- `crear-token-atajo` v7 — `verify_jwt=true`
- `gestionar-atajos` v7 — `verify_jwt=false`
- `categorias-atajo` v9 — `verify_jwt=false`
- `crear-codigo-vinculacion-atajo` v3 — `verify_jwt=true`
- `canjear-codigo-vinculacion-atajo` v4 — `verify_jwt=false`
- `pqr-submit` v6 — `verify_jwt=false`
- `pqr-admin` v9 — `verify_jwt=false`

A disabled gateway JWT check is not by itself proof of an unauthenticated endpoint. Several functions validate a user session or a separate revocable device/link token in their own code. Keep these modes unchanged until a complete client contract and regression test exists.

## Positive controls verified

### Shortcut token and expense flow
- Device tokens are generated from 32 random bytes and only their SHA-256 hashes are stored.
- Expense registration validates token length, hashes the presented token, and looks up only a non-revoked authorization.
- Authorization expiry is checked before expense insertion.
- The expense is associated with the user ID from the authorization row, not a caller-supplied user ID.
- Expense fields, amount, date, type, note and idempotency key are validated.
- The database has a unique per-user idempotency constraint, which is the race-safe duplicate guard.
- Revocation updates only the matching authorization ID, current authenticated user's ID, and rows not already revoked.
- Link codes are random, stored as hashes, expire after five minutes, and are claimed with a conditional `used_at IS NULL` plus future-expiry filter.
- The RPC `issue_shortcut_authorization` serializes creation per user with an advisory transaction lock, expires stale active records, and refuses a second active authorization.
- Category lookup checks the same token hash, revocation state and expiry before returning only that user's categories.

### Session-authenticated functions
- Token creation validates the bearer session against `/auth/v1/user`.
- Link-code creation validates the bearer session, checks active authorization, and issues a short-lived one-time code.
- Shortcut management validates the bearer session and scopes list/revoke operations by the authenticated user's ID.
- PQR admin validates the bearer session through `auth.getUser` before authorizing access.

### PQR intake
- Request method, origin (when supplied), payload sizes and field lengths are checked.
- Consent is required.
- Cloudflare Turnstile is verified server-side and its hostname is checked against NOFEKI domains.
- Rate limiting is enforced through a database RPC with bounded parameters.
- Attachments are limited to PDF/JPG/PNG, 5 MB, and checked against basic file signatures.
- Attachment cleanup is attempted if database insertion fails.
- User-controlled values inserted into notification HTML are escaped.

## Findings and recommended follow-up

### F-01 — PQR admin authorization is a hard-coded email allowlist
**Severity:** Medium; architectural blocker for multi-user administration, not evidence of immediate unauthorized access.

The deployed `pqr-admin` v9 contains a literal `ADMIN_EMAILS = ["nofeki07@gmail.com"]` check. This is a single-admin gate, but it is not a maintainable role/permission model and cannot support future organization membership or delegated support agents cleanly.

**Recommendation:** replace this with server-side platform permissions (e.g. a private access schema and an explicit permission such as `pqr.manage`), checked using the authenticated user UUID. Do not trust user-editable metadata or a frontend flag. Implement only after platform authorization tables, migration reconciliation, staging, and regression tests are ready.

### F-02 — PQR status mutation and event insertion are separate operations
**Severity:** Medium; consistency/audit risk.

The `status` action updates `pqr_submissions` and then separately inserts a `pqr_events` record. If the second write fails, the status changes without its corresponding audit event. The response action also performs separate submission and event writes; it reports history failure but cannot roll back an already-sent email.

**Recommendation:** create a single database transaction/RPC for state transition plus event insertion, with validated allowed transitions and actor identity passed from trusted server context. Email delivery should remain an external side effect with an explicit retry/outbox design. Do not deploy a partial fix.

### F-03 — PQR notification retry does not check persistence errors
**Severity:** Low to Medium; operational observability risk.

In `pqr-admin` v9, the `retry_notification` action awaits updates to notification status and event history but does not inspect either returned error before responding `ok: true`.

**Recommendation:** check both database errors, return an accurate partial-failure result, and avoid reporting a successful retry if persistence failed. Add tests for email success/database failure and email failure/database success.

### F-04 — Public intake rate-limit source depends on proxy headers
**Severity:** Low; verify deployment behavior.

The intake chooses `cf-connecting-ip`, then `x-real-ip`, then `unknown`. Confirm in production logs that the Edge runtime supplies the expected Cloudflare header and that caller-supplied fallback headers cannot defeat the intended per-client limit. If no trusted address is available, the shared `unknown` bucket can throttle unrelated users together.

**Recommendation:** validate the actual request header behavior from logs and use only a proxy-controlled client address. Do not accept arbitrary forwarded-IP chains.

### F-05 — CORS is not authentication
**Severity:** Informational.

Shortcut token endpoints use wildcard CORS because the iOS Shortcut is not a browser origin. This is acceptable only because authorization depends on high-entropy secret tokens and server-side checks. CORS does not prevent non-browser clients from calling these endpoints. Preserve token entropy, hash-at-rest, expiry, revocation and rate/abuse monitoring.

### F-06 — One-time code can be consumed even if token issuance subsequently fails
**Severity:** Low; expected failure behavior with user friction.

The redeem function marks a valid code as used before calling the atomic authorization RPC. If issuance fails or another active authorization exists, the code remains consumed and the user must generate a new one. This is explicitly communicated in the error response.

**Recommendation:** retain this behavior unless a transactionally atomic claim-and-issue operation is designed. A database RPC that atomically consumes the code and creates the authorization would eliminate the intermediate state.

### F-07 — Hard-coded CORS origin lists include stale Vercel previews in Shortcut management
**Severity:** Low; configuration hygiene.

`gestionar-atajos` includes multiple historical Vercel deployment origins. They do not grant authorization by themselves, but expand the set of browser origins allowed to read the function response when a valid session is present.

**Recommendation:** reduce to current production origins once all preview deployments are confirmed obsolete. Keep CORS separate from user authorization and test production + preview behavior.

## Database functions and triggers

- `capture_nofeki_legal_acceptance()` is SECURITY DEFINER, owned by postgres, with empty search_path and schema-qualified table reference. Trigger is AFTER INSERT on `auth.users`. Preserve it during identity bootstrap.
- `enforce_single_active_shortcut_authorization()` is SECURITY DEFINER, owned by postgres, with `search_path=public`; its target table is schema-qualified. Trigger is AFTER INSERT on `public.shortcut_authorizations`. Preserve unless a reviewed replacement is provided.
- `issue_shortcut_authorization(...)` is SECURITY INVOKER, uses empty search_path and schema-qualified objects, and takes a per-user advisory transaction lock.
- `pqr_consume_rate_limit(...)` is SECURITY INVOKER, uses empty search_path and schema-qualified objects, and atomically increments/resets a per-source counter.
- `save_monthly_budget(...)` is SECURITY INVOKER, uses empty search_path, obtains `auth.uid()`, rejects unauthenticated calls, and performs budget plus category replacement in one transaction.
- `rls_auto_enable()` is a SECURITY DEFINER event trigger owned by postgres with `search_path=pg_catalog`; it enables RLS on newly created public tables. It is not a substitute for creating explicit policies and grants.

## Decision

No deployed function, trigger, CORS setting, database function, or table was changed. Do not deploy fixes directly to production. Next implementation sequence:
1. Recover exact schema and migration history into version control.
2. Establish local/staging test environment without paid compute unless explicitly approved.
3. Add regression tests for expense idempotency, token revocation, one-time linking, user isolation, PQR transitions, and notification retries.
4. Implement F-01 through F-03 behind reviewed migrations/RPCs and deploy only after acceptance tests.
