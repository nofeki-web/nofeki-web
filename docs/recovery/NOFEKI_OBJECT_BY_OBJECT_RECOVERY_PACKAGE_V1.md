# NOFEKI Gastos — paquete de recuperación por objeto (v1)

**Fecha de corte:** 2026-11-07  
**Rama:** `recovery/pqr-admin-retry-fix-20261108`  
**Estado:** reconstrucción documental; NO restaurado ni probado en una instancia aislada.  
**Producción:** solo lectura durante esta fase. No ejecutar este documento como migración.

## 1. Objetivo y reglas

Este paquete convierte la evidencia de producción y del repositorio en unidades recuperables, con dependencias explícitas y un criterio de aceptación por objeto. No sustituye un backup físico ni una exportación completa de Supabase.

Reglas obligatorias:
1. No ejecutar SQL de este paquete en producción.
2. No copiar datos de usuarios, tokens, códigos de vinculación, adjuntos ni PII.
3. No recrear objetos cuyo DDL exacto no esté capturado. Marcar como `PARTIAL` o `UNVERIFIED`.
4. Mantener el SQL de referencia fuera de `supabase/migrations/`.
5. No restaurar Auth, Storage ni Edge Functions antes de reconstruir y validar sus dependencias.
6. No crear un proyecto/branch Supabase con costo sin cotización y aprobación expresa.
7. Cualquier prueba debe hacerse con datos sintéticos y credenciales propias del entorno aislado.

## 2. Estados de recuperación

| Estado | Significado |
|---|---|
| VERIFIED-LIVE | Objeto y propiedades observados en producción en el snapshot citado. No implica restauración. |
| REPO-MATCH | Archivo de repositorio coincide con la evidencia comparada. |
| PARTIAL | Se conocen algunas propiedades, pero falta definición exacta o procedencia. |
| UNVERIFIED | No hay evidencia suficiente para reconstruirlo sin inferencias. |
| TEST-PENDING | Aún no se ha restaurado ni probado en un entorno aislado. |

## 3. Orden de reconstrucción por capas

1. **Base PostgreSQL:** extensiones, schemas, owners, roles relevantes, sequences y privilegios base.
2. **Tablas núcleo:** `budgets`, `gastos`, `financial_profiles`, `income_transactions`, `user_expense_categories`.
3. **Tablas de soporte:** `budget_categories`, `legal_acceptance_audit`, `shortcut_authorizations`, `shortcut_link_codes`, `pqr_submissions`, `pqr_events`, `pqr_rate_limits`.
4. **Integridad:** PK/FK, UNIQUE, CHECK, índices y defaults.
5. **Seguridad de datos:** RLS, policies, grants, default privileges y ownership.
6. **Rutinas:** funciones RPC y funciones de trigger, con ACL explícita.
7. **Triggers/event triggers:** solo después de verificar funciones, owner y alcance.
8. **Storage:** bucket privado y reglas de acceso; después validar upload y signed URL.
9. **Edge Functions:** desplegar solo después de validar secretos, permisos, contratos y tablas.
10. **Frontend y flujos:** probar gastos, presupuesto/ingresos, atajo, PQR y administración con usuarios sintéticos.

## 4. Inventario de objetos y fichas

### 4.1 Tablas públicas

