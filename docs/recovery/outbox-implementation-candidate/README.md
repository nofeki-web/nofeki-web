# NOFEKI PQR — implementación candidata del Transactional Outbox

**Estado: CANDIDATO TÉCNICO — NO DESPLEGABLE.**  
Rama: `recovery/pqr-outbox-implementation-20261108`.

Este paquete convierte el diseño anterior en contratos concretos de datos, RPC, worker, idempotencia y pruebas. No modifica la base de datos, las Edge Functions activas, Storage, Auth, secretos ni configuración del proyecto Supabase.

## Decisiones de arquitectura

1. La transacción PostgreSQL guarda el cambio de negocio, el evento de historial y las intenciones de correo en conjunto.
2. El worker reclama trabajos con lease y `FOR UPDATE SKIP LOCKED`, confirma el claim y solo después llama a Resend.
3. Cada correo tiene una clave de proveedor determinista. Resend admite `Idempotency-Key` y conserva las claves 24 horas; por eso la protección duradera sigue siendo la clave única del outbox y no la retención del proveedor.
4. El worker finaliza/reintenta únicamente si conserva el `lease_token`; un worker antiguo no puede pisar el resultado de otro.
5. El outbox vive en un esquema privado. No se conceden permisos de tabla a `anon` ni `authenticated`.
6. Los RPC se diseñan como `SECURITY INVOKER`; se evita `SECURITY DEFINER`. Las funciones de API se exponen solo a `service_role` mediante grants explícitos y revocación de `PUBLIC`, `anon` y `authenticated`. Debe verificarse el Data API del proyecto antes de implementar.
7. Las columnas actuales de PQR se conservan. `notification_status` queda como resumen compatible; el estado individual de cada correo se consulta en outbox.
8. No se declara entrega exactamente-una-vez. La clave de Resend reduce la ventana de duplicación, pero solo durante 24 horas. Si un proceso reaparece tras ese plazo después de una aceptación ambigua, queda un riesgo residual.

## Archivos

- `01-schema-and-rpc-contract.sql.md`: DDL de referencia, restricciones, grants y contratos transaccionales.
- `02-worker-and-edge-adaptation.md`: claim, envío, finalize, reintentos, claves Resend y adaptación de Edge Functions.
- `03-test-and-rollout-gates.md`: pruebas de concurrencia/fallos, criterios de aceptación y orden de despliegue.

## Bloqueos que deben resolverse antes de código desplegable

- Confirmar el flujo de estados permitido por negocio. No se impondrá un grafo de transición no aprobado.
- Definir cómo el formulario genera y conserva un UUID estable de idempotencia al reintentar el mismo envío.
- Confirmar la configuración Data API y privilegios reales del esquema `private`.
- Probar en PostgreSQL aislado; los modelos Node/in-memory no sustituyen pruebas de transacciones, locks y RLS reales.
- Confirmar remitente, plantillas y semántica de cada correo con el flujo legal actual.

## No realizado

No hay migración aplicada, función SQL creada, Edge Function desplegada, correo enviado, secreto leído/modificado, PR abierto ni merge.
