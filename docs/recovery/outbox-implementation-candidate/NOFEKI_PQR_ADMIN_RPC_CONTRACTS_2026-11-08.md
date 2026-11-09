# NOFEKI PQR — contratos RPC administrativos v2

**Estado:** contrato candidato; no ejecutar ni desplegar.  
**Rama:** `recovery/pqr-outbox-implementation-20261108`.

## Decisión funcional aplicada

- Una respuesta formal desde `En gestión` cambia el caso a `Respondida` dentro de la misma transacción que crea `response_sent` y el trabajo Outbox `admin_response`.
- La entrega del correo es independiente del estado del caso. Un fallo de entrega no revierte `Respondida`; el Outbox conserva el reintento.
- Un cambio manual nunca asigna `Respondida`.
- `Cerrada` es una acción administrativa separada; un caso cerrado no admite nueva respuesta en esta primera versión.
- Misma clave + misma huella devuelve el resultado original; misma clave con contenido distinto produce conflicto.
- El Edge Function valida sesión con `auth.getUser(token)` y allowlist antes de invocar RPC. Las RPC solo se conceden a `service_role`.

## Contratos exactos invocados por `pqr-admin`

| Acción HTTP | RPC | Firma de argumentos |
|---|---|---|
| `status` | `public.pqr_admin_transition_status` | `p_submission_id uuid, p_expected_status text, p_expected_version bigint, p_target_status text, p_request_id uuid, p_request_fingerprint text, p_actor_email text, p_reason text` |
| `note` | `public.pqr_admin_add_note_v2` | `p_request_key uuid, p_submission_id uuid, p_request_fingerprint text, p_note text, p_actor_email text` |
| `respond` | `public.pqr_admin_create_response` | `p_submission_id uuid, p_expected_version bigint, p_request_id uuid, p_request_fingerprint text, p_actor_email text, p_response text` |
| `retry_notification` | `public.pqr_admin_retry_notification_v2` | `p_request_key uuid, p_submission_id uuid, p_request_fingerprint text, p_actor_email text` |

La transición y la respuesta reciben estado/versión esperados desde la lectura del caso. La base SQL candidata agrega `pqr_submissions.version bigint not null default 1`; por tanto, el Edge candidato requiere aplicar primero ese esquema en un entorno aislado. La consulta real del esquema confirmó que las columnas `notification_status`, `notification_sent_at` y `notification_error` ya existen en producción.

## Contratos del worker

| RPC | Firma |
|---|---|
| `public.pqr_outbox_claim` | `p_batch_size integer, p_lease_seconds integer` |
| `public.pqr_outbox_finish` | `p_outbox_id uuid, p_lease_token uuid, p_provider_message_id text` |
| `public.pqr_outbox_retry` | `p_outbox_id uuid, p_lease_token uuid, p_error_code text, p_delay_seconds integer` |

El worker usa `event_key` como clave de idempotencia de Resend. Los eventos `admin_response` deben incluir `source_event_id`; `applicant_confirmation` puede tenerlo nulo. El addendum reemplaza `finish/retry` para proyectar el resultado de confirmaciones en las columnas de notificación del caso, sin alterar el estado PQR.

## Seguridad exigida

- `SECURITY INVOKER`, `SET search_path = ''`, referencias cualificadas.
- Revocar ejecución de `PUBLIC`, `anon` y `authenticated`; conceder solo a `service_role`.
- No confiar en el correo del actor como autorización: es un dato de auditoría derivado por el Edge Function tras verificar la sesión y la allowlist.
- No exponer `private.pqr_outbox` ni `private.pqr_admin_requests` al navegador.
- Bloquear `pqr_submissions` con `FOR UPDATE` para serializar acciones administrativas.

## Hallazgos de esquema confirmados

- `pqr_submissions.notification_status`, `notification_sent_at` y `notification_error` existen.
- `pqr_events` contiene `response`, `actor_email`, `email_status`; el check de `event_type` admite `status_changed`, `internal_note`, `response_sent`, `notification_retry`.
- `pqr_events.email_status` admite `sent`, `failed` o `null`.
- No existen RPC de Outbox instaladas en producción; la consulta de catálogo solo devolvió `pqr_consume_rate_limit`.

## Bloqueos antes de ejecución

- La consulta confirma el esquema de columnas, pero no compila el SQL candidato ni valida las constraints/índices de las tablas privadas que aún no existen.
- No se ha ejecutado el SQL en PostgreSQL aislado, ni se ha probado concurrencia, rollback, Deno, navegador o envío real.
- El worker ya está incorporado como `docs/recovery/outbox-implementation-candidate/pqr-outbox-worker/index.ts`; continúa siendo candidato sin despliegue ni ejecución.
- El retry manual implementado reencola solo `applicant_confirmation`; no reintenta `admin_response` en dead-letter.
- No hay scheduler/cron configurado.

## Pruebas obligatorias

1. Respuestas concurrentes: solo una transición/evento/job.
2. Repetición idéntica: resultado original sin duplicados.
3. Misma clave con payload distinto: conflicto.
4. Fallo de cualquier inserción: rollback total.
5. Respuesta solo desde `En gestión`; rechazo desde otros estados.
6. Cambio manual a `Respondida`: rechazo.
7. Fallo Resend: caso permanece `Respondida`, Outbox reintentable.
8. Retry de confirmación: no envía desde el Edge Function ni cambia el estado.
9. Actor fuera de allowlist: 403 antes de RPC.
10. Contrato GET/adjuntos compatible con el panel.

**No validado:** compilación SQL, PostgreSQL de integración, Deno, navegador, Edge Function runtime ni worker end-to-end.

## Revisión de integración adicional — 2026-11-08

- Contraste de solo lectura contra el esquema remoto: las columnas `notification_status`, `notification_sent_at` y `notification_error` existen en `public.pqr_submissions`; `pqr_events` incluye `response`, `actor_email` y los checks actuales admiten `response_sent` / `notification_retry`, y `email_status` acepta `sent` / `failed` / `null`.
- Se corrigió el GET/listado del Edge Function para seleccionar `version`. Sin esa columna en el `select`, todas las acciones administrativas posteriores a la primera habrían enviado versión 1 y fallado por versión obsoleta.
- Se corrigió el panel para no permitir seleccionar manualmente `Respondida` y para tratar la respuesta formal como registrada/en cola, porque el Edge Function devuelve `{ ok, result }` y el correo se entrega asincrónicamente; no devuelve `email_status` ni envía el correo en la misma petición.
- Se verificó que el worker está ahora presente en la rama y que sus nombres/campos de claim coinciden con `pqr_outbox_claim`.
- El contrato y el panel aún requieren pruebas de integración reales. No se ha compilado SQL ni ejecutado Deno/browser.
