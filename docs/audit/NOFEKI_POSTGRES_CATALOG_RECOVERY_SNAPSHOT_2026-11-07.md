# NOFEKI PostgreSQL Catalog Recovery — Object Definitions Snapshot

**Captured:** 2026-11-07  
**Source:** read-only catalog queries against Supabase project `bxjgodhqseoxrnshqtfr`  
**Target branch:** `recovery/pqr-admin-retry-fix-20261108`  
**Safety:** catalog reads only; no DDL, DML, migration, function deployment, or production configuration change.

## Scope and confidence

This document records the application-owned PostgreSQL objects visible in the live catalog. It is a catalog snapshot, not a complete database dump. Supabase-managed objects in `auth`, `storage`, `extensions`, `graphql`, and platform schemas are deliberately excluded from the NOFEKI restoration scope unless a direct dependency is explicitly noted.

Definitions returned by `pg_get_functiondef`, `pg_get_triggerdef`, and `pg_indexes` are the authoritative live definitions observed during this read. They should be compared with repository migrations and the previous recovery notes before any future restore. No object should be recreated in production from this document without a separately approved change plan.

## Application routines observed

| Routine | Signature / return | Security | Owner | Catalog status |
|---|---|---|---|---|
| `capture_nofeki_legal_acceptance` | trigger | SECURITY DEFINER; empty search_path | postgres | Definition captured |
| `enforce_single_active_shortcut_authorization` | trigger | SECURITY DEFINER; search_path=public | postgres | Definition captured |
| `issue_shortcut_authorization` | (uuid,text,text,timestamptz) returns boolean | SECURITY INVOKER; empty search_path | postgres | Definition captured |
| `pqr_consume_rate_limit` | (text,integer,integer) returns boolean | SECURITY INVOKER; empty search_path | postgres | Definition captured |
| `rls_auto_enable` | event_trigger | SECURITY DEFINER; search_path=pg_catalog | postgres | Definition captured |
| `save_monthly_budget` | (date,text,numeric,numeric,numeric,jsonb) returns uuid | SECURITY INVOKER; empty search_path | postgres | Definition captured |

### Routine behavior recovered from live definitions

- `capture_nofeki_legal_acceptance()`: AFTER INSERT trigger routine for Auth user creation; reads the four NOFEKI legal metadata fields, writes a row to `public.legal_acceptance_audit`, and uses `ON CONFLICT DO NOTHING`. Important qualification: this proves the trigger records supplied metadata; it does not independently prove the user actually accepted the terms.
- `enforce_single_active_shortcut_authorization()`: after insertion, revokes other unrevoked authorizations for the same user.
- `issue_shortcut_authorization(uuid,text,text,timestamptz)`: validates user/hash/expiry/device name, takes a per-user advisory transaction lock, revokes expired active rows, refuses a second active authorization, and inserts the new authorization.
- `pqr_consume_rate_limit(text,integer,integer)`: validates a SHA-256 hex source hash and bounded limit/window, atomically upserts a per-source counter, and returns whether the count is within limit.
- `rls_auto_enable()`: event-trigger routine that enables RLS on newly created tables in schema `public`; exceptions are logged rather than rethrown.
- `save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)`: requires `auth.uid()`, validates first-of-month period and income/manual mode constraints, upserts the user's monthly budget, replaces that budget's category rows, and returns the budget UUID.

The complete live routine bodies are retrievable from the source catalog with `pg_get_functiondef`. This summary intentionally does not turn them into executable migration SQL.

## Trigger and event-trigger topology

| Kind | Name | Target / event | Definition status |
|---|---|---|---|
| Table trigger | `trg_single_active_shortcut_authorization` | AFTER INSERT ON `public.shortcut_authorizations` | Full `pg_get_triggerdef` captured |
| Event trigger | `ensure_rls` | `ddl_command_end`, enabled | Full target routine definition captured; owner postgres |

The table trigger invokes `public.enforce_single_active_shortcut_authorization()`.

The event trigger `ensure_rls` invokes `public.rls_auto_enable()`. The routine is a SECURITY DEFINER function with a restricted `pg_catalog` search path. Its behavior must be included in any future schema restoration because it affects future table creation in `public`.

Other event triggers returned by the catalog are Supabase-managed (owners/functions under `supabase_admin` or `extensions`) and are not NOFEKI-owned recovery objects. Do not attempt to recreate or alter them as part of application recovery.

## Public indexes observed

The live catalog returned these indexes for application tables:

