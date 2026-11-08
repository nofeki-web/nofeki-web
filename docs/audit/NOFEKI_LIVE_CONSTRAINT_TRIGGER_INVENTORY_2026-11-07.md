# NOFEKI Live Constraint and Trigger Attachment Inventory

**Captured:** 2026-11-07  
**Source:** read-only PostgreSQL catalog inspection in project `bxjgodhqseoxrnshqtfr`  
**Branch:** `recovery/pqr-admin-retry-fix-20261108`  
**Production impact:** none. SELECT-only catalog queries.

## Confirmed cross-schema trigger

The focused catalog query confirms:

```sql
CREATE TRIGGER nofeki_capture_legal_acceptance
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION capture_nofeki_legal_acceptance();
```

The routine is `public.capture_nofeki_legal_acceptance()`. Its live definition was captured in `NOFEKI_POSTGRES_CATALOG_RECOVERY_SNAPSHOT_2026-11-07.md`. This closes the previous open question about the legal-audit trigger attachment.

## Constraints observed in the live public schema

### budget_categories
- PK `budget_categories_pkey` on `id`
- FK `budget_categories_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- Composite FK `budget_categories_budget_owner_fk`: `(budget_id,user_id) -> budgets(id,user_id) ON DELETE CASCADE`
- Unique `budget_categories_unique_name`: `(budget_id,category_name)`
- CHECK category name trimmed length 1–80
- CHECK planned amount >= 0

### budgets
- PK `budgets_pkey` on `id`
- FK `budgets_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- Unique `budgets_id_user_unique`: `(id,user_id)`
- Unique `budgets_user_period_unique`: `(user_id,period_month)`
- CHECK mode in `income|manual`
- CHECK period is first day of month
- CHECK income and savings nonnegative
- CHECK income mode requires income amount; manual mode requires null income and zero savings
- CHECK expense limit null or nonnegative

### financial_profiles
- PK `financial_profiles_pkey` on `user_id`
- FK `financial_profiles_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- CHECK income frequency in `monthly|biweekly|weekly|variable`
- CHECK income stability in `stable|somewhat_variable|highly_variable`
- CHECK onboarding status in `in_progress|completed`
- CHECK onboarding step 1–6
- CHECK net income null or > 0; additional income >= 0

### gastos
- PK `gastos_pkey` on `id`
- FK `gastos_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- Unique `gastos_user_id_idempotency_key_unique`: `(user_id,idempotency_key)`
- CHECK amount > 0
- CHECK expense type in `Necesario|Discrecional|Deuda`
- CHECK source in `web|shortcut|import`

### income_transactions
- PK `income_transactions_pkey` on `id`
- FK `income_transactions_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- CHECK amount > 0
- CHECK trimmed concept length 2–120
- CHECK note null or <= 500 chars
- CHECK source null or <= 80 chars

### legal_acceptance_audit
- PK `legal_acceptance_audit_pkey` on `id`
- No additional public-schema constraints were returned by this catalog query.

### pqr_events
- PK `pqr_events_pkey` on `id`
- FK `pqr_events_submission_id_fkey`: `submission_id -> pqr_submissions(id) ON DELETE CASCADE`
- CHECK event type in `status_changed|internal_note|response_sent|notification_retry`
- CHECK email status null or in `sent|failed|not_configured`

### pqr_rate_limits
- PK `pqr_rate_limits_pkey` on `source_hash`
- CHECK source hash matches lowercase 64-character hexadecimal
- CHECK request count >= 0

### pqr_submissions
- PK `pqr_submissions_pkey` on `id`
- Unique `pqr_submissions_reference_code_key` on `reference_code`
- CHECK request type in `Petición|Queja|Reclamo|Sugerencia|Protección de datos|Otra solicitud`
- CHECK status in `Recibida|En revisión|En gestión|Respondida|Cerrada`
- CHECK notification status in `pending|sent|failed|not_configured`
- CHECK full name trimmed length 2–120
- CHECK subject trimmed length 3–160
- CHECK message trimmed length 10–5000
- CHECK email <= 254 chars

### shortcut_authorizations
- PK `shortcut_authorizations_pkey` on `id`
- FK `shortcut_authorizations_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- Unique `shortcut_authorizations_token_hash_key` on `token_hash`

### shortcut_link_codes
- PK `shortcut_link_codes_pkey` on `id`
- FK `shortcut_link_codes_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- Unique `shortcut_link_codes_code_hash_key` on `code_hash`

### user_expense_categories
- PK `user_expense_categories_pkey` on `id`
- FK `user_expense_categories_user_id_fkey`: `user_id -> auth.users(id) ON DELETE CASCADE`
- CHECK name trimmed length 2–40
- CHECK description <= 100 chars
- CHECK icon <= 8 chars

## Reconciliation notes

- Catalog inspection confirms the key budget ownership composite FK, which aligns with the two-column ownership design.
- `budget_categories_budget_user_fk_idx` remains present and should be preserved; its repository migration origin is still untraced.
- Constraints listed here are live catalog facts. They are not a recommendation to recreate them verbatim without checking migration history, table definitions, and existing data.
- The legal acceptance trigger attachment is now confirmed; the remaining work is exact ACL reconciliation and migration-to-live definition comparison.

## Next steps
1. Compare each constraint with the repository migration files and note migration provenance.
2. Capture exact routine ACLs from `pg_proc.proacl` and `has_function_privilege` for anon, authenticated, service_role, and PUBLIC.
3. Build a restore dependency order, but keep it as non-executable documentation until an isolated database is available and an explicit restoration plan is approved.

**This file is documentation only. No executable SQL restore script is provided.**