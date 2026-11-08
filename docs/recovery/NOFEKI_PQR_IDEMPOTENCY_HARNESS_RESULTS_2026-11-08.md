# NOFEKI PQR — resultados del harness simulado de idempotencia
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`
Estado: **9/9 pruebas simuladas aprobadas** con Node.js 22.16.0.

## Artefacto
- `supabase/functions/tests/pqr-idempotency-harness.test.mjs`
- Ejecución: `node --test supabase/functions/tests/pqr-idempotency-harness.test.mjs`

## Cobertura ejecutada
1. 50 solicitudes concurrentes en memoria con una misma clave: una reserva ganadora y una sola llamada al proveedor falso.
2. Misma clave con payload alterado: conflicto; sin segundo envío.
3. Una operación ya enviada no vuelve a llamar al proveedor.
4. Rechazo inequívoco del proveedor: estado `failed`.
5. Timeout ambiguo: estado `uncertain` y reintento automático bloqueado.
6. Proveedor acepta, pero falla persistencia: `uncertain`; no se reenvía a ciegas.
7. Fallo al insertar evento de cambio de estado: rollback simulado de estado e historial.
8. Camino exitoso de actualización: estado e evento quedan asociados.
9. Confirmación y notificación interna con claves diferentes: operaciones independientes.

Resultado observado: 9 tests, 9 aprobados, 0 fallidos.

## Límite crítico
Este harness usa un almacén en memoria con exclusión mutua y un adaptador falso de Resend. **No es PostgreSQL, no ejecuta las RPC SQL propuestas y no prueba concurrencia entre transacciones PostgreSQL reales.** La prueba de rollback también simula una transacción, no acredita una RPC en la base real.

El entorno disponible no tenía Deno, `psql`, PostgreSQL ni Docker. Por tanto:
- No se ejecutaron las 9 pruebas estáticas Deno existentes.
- No se ejecutó una base de datos aislada.
- No se llamó a Supabase, Resend, Turnstile ni Storage.
- No se cambió producción, no se creó infraestructura de pago, no se desplegó ni se fusionó nada.

## Criterio de aceptación pendiente
Antes de considerar resuelto el riesgo de duplicados, ejecutar el mismo contrato sobre PostgreSQL aislado con dos o más conexiones concurrentes y una restricción `UNIQUE(idempotency_key)`, además de validar ACL/RLS y rollback real de la RPC estado+evento. El resultado de este harness solo valida la lógica del modelo simulado.
