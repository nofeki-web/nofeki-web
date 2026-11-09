# NOFEKI PQR — RPC atómicas de administración y Outbox

Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: contrato técnico candidato; no ejecutado contra Supabase.

## 1. Objetivo

Convertir la política aprobada de estados y la respuesta administrativa en operaciones de base de datos atómicas e idempotentes. La Edge Function conserva autenticación y allowlist; PostgreSQL es la autoridad final para transiciones, concurrencia, idempotencia, auditoría y creación de eventos Outbox.

Supabase recomienda funciones de base de datos para operaciones de datos que deben ejecutarse dentro de PostgreSQL. Se prefiere SECURITY INVOKER y privilegios explícitos. Documentación: https://supabase.com/docs/guides/database/functions

## 2. Modelo adicional requerido (candidato)

### 2.1 Versionado de submission
Agregar `version BIGINT NOT NULL DEFAULT 1` a `public.pqr_submissions`. Incrementar en cada mutación de negocio efectiva. Esto permite que el panel use optimistic concurrency y que las respuestas obsoletas no sobrescriban el estado reciente.

### 2.2 Registro idempotente de mutaciones administrativas
Crear `private.pqr_admin_requests`:
- `request_id UUID PRIMARY KEY`
- `submission_id UUID NOT NULL REFERENCES public.pqr_submissions(id)`
- `operation_type TEXT CHECK IN ('status_transition','admin_response','dead_letter_retry')`
- `request_fingerprint TEXT CHECK SHA-256 hex de 64 caracteres`
- `result JSONB` nullable hasta que la mutación termine
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `completed_at TIMESTAMPTZ`

La clave se inserta dentro de la misma transacción de mutación. La unicidad arbitra solicitudes concurrentes. Una clave reutilizada con submission, tipo o fingerprint diferente se rechaza con HTTP 409. Una repetición idéntica devuelve el resultado almacenado y no vuelve a insertar eventos. El fingerprint lo calcula la Edge Function a partir de payload normalizado validado; nunca se acepta un hash enviado directamente por el navegador.

### 2.3 Vincular Outbox con el evento de origen
El diseño actual de `private.pqr_outbox` no tiene referencia a `pqr_events`. Añadir `source_event_id UUID REFERENCES public.pqr_events(id) ON DELETE RESTRICT` (o equivalente obligatorio para `admin_response`). Es necesario porque el worker debe saber exactamente qué texto de respuesta corresponde a cada correo; no debe inferirlo leyendo “la última respuesta” de una PQR que puede tener varias respuestas históricas.

Clave única sugerida: `event_key` determinista y estable, por ejemplo `pqr:<submission_id>:response:<response_event_id>`. Para el cambio de estado no se crea correo por defecto; para la respuesta se crea exactamente un evento Outbox `admin_response`.

Evitar duplicar cuerpo, correo o nombre en la tabla Outbox. El worker carga el mínimo necesario desde `pqr_submissions` y el `pqr_events` identificado por `source_event_id`.

## 3. RPC: transición de estado

Nombre candidato: `public.pqr_admin_transition_status`.

Parámetros:
- `p_submission_id UUID`
- `p_expected_status TEXT`
- `p_expected_version BIGINT`
- `p_target_status TEXT`
- `p_request_id UUID`
- `p_request_fingerprint TEXT`
- `p_actor_email TEXT` validado por la Edge Function
- `p_reason TEXT` opcional; obligatorio en reapertura

Algoritmo transaccional (una invocación = una transacción PostgreSQL):
1. Validar parámetros, tipo de operación y fingerprint.
2. Insertar `private.pqr_admin_requests` con `ON CONFLICT DO NOTHING`.
3. Si la clave ya existía, bloquear/leer el registro. Comparar submission_id, operation_type y fingerprint. Si difieren, devolver error de conflicto. Si coincide y result está completo, devolver el resultado persistido; si la petición está todavía en curso, esperar el bloqueo de la fila única y después releer, o devolver estado idempotente sin ejecutar una segunda mutación.
4. Bloquear `public.pqr_submissions` con `SELECT ... FOR UPDATE`.
5. Comparar estado y versión esperados. Si no coinciden, error HTTP 409 mediante SQLSTATE PostgREST `PT409`; no usar SQLSTATE 40001 para un conflicto de negocio.
6. Si target = estado actual, almacenar resultado no-op idempotente sin insertar pqr_events ni Outbox.
7. Validar estrictamente la matriz aprobada. Reapertura Respondida → En gestión exige motivo no vacío.
8. Actualizar status, version = version + 1, updated_at = clock_timestamp()/now() del servidor.
9. Insertar exactamente un `pqr_events` con actor, event_type `status_changed`, old_status, new_status, note/motivo.
10. Guardar result y completed_at en `private.pqr_admin_requests`.
11. Retornar solo después de todas las escrituras. Cualquier excepción revierte actualización, evento y registro idempotente.

