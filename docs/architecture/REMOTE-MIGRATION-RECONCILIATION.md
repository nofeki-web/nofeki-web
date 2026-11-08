# NOFEKI — Reconciliación de migraciones remotas y GitHub

**Fecha de inspección:** 2026-11-07  
**Proyecto Supabase:** `bxjgodhqseoxrnshqtfr`  
**Rama de trabajo:** `architecture/nofeki-platform-foundation`  
**Alcance:** inspección de solo lectura. No se ejecutó DDL, no se aplicaron migraciones y no se desplegó código.

## 1. Resultado ejecutivo

El historial remoto de `supabase_migrations.schema_migrations` contiene **16 versiones**, mientras que el repositorio contiene solamente **3 archivos SQL** en `supabase/migrations/` en las ramas revisadas. Por tanto, el repositorio no es hoy una representación reproducible y completa del estado de producción.

Los tres archivos versionados recuperados son:
- `20261104000100_create_monthly_budgets.sql`
- `20261105000100_create_income_transactions.sql`
- `20261107120000_pqr_management_workflow.sql`

Los tres archivos fueron leídos completos desde la rama de arquitectura. No se debe concluir que sus nombres o contenidos equivalen a las 16 entradas del ledger remoto. Tampoco se deben fabricar archivos históricos para completar los huecos.

## 2. Ledger remoto observado

Las 16 versiones registradas remotamente son:

| Versión | Nombre |
|---|---|
| 20261018201105 | tighten_gastos_and_function_privileges |
| 20261018201138 | optimize_legal_audit_rls_policy |
| 20261019020006 | create_financial_profiles_for_onboarding |
| 20261019021147 | user_expense_categories |
| 20261019021929 | grant_user_expense_categories_access |
| 20261022024849 | add_shortcut_authorization_expiration |
| 20261022040313 | enforce_single_active_shortcut_authorization |
| 20261024194051 | grant_service_role_select_user_expense_categories |
| 20261024220845 | revoke_unneeded_table_privileges |
| 20261025152720 | shortcut_link_codes |
| 20261105033355 | create_monthly_budgets |
| 20261105033443 | atomic_monthly_budget_save |
| 20261105033850 | create_income_transactions |
| 20261107160355 | create_secure_pqr_intake |
| 20261107161429 | pqr_management_workflow |
| 20261107171359 | pqr_atomic_rate_limiting |

El ledger registra versiones que no tienen un archivo SQL histórico correspondiente en el repositorio actual. En especial, la función atómica `save_monthly_budget` existe remotamente, pero no está definida en el archivo de creación de presupuestos recuperado.

## 3. Comparación por artefacto

### Presupuestos

El archivo versionado crea `budgets` y `budget_categories`, restricciones, índices, RLS, políticas y grants. La inspección remota confirma que ambas tablas existen con columnas y defaults compatibles con lo esencial del archivo.

Diferencia importante: en producción, `save_monthly_budget(p_period_month, p_mode, p_income_amount, p_expense_limit, p_savings_target, p_categories)` también existe. La función valida autenticación, periodo, modalidad, importes y categorías, y realiza upsert del presupuesto más reemplazo de categorías dentro de una transacción. Esa definición no aparece en el archivo `create_monthly_budgets.sql`. No asumir que el archivo por sí solo reconstruye el comportamiento remoto.

Se observa una diferencia deliberada o pendiente de aclarar: `budgets.expense_limit` admite NULL a nivel de tabla, mientras que `save_monthly_budget` rechaza NULL. No cambiarla hasta revisar el contrato de aplicación y los casos históricos.

### Ingresos

El archivo `create_income_transactions.sql` define la tabla, índice, RLS, políticas y grants. La estructura remota inspeccionada coincide con las columnas, tipos y defaults esperados en ese archivo. Aún se requiere comparar definiciones completas de índices, constraints, políticas y grants antes de certificar equivalencia exacta.

### PQR

