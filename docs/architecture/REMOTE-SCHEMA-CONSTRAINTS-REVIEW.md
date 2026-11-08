# NOFEKI — Remote Schema Columns and Constraints Review

**Inspection:** read-only PostgreSQL catalog queries  
**Project:** `bxjgodhqseoxrnshqtfr`  
**Date:** 2026-11-07  
**Production changes:** none

## Scope

Inspected column metadata and table constraints for the 12 inventoried application tables in `public`: columns, data types, nullability, defaults, primary keys, unique constraints, foreign keys, and CHECK constraints.

This document summarizes structural findings. The database remains the source of truth until a reviewed schema snapshot is generated and compared locally.

## Relationship map

- `gastos.user_id` → `auth.users.id` (cascade delete)
- `budgets.user_id` → `auth.users.id` (cascade delete)
- `budget_categories.user_id` → `auth.users.id` (cascade delete)
- `budget_categories(budget_id,user_id)` → `budgets(id,user_id` (cascade delete), enforcing that a category belongs to the same user as its budget
- `financial_profiles.user_id` → `auth.users.id` (cascade delete)
- `income_transactions.user_id` → `auth.users.id` (cascade delete)
- `shortcut_authorizations.user_id` → `auth.users.id` (cascade delete)
- `shortcut_link_codes.user_id` → `auth.users.id` (cascade delete)
- `user_expense_categories.user_id` → `auth.users.id` (cascade delete)
- `pqr_events.submission_id` → `pqr_submissions.id` (cascade delete)

The legal audit table is linked to user identity by its `user_id` field and trigger write path; no FK appeared in the inspected constraint output.

## Structural rules observed

### Gastos
- Amount must be greater than zero.
- Expense type is constrained to `Necesario`, `Discrecional`, or `Deuda`.
- Source is constrained to `web`, `shortcut`, or `import`.
- A unique per-user idempotency key is present.
- Date defaults to current date; creation timestamp defaults to now.

### Budgets
- One budget per user and month.
- Month date must be the first day of the month.
- Mode is `income` or `manual`.
- Income, expense limit, and savings target are constrained non-negative where present.
- Income mode requires income amount; manual mode requires null income amount and zero savings target.
- The database CHECK allows a nullable expense limit, while the `save_monthly_budget` RPC currently rejects a null expense limit. This difference is noted for future consistency review; no change is proposed.

### Budget categories
- Category name is trimmed and constrained to 1–80 characters.
- Planned amount must be non-negative.
- Unique category name per budget.
- Composite foreign key ties budget and user ownership together.

### Financial profile
- Income frequency constrained to `monthly`, `biweekly`, `weekly`, or `variable`.
- Income stability constrained to `stable`, `somewhat_variable`, or `highly_variable`.
- Onboarding status constrained to `in_progress` or `completed`.
- Onboarding step constrained to 1–6.
- Additional income must be non-negative; net income, if present, must be positive.

### Income transactions
- Amount greater than zero.
- Concept length 2–120 characters after trimming.
- Optional source max 80 characters; optional note max 500.
- User ownership FK to Auth.

### PQR
- Request type and status are constrained to explicit Spanish-language enumerations.
- Name, subject, message, and email lengths are bounded.
- Notification status is constrained to `pending`, `sent`, `failed`, or `not_configured`.
- PQR event types and email statuses are constrained.
- Rate-limit source hash must be 64 lowercase hexadecimal characters; request count cannot be negative.

### Shortcut
- Authorization token hash and link-code hash have unique constraints.
- Both authorization and link-code rows reference Auth users.
- Authorization includes device name, creation, revocation, last-use, and expiry timestamps.
- Link codes include creation, expiry, and used timestamps.

### User expense categories
- Name length 2–40 characters after trimming.
- Icon max 8 characters; description max 100.
- Unique case-insensitive category name per user.

## Follow-up checks

Before producing a baseline:
1. Inspect identity/sequence metadata for `legal_acceptance_audit.id` and any other generated columns.
2. Inspect all column-level identity/generated flags, collations, and comments.
3. Capture exact view/materialized-view definitions if any exist outside the 12-table inventory.
4. Capture schema and default privileges, plus function-level ACLs including inherited PUBLIC privileges.
5. Verify all constraints are validated and all indexes remain valid in the target snapshot.
6. Compare the resulting snapshot with each recoverable migration file; do not invent missing historical SQL.

## Decision

This is an observational inventory, not a migration file. Do not apply it to production. Keep the production database unchanged until migration history, backups, and a separate test environment are reconciled.
