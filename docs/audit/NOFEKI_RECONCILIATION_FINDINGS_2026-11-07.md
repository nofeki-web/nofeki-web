# NOFEKI — Reconciliación de migraciones y Edge Functions
Fecha de revisión: 2026-11-07
Rama de trabajo: `recovery/pqr-admin-retry-fix-20261108`
Proyecto Supabase: `bxjgodhqseoxrnshqtfr`

## Alcance y seguridad
Revisión de solo lectura. No se ejecutó DDL/DML, no se aplicaron migraciones, no se desplegaron funciones, no se modificó Auth/RLS/Storage y no se creó PR ni merge.

## 1. Migraciones equivalentes: archivos de main frente a producción

### Presupuestos
- Archivo en main: `20261104000100_create_monthly_budgets.sql`
- Versión de historial en producción: `20261105033355 create_monthly_budgets`
- La estructura actual de `budgets` y `budget_categories` coincide en columnas, restricciones principales, FK compuesta, unicidad por usuario/mes y políticas de propiedad.
- Producción contiene los índices `budgets_user_period_idx`, `budgets_user_period_unique`, `budgets_id_user_unique`, `budget_categories_user_budget_idx` y `budget_categories_budget_user_fk_idx`. El último índice adicional no está declarado en el archivo de main.
- El archivo de main contiene grants autenticados y políticas CRUD; el catálogo consultado refleja las cuatro políticas CRUD de ambas tablas.
- Conclusión: equivalencia funcional fuerte para el esquema principal, pero no identidad exacta de todos los objetos; índice adicional en producción por explicar.

### Ingresos
- Archivo en main: `20261105000100_create_income_transactions.sql`
- Versión de historial en producción: `20261105033850 create_income_transactions`
- Columnas, checks, FK, índice `income_transactions_user_date_idx`, RLS y políticas CRUD observadas coinciden con el archivo.
- Conclusión: coincidencia estructural observada para los objetos consultados. No prueba que el archivo sea byte a byte el SQL histórico original.

### Flujo PQR
- Archivo en main: `20261107120000_pqr_management_workflow.sql`
- Versión de historial en producción: `20261107161429 pqr_management_workflow`
- Producción contiene `pqr_events`, sus checks/FK/índice, RLS y estado extendido de `pqr_submissions` según el flujo descrito.
- Producción también contiene columnas y restricciones de intake seguro (por ejemplo, datos de consentimiento, tipo de solicitud y límites de campos), que pertenecen al alcance de la migración previa `20261107160355 create_secure_pqr_intake`, no a este archivo.
- Conclusión: el archivo representa el cambio de workflow, no la definición completa de PQR en producción.

## 2. Comparación de las ocho Edge Functions desplegadas

Se recuperó el código desplegado de Supabase y se comparó carácter por carácter con los snapshots de la rama de recuperación.

| Función | Versión desplegada | Resultado |
|---|---:|---|
| registrar-gasto-atajo | 9 | Idéntica |
| crear-token-atajo | 7 | Idéntica |
| gestionar-atajos | 7 | Idéntica |
| categorias-atajo | 9 | Idéntica |
| crear-codigo-vinculacion-atajo | 3 | Idéntica |
| canjear-codigo-vinculacion-atajo | 4 | Idéntica |
| pqr-submit | 6 | Diferente |
| pqr-admin | 9 | Diferente |

### Diferencias PQR pendientes de despliegue
- `pqr-submit`: el código desplegado actualiza `notification_status` sin comprobar el error de persistencia. El snapshot de la rama captura `notificationUpdateError`, registra advertencia operacional y devuelve `notification_status_persisted`. Esto evita confundir el radicado ya creado con un fallo total de la solicitud.
- `pqr-admin`: la versión desplegada en `retry_notification` no comprueba errores al actualizar `pqr_submissions` ni al insertar `pqr_events`. El snapshot de la rama verifica ambas operaciones, establece etapas para diagnóstico y lanza el error si falla la persistencia.
- Estas diferencias son cambios de código en la rama de recuperación, no cambios desplegados. No se desplegaron por esta revisión.

## 3. Historial de migraciones
La API de historial de Supabase devuelve 16 versiones. Se mantienen los 13 archivos sin equivalente en las ramas inspeccionadas como **original no recuperado en las ramas actuales**; no se deben declarar irrecuperables ni reconstruir dentro de `supabase/migrations/` como si fueran originales.

## 4. Storage
La consulta anterior encontró el bucket `pqr-attachments` privado, límite 5 MB, MIME PDF/JPEG/PNG; `storage.objects` tenía RLS habilitado y cero policies. Esto sugiere que el acceso directo ordinario queda bloqueado por RLS y que el flujo depende de operaciones privilegiadas del backend. Queda pendiente una prueba funcional controlada de carga, lectura mediante URL firmada y expiración; no se hizo ninguna prueba que cree o lea adjuntos reales en esta revisión.

## 5. Decisiones
1. No modificar el historial de migraciones remoto.
2. No copiar SQL reconstruido a `supabase/migrations/`.
3. Mantener snapshots de Edge Functions con la etiqueta de evidencia, sin asumir que todo snapshot es el código desplegado: las dos funciones PQR difieren.
4. Antes de cualquier despliegue PQR, revisar el diff completo, probar en entorno aislado y confirmar que no se activa un despliegue automático no deseado.
5. Investigar el índice adicional `budget_categories_budget_user_fk_idx` y localizar el origen exacto de los 13 archivos ausentes mediante respaldos externos/forks/copies si están disponibles.

## 6. Próximos pasos
- Completar el inventario de objetos y registro de decisiones.
- Revisar el origen de índices y objetos adicionales, y el flujo de Storage privilegiado.
- Preparar un paquete de referencia reconstruida claramente marcado como no ejecutable, fuera del directorio de migraciones.
