# NOFEKI — snapshot de policies RLS, constraints, índices y ACL efectivas

**Fecha:** 2026-11-07  
**Origen:** catálogo PostgreSQL de producción, solo lectura.  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Cobertura:** 12 tablas públicas. No se consultaron filas de datos de negocio.

## 1. Resumen cuantitativo

- Tablas públicas: 12.
- RLS enabled: 12/12.
- FORCE RLS: 0/12.
- Policies: 24 en 7 tablas; 5 tablas internas sin policies directas.
- Constraints: 64, todas reportadas como validated.
- Índices: 30, todos reportados valid y ready.
- Secuencia pública: `public.legal_acceptance_audit_id_seq`.

## 2. Policies exactas según pg_policies

Todas las policies son PERMISSIVE y TO authenticated.

### budget_categories
- SELECT `Users can view their own budget categories`: USING `(SELECT auth.uid()) = user_id`.
- INSERT `Users can create their own budget categories`: WITH CHECK propietario y EXISTS de budgets con `b.id = budget_categories.budget_id` y `b.user_id = (SELECT auth.uid())`.
- UPDATE `Users can update their own budget categories`: USING propietario; WITH CHECK propietario y EXISTS del budget relacionado del mismo usuario.
- DELETE `Users can delete their own budget categories`: USING propietario.

### budgets
- SELECT `Users can view their own budgets`: USING `(SELECT auth.uid()) = user_id`.
- INSERT `Users can create their own budgets`: WITH CHECK `(SELECT auth.uid()) = user_id`.
- UPDATE `Users can update their own budgets`: USING y WITH CHECK propietario.
- DELETE `Users can delete their own budgets`: USING propietario.

### financial_profiles
- SELECT `Users can view their own financial profile`: USING propietario.
- INSERT `Users can insert their own financial profile`: WITH CHECK propietario.
- UPDATE `Users can update their own financial profile`: USING y WITH CHECK propietario.
- No policy DELETE.

### gastos
- SELECT `Users can view their own expenses`: USING propietario.
- INSERT `Users can insert their own expenses`: WITH CHECK propietario.
- UPDATE `Users can update their own expenses`: USING y WITH CHECK propietario.
- DELETE `Users can delete their own expenses`: USING propietario.

### income_transactions
- SELECT `Users can view own income transactions`: USING propietario.
- INSERT `Users can insert own income transactions`: WITH CHECK propietario.
- UPDATE `Users can update own income transactions`: USING y WITH CHECK propietario.
- DELETE `Users can delete own income transactions`: USING propietario.

### legal_acceptance_audit
- SELECT `Users can view own legal acceptance`: USING propietario.
- No policies INSERT/UPDATE/DELETE.

### user_expense_categories
- SELECT `Users can view own expense categories`: USING propietario.
- INSERT `Users can insert own expense categories`: WITH CHECK propietario.
- UPDATE `Users can update own expense categories`: USING y WITH CHECK propietario.
- DELETE `Users can delete own expense categories`: USING propietario.

### Tablas internas sin policies directas
- `pqr_events`
- `pqr_rate_limits`
- `pqr_submissions`
- `shortcut_authorizations`
- `shortcut_link_codes`

Estas cinco tablas tienen RLS activada y FORCE RLS desactivado. Los grants efectivos revisados limitan el acceso de anon/authenticated y permiten el acceso de backend service_role según la tabla. No añadir policies por defecto: preservar el modelo backend-managed y volver a probarlo en instancia aislada.

## 3. Grants efectivos por rol

Resumen de `has_table_privilege` para SELECT/INSERT/UPDATE/DELETE:

| Tabla | anon | authenticated | service_role |
|---|---|---|---|
| budget_categories | ninguno | CRUD | ninguno |
| budgets | ninguno | CRUD | ninguno |
| financial_profiles | ninguno | SELECT/INSERT/UPDATE | ninguno |
| gastos | ninguno | CRUD | CRUD |
| income_transactions | ninguno | CRUD | ninguno |
| legal_acceptance_audit | ninguno | SELECT | ninguno |
| pqr_events | ninguno | ninguno | CRUD |
| pqr_rate_limits | ninguno | ninguno | CRUD |
| pqr_submissions | ninguno | ninguno | CRUD |
| shortcut_authorizations | ninguno | ninguno | CRUD |
| shortcut_link_codes | ninguno | ninguno, salvo INSERT=false | SELECT/INSERT/UPDATE |
| user_expense_categories | ninguno | CRUD | SELECT |

En `shortcut_link_codes`, service_role tiene SELECT/INSERT/UPDATE pero no DELETE. En `user_expense_categories`, service_role tiene SELECT solamente. No se reportó grant efectivo para anon sobre las 12 tablas.

Los privilegios de owner postgres no se muestran en esta tabla resumida. Esta es la matriz efectiva de las cuatro operaciones consultadas, no un reemplazo de ACL completa (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, grant option).