| Objeto | Evidencia disponible | Dependencias / controles | Estado |
|---|---|---|---|
| `budgets` | Unique `(user_id, period_month)`; periodo mensual; modo income/manual; restricciones de importes; RLS por propietario. | `auth.users`; policies; RPC `save_monthly_budget`. | VERIFIED-LIVE / REPO-MATCH parcial |
| `budget_categories` | FK compuesta `(budget_id,user_id)` hacia `budgets(id,user_id)`; unique `(budget_id,category)`; planned >= 0. | `budgets`; índice adicional `budget_categories_budget_user_fk_idx`; policies por propiedad del presupuesto. | VERIFIED-LIVE / PARTIAL |
| `gastos` | amount > 0; tipos Necesario/Discrecional/Deuda; source web/shortcut/import; unique `(user_id,idempotency_key)`; RLS propietario. | `auth.users`; Edge Function registrar gasto; frontend. | VERIFIED-LIVE |
| `financial_profiles` | Tabla existente; RLS propietario; sin DELETE para authenticated según ACL revisada. | `auth.users`; onboarding y frontend. | VERIFIED-LIVE / PARTIAL |
| `income_transactions` | amount > 0; concept 2..120; note <=500; source <=80; índice y RLS/grants alineados con migración de repo (timestamp distinto). | `auth.users`; frontend de ingresos. | VERIFIED-LIVE / REPO-MATCH |
| `user_expense_categories` | RLS; CRUD authenticated y SELECT service_role. | `auth.users`; categorías web/atajo. | VERIFIED-LIVE / PARTIAL |
| `legal_acceptance_audit` | SELECT propio; inserción vía trigger; no tratar metadata del usuario como fuente de autorización. | `auth.users`; trigger `nofeki_capture_legal_acceptance`; rutina de captura. | VERIFIED-LIVE / PARTIAL |
| `shortcut_authorizations` | RLS activa sin policies directas; servicio backend; token_hash único; FK a Auth. | `auth.users`; RPC de emisión; Edge Functions de atajo. | VERIFIED-LIVE / PARTIAL |
| `shortcut_link_codes` | RLS activa sin policies directas; code_hash único; código de un solo uso y expiración de 5 min observados en flujo. | `auth.users`; RPC/claim; Edge Functions de vinculación. | VERIFIED-LIVE / PARTIAL |
| `pqr_submissions` | Tabla PQR; estado y columnas de notificación; acceso interno mediante service_role. | `auth.users` según relaciones presentes; Storage; PQR functions. | VERIFIED-LIVE / REPO-MATCH parcial |
| `pqr_events` | FK hacia PQR; tabla interna service-managed; sin policies directas. | `pqr_submissions`; pqr-admin. | VERIFIED-LIVE / PARTIAL |
| `pqr_rate_limits` | Tabla interna; RLS activa sin policies directas; hash SHA256 hexadecimal observado en flujo. | rutina `pqr_consume_rate_limit`; pqr-submit. | VERIFIED-LIVE / PARTIAL |

**Nota:** RLS está habilitada y FORCE RLS desactivado en las 12 tablas públicas enumeradas. Cinco tablas internas no tienen policies directas y están diseñadas para acceso backend con service_role. No convertir esa observación en una política universal: validar grants y uso real en cada restauración.

### 4.2 Funciones y rutinas

| Rutina | Evidencia disponible | ACL / seguridad observada | Estado |
|---|---|---|---|
| `save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)` | Guarda presupuesto mensual de forma atómica; valida `auth.uid()`; frontend usa los seis argumentos. | EXECUTE authenticated; SECURITY INVOKER. | VERIFIED-LIVE; definición fuente/procedencia pendiente |
| `issue_shortcut_authorization(uuid,text,text,timestamptz)` | Emisión con advisory lock por usuario, validaciones y expiración de autorizaciones anteriores. | EXECUTE service_role; SECURITY INVOKER. | VERIFIED-LIVE; definición fuente/procedencia pendiente |
| `pqr_consume_rate_limit(text,int,int)` | Rate limit atómico mediante upsert. | EXECUTE service_role; SECURITY INVOKER. | VERIFIED-LIVE; definición fuente/procedencia pendiente |
| `capture_nofeki_legal_acceptance()` | SECURITY DEFINER; search_path vacío; asociada al trigger de auditoría legal. | Rutina interna; sin EXECUTE para anon/authenticated/service_role observado. | PARTIAL |
| `enforce_single_active_shortcut_authorization()` | SECURITY DEFINER; asociada a trigger de autorización única activa. | Rutina interna; sin EXECUTE para anon/authenticated/service_role observado. | PARTIAL |
| `rls_auto_enable()` | SECURITY DEFINER; search_path pg_catalog; event trigger ddl_command_end; owner postgres. | Rutina de sistema. | PARTIAL |