- `budget_categories`: `budget_categories_pkey`; `budget_categories_unique_name`; `budget_categories_user_budget_idx`; `budget_categories_budget_user_fk_idx`.
- `budgets`: `budgets_pkey`; `budgets_id_user_unique`; `budgets_user_period_idx`; `budgets_user_period_unique`.
- `financial_profiles`: `financial_profiles_pkey`.
- `gastos`: `gastos_pkey`; `gastos_user_date_idx`; `gastos_user_id_idempotency_key_unique`.
- `income_transactions`: `income_transactions_pkey`; `income_transactions_user_date_idx`.
- `legal_acceptance_audit`: `legal_acceptance_audit_pkey`.
- `pqr_events`: `pqr_events_pkey`; `pqr_events_submission_created_idx`.
- `pqr_rate_limits`: `pqr_rate_limits_pkey`.
- `pqr_submissions`: `pqr_submissions_pkey`; `pqr_submissions_reference_code_key`; `pqr_submissions_created_at_idx`; `pqr_submissions_source_created_idx`.
- `shortcut_authorizations`: `shortcut_authorizations_pkey`; `shortcut_authorizations_token_hash_key`; `shortcut_authorizations_user_active_idx` (partial, `revoked_at IS NULL`).
- `shortcut_link_codes`: `shortcut_link_codes_pkey`; `shortcut_link_codes_code_hash_key`; `shortcut_link_codes_user_created_idx`.
- `user_expense_categories`: `user_expense_categories_pkey`; `user_expense_categories_user_name_unique` (unique on `user_id, lower(name)`).

**Important:** `budget_categories_budget_user_fk_idx` is present in production and its origin was not found in the repository migration history reviewed so far. Preserve it in the recovery inventory; do not drop it. It supports the `(budget_id,user_id)` relationship. Index presence alone does not establish whether an index is redundant or unused.

## Function EXECUTE grants observed

The catalog view reported these explicit routine grants:

- `issue_shortcut_authorization`: EXECUTE for `postgres` and `service_role`.
- `pqr_consume_rate_limit`: EXECUTE for `postgres` and `service_role`.
- `save_monthly_budget`: EXECUTE for `postgres` and `authenticated`.
- Trigger routines `capture_nofeki_legal_acceptance`, `enforce_single_active_shortcut_authorization`, and event-trigger routine `rls_auto_enable`: owner `postgres` shown. The routine-privileges view does not expose a complete negative-grant/ACL picture; use the separate effective-privilege audit as the source for anon/authenticated/service_role restrictions. Do not infer absence of PUBLIC execute solely from this compact view.

## Dependencies and recovery implications

- `capture_nofeki_legal_acceptance` depends on `auth.users` row metadata and `public.legal_acceptance_audit`; its trigger attachment on `auth.users` must be reconciled separately because the application trigger is attached across schemas.
- `enforce_single_active_shortcut_authorization` depends on `public.shortcut_authorizations` and is attached to that table.
- `issue_shortcut_authorization` depends on `auth.uid()`, PostgreSQL advisory-lock/hash functions, and `public.shortcut_authorizations`.
- `pqr_consume_rate_limit` depends on `public.pqr_rate_limits`.
- `save_monthly_budget` depends on `auth.uid()`, `public.budgets`, `public.budget_categories`, and JSONB recordset support.
- `rls_auto_enable` depends on event-trigger catalog functions and applies only to new tables in `public`.

## Reconciliation status

| Object family | Result |
|---|---|
| Public routines | 6 definitions captured from live catalog |
| Public table triggers | 1 definition captured |
| Application event triggers | 1 definition captured |
| Public indexes | Definitions captured for all application indexes returned |
| Routine grants | Positive EXECUTE grants observed; full ACL comparison remains tied to the privilege audit |
| Cross-schema trigger attachment for legal audit | Needs a focused trigger query on `auth.users` |
| Full dependency graph | Partial: direct application dependencies summarized; platform-owned dependencies excluded |

## Next read-only steps

1. Query non-internal triggers specifically on `auth.users` to confirm the legal-audit trigger attachment and exact trigger name/definition.
2. Capture exact constraints and FK definitions for all 12 application tables and reconcile them against the schema snapshot and migration files.
3. Compare each live public index definition with the repository's migrations; identify only true unmatched definitions, not presumed duplicates.
4. Reconcile full routine ACLs using `proacl` and `has_function_privilege` for `anon`, `authenticated`, `service_role`, and `PUBLIC`.
5. Update the recovery manifest only after the remaining checks are complete.

**No restore script is approved or generated by this snapshot.**