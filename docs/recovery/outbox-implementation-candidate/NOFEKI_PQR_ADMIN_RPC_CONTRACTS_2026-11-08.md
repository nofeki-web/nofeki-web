# NOFEKI PQR — contratos RPC administrativos v2

**Estado:** contrato de implementación candidato; no ejecutar ni desplegar.  
**Rama:** `recovery/pqr-outbox-implementation-20261108`.

## Decisión funcional aplicada

- Una respuesta formal registrada desde `En gestión` cambia el caso a `Respondida` dentro de la misma transacción que crea el evento `response_sent` y el trabajo Outbox `admin_response`.
- El envío del correo es independiente del estado del caso. Un fallo deja el caso `Respondida` y el Outbox reintentable.
- El cambio manual de estado no puede asignar `Respondida`.
- `Cerrada` sigue siendo una acción administrativa separada. Un caso cerrado no admite una nueva respuesta en esta primera versión.
- Las operaciones mutables deben ser idempotentes: misma clave y mismo contenido devuelve el resultado original; misma clave con contenido distinto devuelve conflicto.
- La lista/detalle/adjunto siguen siendo lecturas del Edge Function, con enlace firmado de 5 minutos y autorización administrativa.

## Contratos invocados por el Edge Function candidato

Todas las funciones se llaman desde `pqr-admin` con la clave `service_role`, después de validar sesión mediante `auth.getUser(token)` y verificar `ADMIN_EMAILS`. Ninguna se expone al navegador.

| Función | Parámetros | Efecto atómico |
|---|---|---|
| `public.pqr_admin_change_status_v2` | `p_request_key uuid, p_submission_id uuid, p_next_status text, p_note text, p_actor_email text` | Comprueba transición; prohíbe `Respondida`; actualiza estado/updated_at y agrega `status_changed`; registra clave idempotente. |
| `public.pqr_admin_add_note_v2` | `p_request_key uuid, p_submission_id uuid, p_note text, p_actor_email text` | Agrega `internal_note`; no cambia estado; registra clave idempotente. |
| `public.pqr_admin_respond_v2` | `p_request_key uuid, p_submission_id uuid, p_response text, p_actor_email text` | Solo desde `En gestión`; cambia a `Respondida`, fija `responded_at`, agrega `response_sent` con `email_status='not_configured'`/estado pendiente según contrato final y encola `admin_response`; todo en una transacción. |
| `public.pqr_admin_retry_notification_v2` | `p_request_key uuid, p_submission_id uuid, p_actor_email text` | Encola una nueva entrega de la notificación de radicación sin enviar correo dentro de la petición; registra evento de reintento y clave idempotente. |

## Requisitos de seguridad de las funciones

- `SECURITY INVOKER`, `SET search_path = ''`, relaciones totalmente cualificadas.
- Revocar `EXECUTE` de `PUBLIC`, `anon` y `authenticated`; conceder solo a `service_role`.
- No aceptar el email del actor como prueba de autorización: el Edge Function es quien lo deriva de la sesión verificada y lo pasa solo para auditoría.
- No conceder acceso de navegador a `private.pqr_outbox` ni a tablas de idempotencia.
- Usar huella determinista del contenido normalizado para detectar reutilización de clave con payload distinto.
- Bloquear la fila de `pqr_submissions` con `FOR UPDATE` durante cada transición para evitar respuestas simultáneas y cambios de estado perdidos.

## Dependencia que impide cerrar el SQL hoy

El candidato de creación de PQR confirma únicamente estas columnas de `private.pqr_outbox`: `submission_id`, `event_key`, `event_type`. El esquema completo del Outbox (payload, estado, intentos, lease, timestamps, constraints) y el contrato exacto que consume el worker no están presentes en los archivos recuperados de esta rama. No se debe inventar la forma de insertar `admin_response` o un retry sobre una estructura incompleta.

Antes de escribir el SQL ejecutable se debe recuperar y revisar el SQL base del Outbox y el worker real, y confirmar columnas de `pqr_events` y `pqr_submissions` contra una instantánea del esquema. La tabla `pqr_events` conocida no tiene columna `version`; no se añade ninguna suposición de versión aquí.

## Pruebas obligatorias en entorno aislado

1. Dos respuestas concurrentes: una sola transición/evento/job; la otra recibe conflicto/estado no permitido.
2. Repetición idéntica de cada acción: mismo resultado, sin eventos/jobs duplicados.
3. Misma clave con contenido distinto: conflicto.
4. Fallo en cualquier inserción: rollback de estado, evento, clave y Outbox.
5. Respuesta desde `Recibida`, `En revisión`, `Respondida` o `Cerrada`: rechazada salvo `En gestión`.
6. Cambio manual a `Respondida`: rechazado.
7. Fallo de Resend en worker: caso permanece `Respondida`; job reintentable.
8. Retry de confirmación: no envía desde el Edge Function ni cambia el estado del caso.
9. Actor no incluido en allowlist: 403 antes de invocar RPC.
10. Lecturas y enlaces firmados mantienen el contrato de respuesta que usa `pqr-admin.html`.

**No validado:** compilación SQL, integración PostgreSQL real, Deno, navegador, Edge Function runtime, worker end-to-end. No se ha ejecutado SQL ni se ha desplegado código.
