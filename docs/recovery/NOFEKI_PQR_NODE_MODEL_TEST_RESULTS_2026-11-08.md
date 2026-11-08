# NOFEKI PQR — resultados de modelos Node.js sin costo
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Resultado de ejecución

Se ejecutaron con Node.js 22 los dos modelos de prueba:

- `supabase/functions/tests/pqr-outbox-fault-model.node.test.mjs`
- `supabase/functions/tests/pqr-transaction-idempotency-model.node.test.mjs`

**Resultado conjunto: 17 pruebas aprobadas, 0 fallidas.**

### Modelo Outbox (9 pruebas)

1. Deduplicación de `event_key`.
2. No reclamar un lease vigente desde un segundo worker simulado.
3. Recuperar un lease vencido.
4. Rechazar finalización con token obsoleto.
5. Programar reintento ante fallo transitorio.
6. Enviar fallo permanente a dead letter.
7. No reclamar de nuevo un evento entregado.
8. Representar la ambigüedad de proveedor aceptado y worker caído antes de confirmar.
9. Rechazar token inválido.

### Modelo transaccional e idempotencia (8 pruebas)

10. Misma clave y huella devuelve la solicitud original.
11. Misma clave con huella distinta produce conflicto sin mutación.
12. Alta correcta crea caso, clave, historial y outbox.
13. Fallo después del alta revierte el estado simulado completo.
14. Fallo después del historial revierte el estado simulado completo.
15. Transición válida incrementa versión y crea historial/outbox.
16. Versión obsoleta rechaza la transición sin escrituras parciales.
17. Request ID repetido reproduce el evento sin duplicarlo.

## Alcance y limitaciones

Estos son modelos de estado en memoria ejecutados con Node.js. La transacción se representa mediante snapshot/rollback de estructuras JavaScript; **no es una transacción PostgreSQL**. Los workers se simulan en un solo proceso; **no es concurrencia real entre sesiones ni procesos**.

Por tanto, los resultados validan la lógica de referencia y la cobertura de escenarios, pero no prueban:
- `FOR UPDATE SKIP LOCKED` ni bloqueos reales.
- Restricciones únicas bajo concurrencia en PostgreSQL.
- Rollback del motor de base de datos.
- RLS, grants o permisos de Supabase.
- Integración, idempotencia o comportamiento real del proveedor de correo.

No se creó rama de Supabase, no se ejecutó SQL contra el proyecto, no se desplegaron Edge Functions y no se modificó producción.

## Próximo paso sin costo

Continuar con revisión estática de las Edge Functions y preparar contratos/implementación de referencia que respeten los nombres y campos reales ya observados en el repositorio. Mantener como gate pendiente las pruebas PostgreSQL multi-sesión antes de aprobar cualquier rollout.