La RPC no envía correo. Un cambio de estado no implica una notificación salvo que una regla de producto posterior lo exija expresamente.

## 4. RPC: respuesta administrativa

Nombre candidato: `public.pqr_admin_create_response`.

Parámetros:
- `p_submission_id UUID`
- `p_expected_status TEXT` debe ser `En gestión`
- `p_expected_version BIGINT`
- `p_response_request_id UUID`
- `p_request_fingerprint TEXT` hash de submission + respuesta normalizada + plantilla/versión si aplica
- `p_actor_email TEXT` validado por Edge Function
- `p_response TEXT`

Algoritmo:
1. Validar respuesta no vacía, límites y normalización en Edge Function y volver a validar mínimos en RPC.
2. Reservar idempotencia en `private.pqr_admin_requests` usando operation_type `admin_response`.
3. En replay idéntico devolver el event_id/outbox_id previos; no crear una segunda respuesta ni un segundo correo.
4. Bloquear submission con `FOR UPDATE`; validar status `En gestión` y expected_version.
5. Insertar `pqr_events` event_type `response_sent`, response y actor.
6. Insertar Outbox `admin_response` con source_event_id apuntando a ese evento y event_key determinista.
7. Cambiar status a `Respondida`, incrementar version y updated_at. El orden dentro de la transacción no altera atomicidad; cualquier error debe revertir las tres escrituras.
8. Guardar el resultado idempotente y confirmar.
9. Worker envía después, fuera de la transacción. La interfaz muestra “respuesta registrada / correo en cola” hasta que el worker registre aceptación del proveedor.

Si la PQR ya no está En gestión, no permitir una respuesta que la devuelva implícitamente a Respondida. Se requiere recargar y una acción explícita de reapertura si el caso está Respondida.

## 5. Seguridad y códigos de error

- Edge Function verifica bearer token, usuario Auth y allowlist antes de invocar RPC.
- No aceptar actor_email del browser; la Edge Function lo deriva del usuario verificado.
- RPC SECURITY INVOKER, `SET search_path = ''`, objetos totalmente calificados.
- Revocar EXECUTE de PUBLIC, anon y authenticated; conceder solo a service_role si la llamada se hace desde Edge Function con service role.
- El esquema private no se expone al Data API; RLS habilitado como defensa adicional y grants mínimos.
- No dar acceso al cliente web a `private.pqr_admin_requests` ni a Outbox.
- Para conflictos de negocio usar `RAISE SQLSTATE 'PT409'` o error estándar mapeado por Edge Function. Supabase KB del 2026-11-04 advierte que PostgREST 14 puede reintentar errores de negocio levantados como 40001 y causar bucles: https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
- No usar SECURITY DEFINER como atajo de permisos.

## 6. Contrato worker

El claim debe devolver `outbox_id`, `submission_id`, `source_event_id`, `event_key`, `event_type`, `lease_token`, `attempt_number`, `lease_expires_at`.

Para `admin_response`, el worker carga `pqr_events.response` por `source_event_id`, y el correo destino desde la submission. No usar SELECT *; seleccionar solo columnas necesarias.

Envía Resend con la misma `event_key` como idempotency key. Tras aceptación inequívoca ejecuta finish con fencing token. Ante timeout ambiguo, reintenta con el mismo event_key y registra incertidumbre si la retención del proveedor ya no cubre el evento. No prometer exactly-once externo.

## 7. Casos de prueba de integración PostgreSQL obligatorios

- Repetir mismo request_id/fingerprint: misma respuesta, una mutación, un evento y un outbox.
- Reutilizar request_id con fingerprint distinto: PT409, cero escrituras.
- Dos transiciones simultáneas con la misma expected_version: una gana; la otra PT409.
- Fallo forzado después del UPDATE y antes del INSERT de evento: rollback completo.
- Fallo forzado al insertar Outbox tras evento de respuesta: rollback completo de status, evento y request idempotente.
- Dos respuestas concurrentes con la misma clave: una sola respuesta/outbox.
- Misma clave de respuesta con texto distinto: PT409.
- Response event siempre se enlaza al Outbox correcto mediante source_event_id.
- Usuario anon/authenticated no puede ejecutar RPC ni leer tablas privadas.
- Worker stale lease no puede finalizar ni reprogramar fila tras fencing token rotado.

## 8. Límites de verificación

El entorno actual no dispone de PostgreSQL aislado, Docker/Podman ni Deno. El contrato está documentado, pero no se afirma que el SQL compile ni que las transacciones hayan sido probadas en PostgreSQL. No ejecutar este documento en producción. Antes de generar una migración real, revisar grants/roles, schema exposed list, default privileges, extensiones y columnas exactas de la base aislada.
