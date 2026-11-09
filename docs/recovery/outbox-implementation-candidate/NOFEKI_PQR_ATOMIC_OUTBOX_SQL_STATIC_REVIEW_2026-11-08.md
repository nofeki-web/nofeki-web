# NOFEKI PQR — revisión estática del SQL candidato completo
Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Artefacto revisado
`docs/recovery/outbox-implementation-candidate/NOFEKI_PQR_ATOMIC_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql`

Blob SHA verificado en GitHub: `c9d6033f1026d81d905bfbd0963cf93cf1473398`.

## Contenido incluido
- Columna aditiva `pqr_submissions.version BIGINT NOT NULL DEFAULT 1`.
- `private.pqr_admin_requests` con request_id único, submission, tipo de operación, fingerprint y resultado durable.
- `private.pqr_outbox` con event_key único, tipo, intentos, lease, fencing token, estado y source_event_id.
- RPC `pqr_admin_transition_status`: validación de matriz, expected status/version, no-op, auditoría transaccional e idempotencia.
- RPC `pqr_admin_create_response`: respuesta + evento + Outbox + cambio a Respondida en una sola transacción.
- RPC `pqr_outbox_claim`: lote limitado y SKIP LOCKED.
- RPC `pqr_outbox_finish` y `pqr_outbox_retry`: fencing token y actualización del email_status del evento de respuesta.
- RLS habilitado para tablas privadas, sin grants a clientes; EXECUTE de RPC restringido a service_role.

## Revisión estática realizada
Se recuperó el archivo después de los cambios y se verificó la presencia de cada componente, la ruta docs/recovery (no migration), la ausencia de llamadas mal calificadas a NULLIF/COALESCE y la ausencia de bloques DO incompletos. Todas las comprobaciones estáticas enumeradas pasaron.

## Hallazgos y limitaciones
1. No se dispone de PostgreSQL aislado, Docker/Podman ni Deno en el entorno actual. Por tanto, el SQL no se ha compilado ni ejecutado y no puede declararse sintácticamente validado.
2. No se ejecutaron transacciones concurrentes reales, fallos forzados, rollback, RLS tests ni Supabase Advisors.
3. El candidato no incluye todavía la RPC de creación pública PQR idempotente; la integración de `pqr-submit` necesita otra fase que incluya almacenamiento de clave del cliente y compensación para adjuntos en Storage.
4. No incluye todavía una RPC de reintento manual de dead-letter. Antes se debe resolver la retención de idempotencia del proveedor y exigir auditoría del administrador.
5. No incluye Edge Function worker ni cambios al panel. El claim/finish/retry SQL es solo la capa de persistencia; el worker aún debe cargar datos mínimos por source_event_id y enviar a Resend con event_key.
6. El diseño supone que la Edge Function de administración llama RPC con service_role solo después de validar el bearer token y la allowlist actual. No se debe llamar directamente desde el navegador.

## Decisión de seguridad
El archivo permanece en `docs/recovery/outbox-implementation-candidate/` y se etiqueta NOT EXECUTABLE. No se ha creado migración bajo `supabase/migrations`; no se ha ejecutado SQL en el proyecto Supabase; no se han cambiado funciones activas ni datos.

## Próxima puerta de validación
Antes de preparar una migración:
- ejecutar en PostgreSQL 17 aislado sobre un snapshot del esquema real;
- añadir fixtures mínimos de submission;
- verificar compilación de cada función y grants;
- correr pruebas de idempotencia, concurrencia, rollback y fencing;
- comprobar Advisors/RLS;
- revisar el flujo de adjuntos y la creación inicial de Outbox;
- reconciliar código de Edge Functions desplegadas 6/9 con el repo.