El archivo `pqr_management_workflow.sql` actualiza el constraint de estado, añade campos de notificación/respuesta, crea `pqr_events`, índice, RLS y grants. La inspección remota confirma las columnas relevantes de `pqr_submissions` y `pqr_events`.

Sin embargo, el ledger remoto también registra `create_secure_pqr_intake` y `pqr_atomic_rate_limiting`, mientras que el repositorio no contiene esos archivos históricos. La tabla `pqr_rate_limits` y la función `pqr_consume_rate_limit` existen remotamente. La migración versionada de PQR workflow no constituye por sí sola una reconstrucción completa de la implementación PQR.

## 4. Objetos remotos de los que se recuperó definición

La inspección de solo lectura recuperó definiciones de estas funciones:
- `capture_nofeki_legal_acceptance()`
- `enforce_single_active_shortcut_authorization()`
- `issue_shortcut_authorization(...)`
- `pqr_consume_rate_limit(...)`
- `rls_auto_enable()`
- `save_monthly_budget(...)`

Y de estos triggers:
- `auth.users.nofeki_capture_legal_acceptance`
- `public.shortcut_authorizations.trg_single_active_shortcut_authorization`

No se deben reemplazar ni recrear a ciegas. El trigger de aceptación legal está vinculado al flujo existente de consentimiento y debe preservarse.

## 5. Riesgos de reconciliación

1. **Falsa reproducibilidad:** ejecutar solo los tres archivos del repositorio no recrearía todos los objetos ni permisos presentes en producción.
2. **Historial fabricado:** crear migraciones retroactivas con fechas/nombres inferidos puede falsear el ledger y dificultar futuras migraciones.
3. **Doble aplicación:** las tablas y parte de las políticas de los tres archivos ya existen en producción; volver a ejecutar DDL sin comparar estado puede fallar o producir divergencias.
4. **Pérdida de comportamiento:** omitir funciones, triggers, grants o restricciones puede dejar tablas presentes pero flujos incompletos.
5. **Riesgo operativo:** no hay todavía una restauración ensayada ni un entorno local levantado para probar la reconstrucción.

## 6. Plan seguro recomendado

### Fase A — completar la captura (solo lectura)
- Obtener un dump SQL de esquema remoto con Supabase CLI una vez disponible un entorno local compatible.
- Capturar vistas, funciones, triggers, políticas, grants, constraints, índices, secuencias, comentarios y event triggers.
- Comparar los tres SQL versionados contra los objetos remotos por definición, no solo por nombre.
- Revisar los cambios del frontend/Edge Functions que dependen de cada RPC y tabla.

### Fase B — establecer una línea base reproducible
- Guardar un snapshot identificado explícitamente como **baseline del estado observado**, no como reconstrucción histórica.
- Mantener las 16 versiones del ledger como evidencia de producción.
- Definir una estrategia de reconciliación de migraciones hacia adelante, con una migración de baseline controlada y validada fuera de producción.
- No marcar versiones como aplicadas ni alterar el ledger hasta que exista un plan probado y aprobado.

### Fase C — entorno aislado y regresión
- Levantar Supabase local con Docker/CLI.
- Restaurar el baseline en local.
- Ejecutar pruebas de login, Gastos web, registro/eliminación, presupuesto, ingresos, Shortcut (vinculación, registro, revocación), PQR y permisos.
- Validar respaldo y procedimiento de restauración antes de cualquier cambio de producción.

### Fase D — arquitectura NOFEKI Platform
- Implementar el esquema privado `platform` solo después de que el baseline sea reproducible y las pruebas pasen.
- Mantener Supabase Auth existente y UUID de usuarios.
- Introducir el portal universal y licencias sin cambiar la experiencia ni los datos actuales de Gastos.
- Mantener cambios de identidad/acceso separados de los cambios de negocio de Gastos.

## 7. Decisión de seguridad

**No ejecutar por ahora:** `supabase db push`, `db reset`, `migration repair`, DDL directo, cambios de RLS/grants, despliegues o merges a `main`.

**Estado:** reconciliación parcial documentada; la captura SQL integral y la prueba local siguen pendientes. La producción no fue modificada en esta fase.