## 4. Constraints por tabla

Todas las constraints listadas abajo aparecen `convalidated=true`, no deferrable, inicialmente immediate.

### budget_categories (6)
- PK `budget_categories_pkey`: (id)
- FK `budget_categories_budget_owner_fk`: (budget_id,user_id) → budgets(id,user_id), ON DELETE CASCADE
- FK `budget_categories_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- UNIQUE `budget_categories_unique_name`: (budget_id,category_name)
- CHECK `budget_categories_category_name_check`: trim length 1..80
- CHECK `budget_categories_planned_amount_check`: planned_amount >= 0

### budgets (10)
- PK `budgets_pkey`: (id)
- FK `budgets_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- UNIQUE `budgets_id_user_unique`: (id,user_id)
- UNIQUE `budgets_user_period_unique`: (user_id,period_month)
- CHECK `budgets_expense_limit_nonnegative`: expense_limit NULL o >= 0
- CHECK `budgets_income_nonnegative`: income_amount NULL o >= 0
- CHECK `budgets_mode_check`: mode income/manual
- CHECK `budgets_mode_income_fields`: income exige income_amount no NULL; manual exige income_amount NULL y savings_target=0
- CHECK `budgets_period_first_day`: día de period_month = 1
- CHECK `budgets_savings_nonnegative`: savings_target >= 0

### financial_profiles (8)
- PK `financial_profiles_pkey`: (user_id)
- FK `financial_profiles_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- CHECK `financial_profiles_additional_income_monthly_check`: additional_income_monthly >= 0
- CHECK `financial_profiles_income_frequency_check`: monthly/biweekly/weekly/variable
- CHECK `financial_profiles_income_nonnegative`: net_income_amount NULL o > 0
- CHECK `financial_profiles_income_stability_check`: stable/somewhat_variable/highly_variable
- CHECK `financial_profiles_onboarding_status_check`: in_progress/completed
- CHECK `financial_profiles_onboarding_step_check`: onboarding_step 1..6

### gastos (6)
- PK `gastos_pkey`: (id)
- FK `gastos_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- UNIQUE `gastos_user_id_idempotency_key_unique`: (user_id,idempotency_key)
- CHECK `gastos_amount_check`: amount > 0
- CHECK `gastos_expense_type_check`: Necesario/Discrecional/Deuda
- CHECK `gastos_source_check`: web/shortcut/import

### income_transactions (6)
- PK `income_transactions_pkey`: (id)
- FK `income_transactions_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- CHECK `income_transactions_amount_check`: amount > 0
- CHECK `income_transactions_concept_check`: trim length 2..120
- CHECK `income_transactions_note_check`: note NULL o <=500
- CHECK `income_transactions_source_check`: source NULL o <=80

### legal_acceptance_audit (1)
- PK `legal_acceptance_audit_pkey`: (id)

### pqr_events (4)
- PK `pqr_events_pkey`: (id)
- FK `pqr_events_submission_id_fkey`: submission_id → pqr_submissions(id), ON DELETE CASCADE
- CHECK `pqr_events_email_status_check`: NULL/sent/failed/not_configured
- CHECK `pqr_events_event_type_check`: status_changed/internal_note/response_sent/notification_retry

### pqr_rate_limits (3)
- PK `pqr_rate_limits_pkey`: (source_hash)
- CHECK `pqr_rate_limits_hash_format`: 64 lowercase hex
- CHECK `pqr_rate_limits_request_count_check`: request_count >= 0

### pqr_submissions (9)
- PK `pqr_submissions_pkey`: (id)
- UNIQUE `pqr_submissions_reference_code_key`: (reference_code)
- CHECK `pqr_submissions_email_check`: email <=254
- CHECK `pqr_submissions_full_name_check`: trim length 2..120
- CHECK `pqr_submissions_message_check`: trim length 10..5000
- CHECK `pqr_submissions_notification_status_check`: pending/sent/failed/not_configured
- CHECK `pqr_submissions_request_type_check`: Petición/Queja/Reclamo/Sugerencia/Protección de datos/Otra solicitud
- CHECK `pqr_submissions_status_check`: Recibida/En revisión/En gestión/Respondida/Cerrada
- CHECK `pqr_submissions_subject_check`: trim length 3..160

### shortcut_authorizations (3)
- PK `shortcut_authorizations_pkey`: (id)
- UNIQUE `shortcut_authorizations_token_hash_key`: (token_hash)
- FK `shortcut_authorizations_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE

