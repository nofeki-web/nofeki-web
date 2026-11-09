# NOFEKI PQR — avance técnico de RPC administrativas
Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Artefactos incorporados
- `NOFEKI_PQR_ATOMIC_ADMIN_RPC_CONTRACT_2026-11-08.md`: contrato de transición, respuesta idempotente, registro de requests, versionado y enlace Outbox → evento de respuesta.
- `pqr-atomic-admin-rpc-model.node.test.mjs`: modelo de concurrencia, replay idempotente, conflicto de fingerprint y rollback simulado.
- La política funcional aprobada se mantiene en `NOFEKI_PQR_STATE_TRANSITION_POLICY_2026-11-08.md`.

## Decisiones técnicas fijadas
1. `pqr_submissions.version` monotónica para optimistic concurrency.
2. Registro `private.pqr_admin_requests` con request_id, operation_type, fingerprint y resultado persistido.
3. `private.pqr_outbox.source_event_id` para asociar cada correo administrativo al evento de respuesta exacto.
4. RPC de transición y RPC de respuesta ejecutadas como una sola transacción cada una.
5. Edge Function autentica y verifica allowlist; el actor lo deriva del usuario validado.
6. Worker envía fuera de la transacción y usa event_key como idempotency key del proveedor.
7. Los conflictos de negocio deben usar PT409 / error no transitorio; no levantar 40001. Supabase KB advierte sobre reintentos de PostgREST 14 para 40001.

## Verificación realizada en esta etapa
- Se comprobó que Node.js v22.16.0 está disponible en el contenedor de trabajo.
- Se ejecutaron 5 smoke assertions sobre avance permitido, salto prohibido, motivo obligatorio para reapertura y terminalidad de Cerrada: todas pasaron.
- Los archivos de pruebas Node quedaron incorporados en GitHub, pero la suite completa comprometida aún no se ha ejecutado en el contenedor.
- No se ejecutaron pruebas PostgreSQL, RPC reales, concurrencia de base de datos, rollback SQL ni security advisors.

## Bloqueos y siguiente paso
- No hay PostgreSQL aislado, Docker/Podman ni Deno en el entorno de trabajo.
- El SQL Outbox actual requiere ampliarse con source_event_id y tablas de idempotencia administrativa antes de poder considerarse un candidato coherente de extremo a extremo.
- Antes de escribir una migración ejecutable hay que revisar columnas y constraints exactos, grants/default privileges, exposición del esquema y extensiones en una base aislada.
- No se ejecutó SQL contra Supabase de producción ni se modificaron Edge Functions, HTML, secretos, Auth, Storage o despliegues.

## Resultado
Se completó el contrato transaccional y la estrategia de pruebas de modelo. La implementación SQL/Edge y la validación PostgreSQL permanecen pendientes; no se declara el flujo listo para producción.