No hay que regenerar las rutinas SECURITY DEFINER sin revisar owner, search_path, SQL completo y grants. No conceder EXECUTE a PUBLIC por defecto.

### 4.3 Triggers y event triggers

| Objeto | Evidencia | Estado |
|---|---|---|
| `nofeki_capture_legal_acceptance` en `auth.users` | Ejecuta captura de aceptación legal. | VERIFIED-LIVE / definición parcial |
| Trigger de autorización única activa | Asociado a `enforce_single_active_shortcut_authorization`. | VERIFIED-LIVE / nombre y DDL exacto por verificar |
| `ensure_rls` event trigger | ddl_command_end, habilitado, owner postgres; usa `rls_auto_enable`. | VERIFIED-LIVE / PARTIAL |

El event trigger global debe ser el último objeto restaurado de esta capa. Probar primero en schema aislado para evitar efectos involuntarios sobre DDL posterior.

### 4.4 Storage

- Bucket: `pqr-attachments`, privado.
- Límite observado: 5 MB.
- MIME permitidos: PDF, JPEG y PNG.
- `pqr-submit` sube con service_role y elimina el archivo si falla el proceso.
- `pqr-admin` crea signed URL con vigencia de 300 segundos.
- RLS en `storage.objects` activa; no se observaron policies.
- Estado: VERIFIED-LIVE de configuración declarada; TEST-PENDING de upload, cleanup, descarga y expiración.

No restaurar adjuntos de usuarios en la prueba. Usar archivos sintéticos.

### 4.5 Edge Functions

| Función | Producción | Comparación con snapshot de rama | Estado |
|---|---:|---|---|
| registrar-gasto-atajo | v9, verify_jwt=false | Idéntica | REPO-MATCH |
| crear-token-atajo | v7, verify_jwt=true | Idéntica | REPO-MATCH |
| gestionar-atajos | v7, verify_jwt=false | Idéntica | REPO-MATCH |
| categorias-atajo | v9, verify_jwt=false | Idéntica | REPO-MATCH |
| crear-codigo-vinculacion-atajo | v3, verify_jwt=true | Idéntica | REPO-MATCH |
| canjear-codigo-vinculacion-atajo | v4, verify_jwt=false | Idéntica | REPO-MATCH |
| pqr-submit | v6, verify_jwt=false | Diferente: recovery comprueba error al persistir notification_status | PARTIAL |
| pqr-admin | v9, verify_jwt=false | Diferente: recovery comprueba update de submission e insert de pqr_events durante retry_notification | PARTIAL |

Las funciones con verify_jwt=false deben evaluarse por su autenticación interna y contrato; el valor por sí solo no determina vulnerabilidad. En pqr-admin se observó validación explícita de bearer mediante Auth y allowlist administrativa antes de leer o mutar datos.

## 5. Migraciones: reconciliación y huecos

### Equivalencias parciales

- Producción `20261105033355 create_monthly_budgets` frente a repo `20261104000100_create_monthly_budgets.sql`: columnas, constraints centrales, policies e índices principales alinean. Producción tiene `budget_categories_budget_user_fk_idx` adicional. La rutina `save_monthly_budget` y su ACL authenticated no están en ese archivo.
- Producción `20261105033850 create_income_transactions` frente a repo `20261105000100_create_income_transactions.sql`: estructura, constraints, índice, RLS y grants alinean en snapshot; diferencia de timestamp impide afirmar identidad byte a byte.
- Producción `20261107161429 pqr_management_workflow` frente a repo `20261107120000_pqr_management_workflow.sql`: parte de workflow alinea; intake, rate limit y varios índices/rutinas no quedan explicados por ese archivo.

### 13 migraciones remotas sin archivo localizado en las ramas revisadas

