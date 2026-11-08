# NOFEKI database recovery notes — 2026-11-08

## Scope and safety

This branch is an isolated, free GitHub working branch. No Supabase branch was created, no database migration was applied, and no Edge Function was deployed. Production remains unchanged.

## Migration reconciliation

The live Supabase project reports 16 migrations. The current `main` branch contains three SQL migration files whose intent matches live migration names, but whose timestamps differ:

| Live migration | Repository file |
|---|---|
| `20261105033355 create_monthly_budgets` | `20261104000100_create_monthly_budgets.sql` |
| `20261105033850 create_income_transactions` | `20261105000100_create_income_transactions.sql` |
| `20261107161429 pqr_management_workflow` | `20261107120000_pqr_management_workflow.sql` |

The following 13 live migration entries do not have corresponding files in the current `main` migration directory:

- `20261018201105 tighten_gastos_and_function_privileges`
- `20261018201138 optimize_legal_audit_rls_policy`
- `20261019020006 create_financial_profiles_for_onboarding`
- `20261019021147 user_expense_categories`
- `20261019021929 grant_user_expense_categories_access`
- `20261022024849 add_shortcut_authorization_expiration`
- `20261022040313 enforce_single_active_shortcut_authorization`
- `20261024194051 grant_service_role_select_user_expense_categories`
- `20261024220845 shortcut_link_codes`
- `20261025152720 revoke_unneeded_table_privileges`
- `20261105033443 atomic_monthly_budget_save`
- `20261107160355 create_secure_pqr_intake`
- `20261107171359 pqr_atomic_rate_limiting`

This is a statement about the current `main` migration directory only. It does not prove that the SQL files never existed in another branch, local checkout, backup, or earlier artifact. The SQL text cannot be recovered exactly from the migration history table alone.

## Recovery rules

1. Do not mark missing migrations as applied or edit the remote migration history to force alignment.
2. Do not replay reconstructed SQL against production.
3. Treat catalog-derived SQL as a snapshot of current objects, not as the original historical migration.
4. Before any future production migration, compare the proposed DDL with live catalog state and make it idempotent where appropriate.
5. Preserve the existing live schema and data; test in a free local PostgreSQL environment when a suitable computer is available.

## PQR admin function patch

The file `supabase/functions/pqr-admin/index.ts` in this branch is synchronized from the currently deployed v9 function. The `retry_notification` action now checks and throws on errors from both:
- updating `pqr_submissions` notification fields;
- inserting the `pqr_events` audit event.

This prevents the handler from returning `ok: true` when persistence fails. It still uses the existing safe top-level error response. This patch is not deployed and requires review and functional testing before deployment.

## Additional audit items (not changed)

- Leaked-password protection is disabled in Supabase Auth; enable only after reviewing and testing signup/password recovery.
- Five service-managed tables have RLS enabled with no direct policies: `pqr_events`, `pqr_rate_limits`, `pqr_submissions`, `shortcut_authorizations`, `shortcut_link_codes`. Validate all service-role call paths and ensure the service key is never exposed client-side.
- Two indexes were reported unused by the advisor. Do not remove them without workload/plan validation.
- Review the `x-real-ip` fallback used for PQR rate-limit identity if requests can bypass the expected proxy path.
- Review the wildcard CORS origin in `categorias-atajo` without breaking iOS Shortcuts token-based calls.

## Verified state

- Supabase project status: active/healthy at audit time.
- Production Edge Function `pqr-admin`: v9 at audit time.
- GitHub branch: `recovery/pqr-admin-retry-fix-20261108`.
- Deployment: none.
- Database writes: none.
