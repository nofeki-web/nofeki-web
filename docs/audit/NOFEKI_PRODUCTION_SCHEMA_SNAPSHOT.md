# NOFEKI — Snapshot del esquema de producción

**Fecha de inspección:** 2026-11-07  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Fuente:** catálogo PostgreSQL consultado en modo lectura.  
**Advertencia:** snapshot descriptivo del estado actual; no es una migración ni un backup restaurable.

## Tablas public

Las 12 tablas encontradas tienen RLS habilitado y FORCE RLS deshabilitado.

| Tabla | Columnas (resumen) |
|---|---|
| budget_categories | id, budget_id, user_id, category_name, planned_amount, created_at |
| budgets | id, user_id, period_month, mode, income_amount, expense_limit, savings_target, created_at, updated_at |
| financial_profiles | user_id, net_income_amount, income_frequency, has_additional_income, additional_income_monthly, income_stability, onboarding_step, onboarding_status, updated_at |
| gastos | id, user_id, expense_date, description, category, amount, expense_type, payment_method, note, source, idempotency_key, created_at |
| income_transactions | id, user_id, income_date, concept, source, amount, note, created_at, updated_at |
| legal_acceptance_audit | id, user_id, terms_version, terms_accepted_at, privacy_version, privacy_authorized_at, created_at |
| pqr_events | id, submission_id, actor_email, event_type, old_status, new_status, note, response, email_status, created_at |
| pqr_rate_limits | source_hash, window_started_at, request_count, updated_at |
| pqr_submissions | id, reference_code, request_type, full_name, email, subject, message, attachment_path, status, privacy_version, consented_at, source_hash, created_at, notification_status, notification_error, notification_sent_at, responded_at, updated_at |
| shortcut_authorizations | id, user_id, token_hash, device_name, created_at, revoked_at, last_used_at, expires_at |
| shortcut_link_codes | id, user_id, code_hash, device_name, created_at, expires_at, used_at |
| user_expense_categories | id, user_id, name, icon, description, created_at, updated_at |

## Constraints y relaciones destacadas

- Datos de usuario enlazados a `auth.users(id)` con `ON DELETE CASCADE` en tablas de gastos, ingresos, perfiles, presupuestos, categorías y autorizaciones.
- `budgets`: único por usuario/mes; el mes debe iniciar el día 1; modo `income` o `manual`; montos no negativos; modo manual exige `income_amount IS NULL` y ahorro objetivo 0.
- `budget_categories`: FK compuesta `(budget_id,user_id)` hacia `budgets(id,user_id)`; único por presupuesto/categoría; monto planeado >= 0.
- `gastos`: monto > 0; tipo en Necesario/Discrecional/Deuda; origen en web/shortcut/import; clave idempotente única por usuario.
- `income_transactions`: monto > 0; concepto de 2 a 120 caracteres; nota hasta 500; fuente hasta 80.
- PQR: referencia única, estados y tipos restringidos; eventos enlazados a la solicitud; rate limit usa hash SHA-256 en minúsculas hexadecimales.
- Atajos: token_hash y code_hash únicos; autorizaciones/códigos asociados a auth.users.

## Índices observados

- `gastos`: PK, índice usuario/fecha descendente e índice único usuario/idempotency_key.
- `budgets`: PK, índice usuario/periodo e índice único usuario/periodo.
- `budget_categories`: PK y unicidad presupuesto/categoría.
- `income_transactions`: PK e índice usuario/fecha/ID.
- `financial_profiles`: PK por user_id.
- `user_expense_categories`: PK e índice único usuario/lower(name).
- PQR: PK, referencia única, índices de creación, origen/fecha y submission/fecha.
- Atajos: PK, token hash único, índice parcial de autorizaciones no revocadas y code hash único.

## RLS y acceso

- Las tablas de uso directo por el usuario tienen políticas de propiedad basadas en `(select auth.uid()) = user_id`.
- `budget_categories` también valida que el presupuesto relacionado pertenezca al usuario.
- `legal_acceptance_audit` solo tiene política SELECT de propietario; inserción ocurre por función trigger.
- `pqr_events`, `pqr_rate_limits`, `pqr_submissions`, `shortcut_authorizations` y `shortcut_link_codes` no tienen políticas directas; el acceso de aplicación está diseñado para rutas privilegiadas del servidor. No exponer service_role al cliente.
- La tabla de categorías personales da CRUD a authenticated con políticas de propietario; service_role tiene SELECT.
- Grants heredados como REFERENCES/TRIGGER no equivalen a permiso de leer/modificar filas; RLS sigue aplicando.

## Funciones públicas y triggers

Funciones encontradas:
- `capture_nofeki_legal_acceptance()`: SECURITY DEFINER, search_path vacío; captura metadata de consentimiento en auditoría. No debe usarse metadata editable por usuario como autorización.
- `enforce_single_active_shortcut_authorization()`: SECURITY DEFINER; revoca otras autorizaciones activas al insertar una nueva.
- `issue_shortcut_authorization(uuid,text,text,timestamptz)`: valida parámetros, toma advisory lock por usuario, limpia expiradas y emite autorización si no hay otra activa. SECURITY INVOKER.
- `pqr_consume_rate_limit(text,integer,integer)`: incrementa contador de forma atómica y devuelve si sigue bajo límite. SECURITY INVOKER.
- `save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)`: exige auth.uid(), valida periodo/modo/importes/categorías y reemplaza presupuesto/categorías en una transacción. SECURITY INVOKER.
- `rls_auto_enable()`: función SECURITY DEFINER para activar RLS en tablas nuevas de public; revisar su trigger de evento y propietario en una inspección específica.

Trigger de tabla confirmado:
- `trg_single_active_shortcut_authorization`: AFTER INSERT en `shortcut_authorizations`, ejecuta `enforce_single_active_shortcut_authorization()`.

Privilegios EXECUTE observados:
- `save_monthly_budget`: authenticated.
- `issue_shortcut_authorization` y `pqr_consume_rate_limit`: service_role.
- Funciones trigger: postgres.
No se observó EXECUTE concedido a anon para estas funciones.

## Storage PQR

- Bucket `pqr-attachments`: privado, límite 5 MiB, MIME permitidos PDF/JPEG/PNG.
- `storage.objects`: RLS habilitado; cero políticas encontradas.
- Aunque los grants generales de storage.objects incluyen anon/authenticated, la ausencia de políticas con RLS activo bloquea el acceso directo normal. El flujo esperado debe pasar por Edge Function privilegiada y enlaces firmados de corta duración.
- Confirmar en prueba controlada que subida y lectura administrativa se realizan solo por los flujos previstos; no cambiar policies en esta reconciliación.

## Edge Functions activas en producción

| Función | Versión | verify_jwt |
|---|---:|---|
| registrar-gasto-atajo | 9 | false |
| crear-token-atajo | 7 | true |
| gestionar-atajos | 7 | false |
| categorias-atajo | 9 | false |
| crear-codigo-vinculacion-atajo | 3 | true |
| canjear-codigo-vinculacion-atajo | 4 | false |
| pqr-submit | 6 | false |
| pqr-admin | 9 | false |

`verify_jwt=false` no es por sí solo un fallo: requiere revisar autenticación explícita implementada por cada función. Las versiones listadas corresponden al inventario remoto del momento de consulta; no se desplegó ninguna función.

## Límites de este snapshot

- No incluye datos de negocio ni datos personales.
- No es un dump completo ni incluye objetos de esquemas internos fuera del alcance.
- No sustituye un backup ni la exportación de configuración Auth/Storage.
- No afirma equivalencia histórica con las migraciones originales.
