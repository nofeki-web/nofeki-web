# NOFEKI — Reconciliación de definiciones vivas contra migraciones versionadas

**Fecha:** 2026-11-07  
**Repositorio:** `nofeki-web/nofeki-web`  
**Rama inspeccionada:** `recovery/pqr-admin-retry-fix-20261108`  
**Proyecto Supabase:** `bxjgodhqseoxrnshqtfr`  
**Método:** lectura de los tres archivos SQL versionados, comparación con inventarios previos y consultas SELECT al catálogo PostgreSQL.  
**Seguridad:** no se ejecutó SQL de escritura, DDL, DML, migraciones ni despliegues.

## 1. Resultado ejecutivo

La carpeta `supabase/migrations/` de la rama inspeccionada contiene tres archivos:

1. `20261104000100_create_monthly_budgets.sql`
2. `20261105000100_create_income_transactions.sql`
3. `20261107120000_pqr_management_workflow.sql`

El historial remoto inspeccionado tiene 16 versiones. Trece no tienen archivo original localizado en las ramas revisadas; tres tienen candidatos funcionales en GitHub con timestamp/nombre distintos.

**Conclusión:** los tres archivos son referencias estructurales útiles, pero ninguno debe tratarse como exportación completa del estado vivo ni ejecutarse para “poner al día” producción. Las 13 migraciones faltantes siguen siendo clasificación D (original no localizado), aunque sus efectos se observan total o parcialmente en el catálogo.

## 2. Reconciliación por migración equivalente

### A. Presupuestos

**Historial remoto:** `20261105033355 create_monthly_budgets`  
**Archivo candidato:** `20261104000100_create_monthly_budgets.sql`

Coincidencias verificadas:
- Crea `public.budgets` y `public.budget_categories`.
- La estructura de columnas coincide con el snapshot de producción revisado.
- Coinciden las restricciones de modo, periodo, importes, unicidad por usuario/mes y FK compuesta `(budget_id,user_id) -> budgets(id,user_id)`.
- Coinciden los índices `budgets_user_period_idx` y `budget_categories_user_budget_idx`.
- Incluye RLS y políticas CRUD por propietario para ambas tablas.

Diferencias / elementos no explicados por este archivo:
- Producción tiene además `budget_categories_budget_user_fk_idx` sobre `(budget_id,user_id)`; no aparece en el archivo de migración y su procedencia sigue sin atribuirse.
- Producción tiene la función `public.save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)`, con EXECUTE para authenticated. No está definida en este archivo. Su origen corresponde al historial remoto `20261105033443 atomic_monthly_budget_save`, cuyo SQL original no está en las ramas inspeccionadas.
- La existencia de la función y del índice adicional demuestra que el archivo no representa por sí solo el estado final de producción.

**Clasificación:** equivalente estructural parcial; no identidad histórica ni migración completa.

### B. Ingresos

**Historial remoto:** `20261105033850 create_income_transactions`  
**Archivo candidato:** `20261105000100_create_income_transactions.sql`

Coincidencias verificadas:
- Columnas, tipos funcionales y restricciones de importe, concepto, fuente y nota coinciden con el snapshot de producción.
- Coincide el índice `income_transactions_user_date_idx` sobre `(user_id,income_date DESC,id DESC)`.
- Incluye RLS, políticas CRUD para authenticated y grants de tabla para authenticated.
- El índice de producción coincide con la definición del archivo.

No se identificó una divergencia estructural concreta en el objeto `income_transactions` con la evidencia consultada. Esto no prueba que el SQL sea byte a byte el original remoto: los timestamps difieren y el historial fuente no fue recuperado.

**Clasificación:** equivalencia estructural alta para la tabla/índice/políticas revisados; identidad histórica no demostrada.

### C. Flujo de PQR

**Historial remoto:** `20261107161429 pqr_management_workflow`  
**Archivo candidato:** `20261107120000_pqr_management_workflow.sql`

Coincidencias verificadas:
- Actualiza el constraint de estados de `pqr_submissions` a los cinco estados observados en producción.
- Añade campos de notificación, respuesta y actualización que aparecen en producción.
- Crea `pqr_events`, su FK a `pqr_submissions`, checks de tipo/estado de correo e índice `pqr_events_submission_created_idx`.
- Revoca acceso directo de anon/authenticated a `pqr_events` y `pqr_submissions`, y concede acceso a service_role, coherente con el diseño revisado.

Elementos de PQR que no explica este archivo:
- La tabla `pqr_rate_limits`, su PK/hash check y la función `pqr_consume_rate_limit(text,integer,integer)` se relacionan con la migración remota faltante `20261107171359 pqr_atomic_rate_limiting`.
- La creación segura de intake y parte de los objetos de `pqr_submissions`/rate limiting se relacionan con `20261107160355 create_secure_pqr_intake`, cuyo SQL original no fue localizado.
- Índices de producción `pqr_submissions_created_at_idx` y `pqr_submissions_source_created_idx` no se crean en el archivo PQR workflow revisado; deben atribuirse a la migración de intake u otra fuente histórica antes de declararlos reconciliados.
- Las diferencias de código observadas entre versiones desplegadas de Edge Functions PQR no se resuelven con esta migración de esquema; se documentan en la revisión de Edge Functions.

