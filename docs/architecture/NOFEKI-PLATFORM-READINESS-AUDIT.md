# NOFEKI Platform — Readiness Audit

Date: 2026-11-07

## Scope
Read-only verification of the production Supabase project and repository migration history. No production schema, data, Auth settings, Edge Functions, Vercel configuration, or deployment was changed.

## Verified production state
- Supabase project: `bxjgodhqseoxrnshqtfr`
- Region: `us-east-1`
- PostgreSQL: `17.11.0.003`
- Project status at inspection: `ACTIVE_HEALTHY`
- Supabase migration registry contains 16 versions, from `20261018201105` through `20261107171359`.
- `supabase_migrations.schema_migrations` matches the 16 versions returned by the Supabase migration API.
- No Supabase development branches were present at inspection.
- No `platform` schema or platform foundation tables were found in the earlier read-only inventory.

## Repository reconciliation finding
The repository's `main` branch contains only three SQL files under `supabase/migrations/`:
- `20261104000100_create_monthly_budgets.sql`
- `20261105000100_create_income_transactions.sql`
- `20261107120000_pqr_management_workflow.sql`

These do not match the 16 version/name pairs recorded by production. The three repository filenames also use version identifiers different from the corresponding production migration registry entries. Therefore the repository migration history is incomplete and/or non-canonical relative to production. Do not run `supabase db push`, migration repair, reset, or any production DDL until the complete canonical SQL history has been reconstructed and independently reviewed.

The three checked-in files are useful source artifacts, but they are not sufficient to rebuild the current production database from zero. In particular, the repository does not currently provide the full migration chain for existing Gastos, shortcut authorization, legal audit, and PQR intake foundations.

## Security advisor observations
- Warning: leaked-password protection is disabled in Supabase Auth.
- Informational: RLS is enabled without policies on five internal tables: `pqr_events`, `pqr_rate_limits`, `pqr_submissions`, `shortcut_authorizations`, and `shortcut_link_codes`. These are intentionally restricted through grants/service-role access in the inspected design; do not add broad client policies merely to silence the advisor.
- Performance advisor reported two unused indexes: `shortcut_authorizations_user_active_idx` and `budget_categories_user_budget_idx`. No index was removed.

## Backup and recovery gate
Backup/PITR configuration and a successful restore drill were not verifiable through the available project inspection tools. Treat recoverability as unverified until the owner confirms the backup plan and a restore test is completed in an isolated destination.

## Staging gate
No Supabase development branch existed at inspection. A branch quote was returned as `0.01344` per hour (currency not stated in the tool response). No branch was created. Obtain explicit owner approval after presenting the quoted recurring cost before creating a branch.

## Required next actions
1. Export or recover the complete SQL source for all 16 production migration versions from authoritative history.
2. Reconcile each version/name and SQL checksum with GitHub; do not fabricate historical migrations from current schema state.
3. Verify backup/PITR retention and complete a restore drill in an isolated destination.
4. Create an isolated Supabase development branch only after cost approval; seed synthetic test users/data, not production personal data.
5. Only then draft and test the additive `platform` schema migration. Preserve current Auth user UUIDs, existing legal and shortcut triggers, Gastos RLS, and current session/recovery behavior.
6. Require regression tests for Gastos login, password recovery, expense CRUD, budget/income, shortcut registration/revocation, and PQR before any production rollout.

## Release decision
**NO-GO for production DDL or deployment.** Architecture documentation may continue. Platform schema implementation remains blocked by migration-history reconciliation, verified recovery, and isolated staging.
