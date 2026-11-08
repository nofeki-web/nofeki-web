# NOFEKI — Mapa de dependencias frontend, Edge Functions y base de datos

Fecha: 2026-11-07. Fuente: rama `recovery/pqr-admin-retry-fix-20261108` y catálogo de producción consultado en solo lectura.

## Aplicación Gastos (`gastos.html`)
| Flujo | Frontend | Dependencias DB / API | Autorización |
|---|---|---|---|
| Categorías personales | `user_expense_categories` CRUD | tabla + RLS por user_id | authenticated |
| Perfil financiero | `financial_profiles` SELECT/INSERT/UPDATE | tabla + RLS por user_id | authenticated |
| Presupuestos | `budgets`, `budget_categories` SELECT | tablas + RLS por user_id | authenticated |
| Guardar presupuesto | RPC `save_monthly_budget` | budgets + budget_categories; upsert y reemplazo de categorías en transacción | authenticated; función comprueba auth.uid() |
| Gastos web | `gastos` INSERT/SELECT/DELETE | unique idempotency (user_id,idempotency_key) | authenticated + RLS |
| Ingresos | `income_transactions` CRUD | tabla + RLS por user_id | authenticated |
| Listar/revocar atajo | `gestionar-atajos` GET/POST | shortcut_authorizations vía service role | Bearer Auth validado; filtra por user.id |
| Crear código de enlace | `crear-codigo-vinculacion-atajo` POST | shortcut_authorizations + shortcut_link_codes | Bearer Auth validado; código temporal hash |

## PQR
| Flujo | Frontend | Backend / DB | Control |
|---|---|---|---|
| Radicar PQR | `pqr.html` | `pqr-submit`, pqr_submissions, pqr_events, pqr_rate_limits, pqr-attachments | consentimiento + Turnstile + rate limit; service role |
| Administrar PQR | `pqr-admin.html` | `pqr-admin`, pqr_submissions, pqr_events, Storage signed URL | sesión Auth + allowlist email admin |
| Reintento/estado/nota/respuesta | `pqr-admin.html` | acciones POST a pqr-admin | validación de admin en servidor |

## Atajo iOS
- `vincular-atajo.html` crea un código de un solo uso de 32 hex chars, con expiración de 5 minutos.
- `canjear-codigo-vinculacion-atajo` consume el código, genera un token aleatorio y llama `issue_shortcut_authorization`.
- `registrar-gasto-atajo` valida token hash/expiración/revocación, aplica idempotencia e inserta en `gastos`.
- `categorias-atajo` devuelve categorías para el usuario vinculado.
- `gestionar-atajos` lista y revoca autorizaciones solo del usuario autenticado.

## Hallazgos de consistencia
1. Los nombres de tablas y RPC usados por `gastos.html` existen en el catálogo de producción.
2. La llamada frontend a `save_monthly_budget` coincide con los seis argumentos de la función desplegada: `p_period_month,p_mode,p_income_amount,p_expense_limit,p_savings_target,p_categories`.
3. `gestionar-atajos` frontend manda GET para listar y POST `{id}` para revocar; coincide con el contrato desplegado.
4. El enlace web crea el código mediante `crear-codigo-vinculacion-atajo`; la expiración visible del frontend coincide con los 5 minutos del backend.
5. `pqr-admin.html` manda `reference` y `action` al endpoint esperado. La autorización se aplica en servidor antes de consultar los radicados.
6. El código de recuperación `pqr-admin` incluye controles de error adicionales para persistencia de reintentos, pero no está desplegado.
7. El canje de código puede consumir el código antes de que la emisión del token final termine; si la RPC falla, el usuario debe generar otro código. Es un comportamiento recuperable, pero debe quedar cubierto por prueba y UX.

## Limitaciones
- Auditoría estática de código y metadatos; no se ejecutaron transacciones de prueba ni llamadas reales a producción.
- No se inspeccionó el binario/estructura interna del Atajo de iOS; solo los contratos del backend y la página de vinculación.
- No se inspeccionaron los secretos de entorno.
- Esta matriz no certifica visualmente el frontend ni pruebas de extremo a extremo.