### shortcut_link_codes (3)
- PK `shortcut_link_codes_pkey`: (id)
- UNIQUE `shortcut_link_codes_code_hash_key`: (code_hash)
- FK `shortcut_link_codes_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE

### user_expense_categories (5)
- PK `user_expense_categories_pkey`: (id)
- FK `user_expense_categories_user_id_fkey`: user_id → auth.users(id), ON DELETE CASCADE
- CHECK `user_expense_categories_description_check`: description <=100
- CHECK `user_expense_categories_icon_check`: icon <=8
- CHECK `user_expense_categories_name_check`: trim length 2..40

## 5. Índices exactos (30)

Todas las entradas observadas con `indisvalid=true` y `indisready=true`.

```sql
CREATE INDEX budget_categories_budget_user_fk_idx ON public.budget_categories USING btree (budget_id, user_id);
CREATE UNIQUE INDEX budget_categories_pkey ON public.budget_categories USING btree (id);
CREATE UNIQUE INDEX budget_categories_unique_name ON public.budget_categories USING btree (budget_id, category_name);
CREATE INDEX budget_categories_user_budget_idx ON public.budget_categories USING btree (user_id, budget_id);

CREATE UNIQUE INDEX budgets_id_user_unique ON public.budgets USING btree (id, user_id);
CREATE UNIQUE INDEX budgets_pkey ON public.budgets USING btree (id);
CREATE INDEX budgets_user_period_idx ON public.budgets USING btree (user_id, period_month DESC);
CREATE UNIQUE INDEX budgets_user_period_unique ON public.budgets USING btree (user_id, period_month);

CREATE UNIQUE INDEX financial_profiles_pkey ON public.financial_profiles USING btree (user_id);

CREATE UNIQUE INDEX gastos_pkey ON public.gastos USING btree (id);
CREATE INDEX gastos_user_date_idx ON public.gastos USING btree (user_id, expense_date DESC);
CREATE UNIQUE INDEX gastos_user_id_idempotency_key_unique ON public.gastos USING btree (user_id, idempotency_key);

CREATE UNIQUE INDEX income_transactions_pkey ON public.income_transactions USING btree (id);
CREATE INDEX income_transactions_user_date_idx ON public.income_transactions USING btree (user_id, income_date DESC, id DESC);

CREATE UNIQUE INDEX legal_acceptance_audit_pkey ON public.legal_acceptance_audit USING btree (id);

CREATE UNIQUE INDEX pqr_events_pkey ON public.pqr_events USING btree (id);
CREATE INDEX pqr_events_submission_created_idx ON public.pqr_events USING btree (submission_id, created_at DESC);

CREATE UNIQUE INDEX pqr_rate_limits_pkey ON public.pqr_rate_limits USING btree (source_hash);

CREATE INDEX pqr_submissions_created_at_idx ON public.pqr_submissions USING btree (created_at DESC);
CREATE UNIQUE INDEX pqr_submissions_pkey ON public.pqr_submissions USING btree (id);
CREATE UNIQUE INDEX pqr_submissions_reference_code_key ON public.pqr_submissions USING btree (reference_code);
CREATE INDEX pqr_submissions_source_created_idx ON public.pqr_submissions USING btree (source_hash, created_at DESC);

CREATE UNIQUE INDEX shortcut_authorizations_pkey ON public.shortcut_authorizations USING btree (id);
CREATE UNIQUE INDEX shortcut_authorizations_token_hash_key ON public.shortcut_authorizations USING btree (token_hash);
CREATE INDEX shortcut_authorizations_user_active_idx ON public.shortcut_authorizations USING btree (user_id, created_at DESC) WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX shortcut_link_codes_code_hash_key ON public.shortcut_link_codes USING btree (code_hash);
CREATE UNIQUE INDEX shortcut_link_codes_pkey ON public.shortcut_link_codes USING btree (id);
CREATE INDEX shortcut_link_codes_user_created_idx ON public.shortcut_link_codes USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX user_expense_categories_pkey ON public.user_expense_categories USING btree (id);
CREATE UNIQUE INDEX user_expense_categories_user_name_unique ON public.user_expense_categories USING btree (user_id, lower(name));
```

## 6. Secuencia pública

- `public.legal_acceptance_audit_id_seq`
- Owner: postgres
- Tipo: bigint
- START 1, INCREMENT 1, MIN 1, MAX 9223372036854775807
- CACHE 1, NO CYCLE
- No se consultó ni se documentó el valor actual (last_value), porque es estado de datos y no necesario para el snapshot estructural.
- `auth.refresh_tokens_id_seq` pertenece a `supabase_auth_admin`; infraestructura gestionada de Auth, no recrear manualmente.

## 7. Límites de interpretación

1. RLS enabled no significa que una tabla sea accesible vía API: GRANT y RLS son controles distintos.
2. Las cinco tablas internas sin policies directas están diseñadas para service_role. Validar que las Edge Functions mantengan su autenticación propia y no expongan el service_role.
3. Los privilegios de servicio no deben ampliarse por comodidad.
4. La matriz anterior cubre SELECT/INSERT/UPDATE/DELETE efectivos; ACL completa también puede contener TRUNCATE, REFERENCES, TRIGGER y MAINTAIN.
5. No se ha restaurado ni probado ningún objeto. Esto es evidencia de catálogo actual, no garantía de recuperación.
