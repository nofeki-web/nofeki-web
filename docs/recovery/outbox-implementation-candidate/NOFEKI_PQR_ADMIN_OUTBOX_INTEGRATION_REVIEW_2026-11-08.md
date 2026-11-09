# Revisión de integración administrativa PQR + Outbox

Fecha: 2026-11-08  
Estado: candidato técnico, no desplegado.

## Entregables incorporados

- `pqr-admin/index.ts`: Edge Function candidata adaptada a los contratos RPC existentes en el SQL base.
- `frontend/pqr-admin.html`: panel candidato con claves idempotentes por acción, persistencia de reintento en `sessionStorage`, y botón para encolar reintento de confirmación.
- `NOFEKI_PQR_ADMIN_RPC_COMPLETION_ADDENDUM_NOT_EXECUTABLE.sql`: RPC idempotentes para nota interna y reintento de confirmación; actualiza `notification_status` al completar o fallar el worker.
- `NOFEKI_PQR_ATOMIC_OUTBOX_RPC_CANDIDATE_FIXED_NOT_EXECUTABLE.sql`: copia corregida del SQL base del Outbox; corrige el terminador de dollar quote del RPC `pqr_outbox_finish` (`$$;`).
- `NOFEKI_PQR_ADMIN_RPC_CONTRACTS_2026-11-08.md`: contrato de integración y pruebas.

## Correspondencia Edge → SQL

| Acción del panel | RPC invocado | Comportamiento |
|---|---|---|
| Cambiar estado | `pqr_admin_transition_status` | Bloqueo de fila, control de estado/versión, evento de historial e idempotencia. No admite asignar manualmente Respondida. |
| Nota interna | `pqr_admin_add_note_v2` | Evento interno y clave idempotente en la misma transacción. |
| Respuesta formal | `pqr_admin_create_response` | Desde En gestión: evento response_sent, cambio a Respondida, responded_at y Outbox admin_response en una transacción. |
| Reintentar confirmación | `pqr_admin_retry_notification_v2` | Evento notification_retry y nuevo job applicant_confirmation; no envía correo en la petición HTTP. |

## Reconciliación del worker

El worker candidato consume `applicant_confirmation`, `internal_alert` y `admin_response`. El contrato del Outbox utiliza `id`, `submission_id`, `source_event_id`, `event_key`, `event_type`, `status`, `attempts`, `max_attempts`, `available_at`, `locked_until`, `lock_token`, `provider_message_id`, `last_error_code`, `last_error_at`, `delivered_at`, `created_at`, `updated_at`. El Edge worker invoca `pqr_outbox_claim`, `pqr_outbox_finish`, `pqr_outbox_retry`.

Se corrigió el terminador SQL mal formado en el RPC `pqr_outbox_finish` en la copia corregida del SQL base. El addendum reemplaza `finish/retry` para proyectar el estado de notificación inicial en `pqr_submissions.notification_status`, `notification_sent_at`, `notification_error`. El estado del caso PQR permanece independiente del resultado del correo.

## Hallazgos que siguen abiertos

1. El worker no ha sido desplegado ni ejecutado en Deno; scheduler/cron sigue sin configurar.
2. Los dos SQL candidatos deben compilarse juntos en PostgreSQL 17.11 aislado. No se ha ejecutado ninguno.
3. El campo `version` se añade en el SQL base candidato. La integración depende de ese cambio; no existe en el esquema desplegado observado.
4. El Edge Function usa `row.version ?? 1` como compatibilidad de lectura, pero el RPC espera la columna después de aplicar el SQL candidato.
5. El reintento manual vuelve a emitir una confirmación de radicación, no una respuesta administrativa. El reintento de respuesta formal por evento dead-letter requiere política adicional y no se ofrece en esta versión.
6. El evento `notification_retry` registra la solicitud de reintento; la entrega real se refleja en `pqr_submissions.notification_status`.
7. El fingerprint se calcula en el Edge Function sobre acción, radicado y contenido normalizado. La clave se conserva por acción y radicado en el tab/session actual.

## Verificaciones estáticas efectuadas

Se verificaron por lectura de archivos:
- Edge Function llama a los nombres RPC definidos por los SQL candidatos.
- Los parámetros de transición y respuesta incluyen estado/versión esperados y fingerprint.
- No existe llamada directa a Resend en `pqr-admin`.
- El panel envía `Idempotency-Key` y conserva la misma clave cuando falla la petición.
- El botón de reintento llama al flujo de cola, no al proveedor de correo.
- El worker candidate acepta los tres tipos de evento documentados.

Estas verificaciones no equivalen a compilación, pruebas de navegador ni integración real.

## Estado de producción

Sin SQL ejecutado, sin Edge Function desplegada, sin frontend desplegado, sin cambios de secretos, Auth, Storage, datos o scheduler. No se ha creado PR ni se ha fusionado la rama.