1. `20261018201105 tighten_gastos_and_function_privileges`
2. `20261018201138 optimize_legal_audit_rls_policy`
3. `20261019020006 create_financial_profiles_for_onboarding`
4. `20261019021147 user_expense_categories`
5. `20261019021929 grant_user_expense_categories_access`
6. `20261022024849 add_shortcut_authorization_expiration`
7. `20261022040313 enforce_single_active_shortcut_authorization`
8. `20261024194051 grant_service_role_select_user_expense_categories`
9. `20261024220845 shortcut_link_codes`
10. `20261025152720 revoke_unneeded_table_privileges`
11. `20261105033443 atomic_monthly_budget_save`
12. `20261107160355 create_secure_pqr_intake`
13. `20261107171359 pqr_atomic_rate_limiting`

Clasificación: **D — no localizado en las ramas inspeccionadas; no significa irrecuperable**. Recuperar primero desde historial remoto, backups o definiciones exactas de catálogo.

## 6. Objetos cuya procedencia/DDL exacto sigue pendiente

- `budget_categories_budget_user_fk_idx`
- `save_monthly_budget`
- `pqr_consume_rate_limit`
- `issue_shortcut_authorization`
- `enforce_single_active_shortcut_authorization` y trigger asociado
- `rls_auto_enable` y event trigger `ensure_rls`
- `capture_nofeki_legal_acceptance` y trigger `nofeki_capture_legal_acceptance`

Para cada uno: obtener definición completa, owner, language, volatility, SECURITY mode, config/search_path, ACL efectiva, dependencias, checksum y evidencia de origen. Si no se puede obtener definición completa, no generar un CREATE aproximado.

## 7. Criterios de aceptación en instancia aislada

La recuperación solo podrá marcarse **TESTED** después de:
- comparar conteos y estructura de objetos esperados (sin copiar PII);
- verificar constraints, índices y secuencias;
- probar RLS con al menos dos usuarios sintéticos y service_role;
- confirmar que anon no obtiene permisos no previstos;
- probar RPCs con autenticación válida, inválida y ausencia de sesión;
- verificar triggers y event triggers con tablas de ensayo;
- probar expiración/revocación/idempotencia del atajo;
- probar rate limit y reintento PQR;
- probar upload, cleanup y signed URL de 300 segundos;
- correr Security/Performance Advisors y revisar cada hallazgo;
- verificar que no haya secretos en frontend, logs o commits;
- guardar resultados, timestamps, checksums y logs saneados.

## 8. Próxima acción técnica

Completar la extracción de DDL y ACL exactos que faltan (incluyendo sequences, extensiones, default privileges y event trigger completo), y generar scripts reconstruidos por objeto únicamente cuando exista evidencia suficiente. Después solicitar autorización para usar una instancia aislada, cotizar costo si aplica y ejecutar la matriz de regresión. Hasta entonces no hay restauración demostrada.


## 9. Capturas complementarias generadas el 2026-11-07

- [Definiciones exactas de rutinas, triggers, event trigger e índice](../audit/NOFEKI_ROUTINE_TRIGGER_INDEX_DEFINITIONS_SNAPSHOT_2026-11-07.md). Incluye `pg_get_functiondef`, atributos, owner y ACL observados.
- [Extensiones, secuencias y default privileges](../audit/NOFEKI_EXTENSIONS_SEQUENCES_DEFAULT_PRIVILEGES_SNAPSHOT_2026-11-07.md).
- [SQL de referencia comentario-only](../audit/reference-sql/NOFEKI_RECOVERY_REFERENCE_ONLY_NOT_EXECUTABLE.sql).

Estas capturas reducen los objetos PARTIAL cuya definición ya se pudo recuperar desde el catálogo. Aun así, el paquete completo sigue sin equivaler a backup ni a restauración: faltan las ACL efectivas completas de todos los objetos, policies/constraints exhaustivas y validación en instancia aislada.