**Clasificación:** equivalente parcial del workflow; no cubre el subsistema completo de intake/rate limit.

## 3. Migraciones sin fuente original y objetos relacionados

Las siguientes 13 versiones remotas continúan sin archivo SQL original localizado en las ramas inspeccionadas. Las asociaciones de la columna final son inferencias de alcance basadas en nombres y catálogo, no equivalencias de SQL original.

| Versión remota | Nombre | Objetos/efectos relacionados observados | Estado |
|---|---|---|---|
| 20261018201105 | tighten_gastos_and_function_privileges | Privilegios de tablas y funciones; historial de restricciones de acceso | D — fuente no localizada |
| 20261018201138 | optimize_legal_audit_rls_policy | RLS/política de `legal_acceptance_audit` | D — fuente no localizada |
| 20261019020006 | create_financial_profiles_for_onboarding | Tabla `financial_profiles` y checks de onboarding | D — fuente no localizada |
| 20261019021147 | user_expense_categories | Tabla e índice único funcional de categorías | D — fuente no localizada |
| 20261019021929 | grant_user_expense_categories_access | Grants de categorías personales | D — fuente no localizada |
| 20261022024849 | add_shortcut_authorization_expiration | Columna/validación de expiración de autorizaciones | D — fuente no localizada |
| 20261022040313 | enforce_single_active_shortcut_authorization | Función y trigger de autorización única activa | D — fuente no localizada |
| 20261024194051 | grant_service_role_select_user_expense_categories | SELECT de service_role sobre categorías | D — fuente no localizada |
| 20261024220845 | shortcut_link_codes | Tabla, índices y constraints de códigos de vinculación | D — fuente no localizada |
| 20261025152720 | revoke_unneeded_table_privileges | Revocación de privilegios no requeridos | D — fuente no localizada |
| 20261105033443 | atomic_monthly_budget_save | Función `save_monthly_budget` y EXECUTE authenticated | D — fuente no localizada |
| 20261107160355 | create_secure_pqr_intake | Intake PQR, columnas/índices y controles de entrada | D — fuente no localizada |
| 20261107171359 | pqr_atomic_rate_limiting | Tabla `pqr_rate_limits`, función y EXECUTE service_role | D — fuente no localizada |

La columna de efectos observados es una guía para el trabajo de recuperación; no afirma que cada objeto haya sido creado exclusivamente por esa versión.

## 4. Objetos vivos aún sin procedencia de migración resuelta

- `budget_categories_budget_user_fk_idx`: índice de producción presente, origen no atribuido.
- `save_monthly_budget`: definición recuperada del catálogo, migración original faltante.
- `pqr_consume_rate_limit`: definición recuperada del catálogo, migración original faltante.
- `issue_shortcut_authorization`: definición recuperada del catálogo, migración original faltante.
- `enforce_single_active_shortcut_authorization` y su trigger: definiciones vivas capturadas, migración original faltante.
- `rls_auto_enable` y event trigger `ensure_rls`: definición y attachment capturados; no deben confundirse con las tres migraciones equivalentes.
- `capture_nofeki_legal_acceptance` y trigger `nofeki_capture_legal_acceptance` en `auth.users`: attachment confirmado y función capturada; la procedencia histórica exacta aún requiere localizar su migración original.

## 5. Decisiones de recuperación

1. Mantener las tres migraciones existentes sin alterarlas para aparentar equivalencia histórica.
2. Mantener las 13 faltantes como D hasta que aparezca evidencia original (backup, fork, clone, PR, exportación o commit recuperado).
3. No fabricar archivos dentro de `supabase/migrations/`.
4. No recrear ni eliminar índices, constraints, funciones, triggers o grants en producción.
5. Mantener SQL reconstruido en documentación de referencia, fuera de `supabase/migrations/`, rotulado RECONSTRUIDO / NO EJECUTABLE.
6. Preservar el índice `budget_categories_budget_user_fk_idx`.
7. No restaurar objetos Supabase-managed ni event triggers de plataforma desde este paquete de aplicación.

## 6. Qué falta para una reconciliación integral

- Comparación completa de todas las políticas RLS por tabla con el SQL de origen disponible.
- Procedencia exacta de los defaults, secuencias, tipos y constraints de tablas cuya migración original falta.
- ACL completos de tablas, secuencias, esquemas y default privileges, no solo EXECUTE de las seis rutinas públicas.
- Procedencia de triggers/funciones en Auth y event triggers.
- Exportación/backup de configuración Storage/Auth y pruebas controladas de acceso PQR.
- Restauración en proyecto aislado y validación de constraints, RLS, grants, funciones, triggers y flujos de aplicación.

**Resultado de esta fase:** reconciliación documental de las tres migraciones versionadas y clasificación de las 13 fuentes ausentes. No es una restauración ensayada, no es un backup y no autoriza cambios en producción.
