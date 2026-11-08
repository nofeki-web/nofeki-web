# NOFEKI — Remote RLS, Indexes, and Grants Review

**Inspection:** read-only PostgreSQL catalog queries  
**Project:** `bxjgodhqseoxrnshqtfr`  
**Date:** 2026-11-07  
**Production changes:** none

## 1. RLS posture

All 12 inventoried application tables in `public` have Row Level Security enabled. None had FORCE ROW LEVEL SECURITY enabled at inspection time. Table ownership is `postgres`.

The following six user-facing data tables have explicit authenticated-user ownership policies using `auth.uid()`:
- `gastos`
- `budgets`
- `budget_categories`
- `financial_profiles`
- `income_transactions`
- `user_expense_categories`

The `legal_acceptance_audit` table has an authenticated SELECT policy scoped to the user's own `user_id`; writes are performed by the legal-acceptance trigger path.

The five internal PQR/Shortcut tables have no client-facing policies:
- `pqr_events`
- `pqr_rate_limits`
- `pqr_submissions`
- `shortcut_authorizations`
- `shortcut_link_codes`

Their observed grants are restricted to `postgres` and/or `service_role`, rather than `anon` or `authenticated`. This is intentional in the current access design. Do not add generic client policies or expose these tables to the browser.

## 2. Policy design observations

- Expense, budget, income, profile, and user-category policies scope access to `auth.uid() = user_id`.
- Budget-category INSERT and UPDATE additionally verify that the referenced budget belongs to the authenticated user.
- UPDATE policies inspected include ownership checks in both USING and WITH CHECK for the main user-owned tables.
- The budget save RPC is separately guarded by `auth.uid()` and validates its input before writing.

This is a catalog review, not a penetration test. It does not prove every API path is secure.

## 3. Index inventory

All inspected indexes were reported valid. Notable indexes include:

| Area | Indexes / purpose |
|---|---|
| Gastos | Primary key; `(user_id, expense_date DESC)`; unique `(user_id, idempotency_key)` |
| Budgets | Primary key; unique `(user_id, period_month)`; `(user_id, period_month DESC)`; unique composite `(id,user_id)` |
| Budget categories | Primary key; unique `(budget_id,category_name)`; `(budget_id,user_id)`; `(user_id,budget_id)` |
| Income | Primary key; `(user_id,income_date DESC,id DESC)` |
| User categories | Primary key; unique `(user_id,lower(name))` |
| Shortcut | Primary key; unique token hash; partial active-user index; link-code hash unique; user/created index |
| PQR | Primary keys; event/submission timeline indexes; reference-code unique; source/timeline index; rate-limit source hash primary key |

The Supabase performance advisor previously flagged `shortcut_authorizations_user_active_idx` and `budget_categories_user_budget_idx` as unused. Their existence and validity are confirmed, but usage counters are workload-dependent. Do not drop either index based only on a no/low-use observation; review query plans and representative traffic first.

## 4. Grants review — important caveats

Observed table grants are consistent with the broad intended separation:
- `authenticated` receives CRUD only on the user-facing tables where RLS policies exist.
- `anon` and `authenticated` do not have table privileges on the internal PQR/Shortcut tables.
- `service_role` has privileged access to internal workflow tables as needed.
- `legal_acceptance_audit` is SELECT-only for authenticated users.
- `gastos` has CRUD for authenticated users and service_role, with RLS on.
- `save_monthly_budget` EXECUTE is granted to authenticated and postgres.
- `issue_shortcut_authorization` and `pqr_consume_rate_limit` EXECUTE are granted to service_role and postgres.

**Follow-up required:** the information_schema role grants output includes non-data privileges such as REFERENCES/TRIGGER on some tables for anon/authenticated. Those are not SELECT/INSERT/UPDATE/DELETE access, but they should be reviewed against the intended least-privilege policy in a dedicated ACL pass. This document does not recommend changing them.

## 5. Extensions observed

- `pg_stat_statements` 1.11
- `pgcrypto` 1.3
- `plpgsql` 1.0
- `supabase_vault` 0.3.1
- `uuid-ossp` 1.1

## 6. Outstanding validation

- Inspect exact column definitions, defaults, generated expressions, foreign keys, CHECK constraints, and sequences for all 12 tables.
- Review all function EXECUTE privileges, including default PUBLIC privileges, with ACL-level catalog queries.
- Review schema USAGE/CREATE grants and default privileges.
- Review Supabase Auth leaked-password protection setting and backup/PITR configuration.
- Test user isolation with at least two synthetic accounts in a disposable local/staging environment.
- Reconcile the 16 remote migration-history rows against repository SQL before any migration operation.

## Decision

No DDL or grant changes are recommended from this inspection alone. Keep production unchanged. Continue read-only schema recovery and prepare local regression coverage.
