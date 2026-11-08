# NOFEKI — Remote Triggers and Functions Inventory

**Inspection type:** read-only SQL catalog queries  
**Project:** `bxjgodhqseoxrnshqtfr`  
**Date:** 2026-11-07  
**Changes performed:** none

## Application triggers observed

| Schema/table | Trigger | Function | Behavior |
|---|---|---|---|
| `auth.users` | `nofeki_capture_legal_acceptance` | `public.capture_nofeki_legal_acceptance()` | After user insert, reads the legal-consent metadata fields and inserts a row in `public.legal_acceptance_audit` when the required fields are present. |
| `public.shortcut_authorizations` | `trg_single_active_shortcut_authorization` | `public.enforce_single_active_shortcut_authorization()` | After insert, revokes other non-revoked authorizations for the same user. |

Both application triggers were observed enabled.

## Relevant application functions observed

- `public.capture_nofeki_legal_acceptance()`: PL/pgSQL, SECURITY DEFINER, empty search_path. Uses fully qualified table references.
- `public.enforce_single_active_shortcut_authorization()`: PL/pgSQL, SECURITY DEFINER, search_path set to `public`. Updates only rows in `public.shortcut_authorizations` for the inserted user's ID.
- `public.issue_shortcut_authorization(uuid,text,text,timestamptz)`: validates arguments, takes a per-user transaction advisory lock, expires stale authorizations, rejects a second active authorization, and inserts the new authorization. Observed as SECURITY INVOKER.
- `public.pqr_consume_rate_limit(text,integer,integer)`: validates the hash and limits, then atomically updates the PQR rate-limit counter. Observed as SECURITY INVOKER.
- `public.save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)`: obtains the current user via `auth.uid()`, validates the budget payload, upserts the monthly budget, replaces its category rows, and returns the budget ID. Observed as SECURITY INVOKER.

## Event triggers observed

- `ensure_rls` on `ddl_command_end`, for `CREATE TABLE`, `CREATE TABLE AS`, and `SELECT INTO`, invokes `public.rls_auto_enable()`.
- `public.rls_auto_enable()` is SECURITY DEFINER and sets search_path to `pg_catalog`. It enables RLS for newly created tables in `public`; errors are logged rather than rethrown.
- Other observed event triggers belong to Supabase-managed extensions/infrastructure: GraphQL placeholder/access, pg_cron access, pg_net access, and PostgREST schema-cache notifications. Preserve them.

## Review notes

1. This inventory records observed catalog definitions; it is not a complete privilege/grant audit.
2. SECURITY DEFINER functions require a separate review of ownership, EXECUTE grants, search_path, and every object reference before any future change.
3. Do not remove, replace, or recreate the legal-acceptance trigger as part of Platform bootstrap. The architecture proposal must preserve it.
4. Do not alter the Shortcut authorization trigger or issuance function while reconciling migrations.
5. The `ensure_rls` event trigger is an important project-wide safeguard. Validate its behavior in local staging before considering any schema changes.
6. No function, trigger, event trigger, grant, or production schema object was modified during this inspection.
