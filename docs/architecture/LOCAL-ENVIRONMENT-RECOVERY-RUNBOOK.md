# NOFEKI — Local Environment Recovery Runbook

**Status:** preparation only; not executed  
**Target branch:** `architecture/nofeki-platform-foundation`  
**Production impact:** none  
**Purpose:** prepare a repeatable local Supabase environment without changing the live NOFEKI Gastos project.

## 1. Current constraint

A local Supabase stack requires a compatible computer/runtime. Docker is the default runtime; the native runtime is experimental and platform-dependent. An iPhone is not a supported host for running this local stack.

Until a compatible computer is available, work is limited to repository preparation, read-only inspection, and documentation. Do not create a paid hosted branch or sandbox as a substitute without explicit cost approval.

## 2. Safety rules

- Do not run `db push`, `migration up`, `reset`, `repair`, or any DDL against production.
- Do not create or alter production tables, policies, grants, triggers, functions, Auth settings, or Edge Functions during environment recovery.
- Do not expose `service_role` or secret keys in browser code, repository files, screenshots, or chat.
- Do not add permissive RLS policies to internal PQR or Shortcut tables merely to clear an advisor warning.
- Do not fabricate historical migration files or mark migrations as applied to make the history appear complete.
- Preserve the current production Auth users and UUIDs, Gastos data, Shortcut authorization flow, budgets, income, and PQR workflows.

## 3. Known repository/database drift

The remote database reports 16 migration history entries, while the inspected GitHub branches contain only three SQL migration files. This is an unresolved history gap.

The remote public schema inventory contains 12 business tables:
`budget_categories`, `budgets`, `financial_profiles`, `gastos`, `income_transactions`, `legal_acceptance_audit`, `pqr_events`, `pqr_rate_limits`, `pqr_submissions`, `shortcut_authorizations`, `shortcut_link_codes`, and `user_expense_categories`.

All 12 were observed with RLS enabled. Internal PQR/Shortcut tables have restricted ACLs and intentionally no client-facing policies; do not change that access model without a separate review.

No `platform` schema has been created in production. The Platform architecture remains a proposal, not a deployed schema.

## 4. First setup session on a compatible computer

1. Install a supported Docker-compatible runtime (or evaluate the experimental native runtime only if the OS/architecture is supported).
2. Install the Supabase CLI using the current official installation instructions.
3. Verify versions and available commands before use:
   - `supabase --version`
   - `supabase --help`
   - `supabase db --help`
4. In a clean working copy of this repository, initialize the local Supabase project only after checking whether a `supabase/` directory already exists. Do not overwrite existing project configuration.
5. Start the local stack and confirm its services are healthy.
6. Use a separate local database with synthetic test users and data. Never copy production secrets or real personal/financial records into the local environment.

## 5. Migration reconciliation — required before schema pull or migration execution

1. Export/inspect the current remote schema definitions, including tables, columns, constraints, indexes, policies, functions, triggers, grants, extensions, and relevant Auth hooks.
2. Preserve the remote migration history exactly as found; do not rewrite the 16 recorded entries.
3. Compare every remote migration version with the SQL files and Git history.
4. Identify missing SQL definitions from trusted sources (existing deployed definitions, prior commits, backups, or verified exports). If an original migration cannot be recovered, label it as unrecovered.
5. Produce a clearly named **current-schema baseline/snapshot** only after review. It must not be represented as the original historical migrations.
6. Rebuild and test a disposable local database from the reviewed baseline.
7. Compare local and remote schema objects and verify critical workflows before proposing any production migration.

## 6. Production readiness gates

No production schema migration is permitted until all are true:

- [ ] Remote migration history reconciled and documented.
- [ ] Current schema snapshot reviewed against remote objects.
- [ ] Backup/PITR availability verified from project settings.
- [ ] A restore drill or credible recovery procedure verified.
- [ ] Independent staging/local test environment is operational.
- [ ] Auth, RLS, grants, triggers, functions, and Edge Functions reviewed.
- [ ] Regression tests pass for sign-in, expense CRUD, budgets, income, iPhone Shortcut linking/registration/revocation, and PQR.
- [ ] A reviewed migration, rollback/forward-fix plan, and explicit approval exist.

## 7. Next work that can be done without a personal computer

- Continue read-only inventory of remote functions, triggers, policies, grants, indexes, and Edge Function versions.
- Document the exact object definitions and unresolved gaps.
- Prepare regression test cases and a migration review checklist.
- Keep Platform schema design isolated from the live Gastos schema.

**Current decision: NO-GO for production migration.** Repository preparation and read-only discovery may continue.
