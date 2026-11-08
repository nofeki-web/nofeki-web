# 01 — Esquema y contratos SQL (referencia)

**No ejecutar en producción.** Es una especificación SQL de diseño, no una migración generada por Supabase CLI. El proyecto no debe recibir DDL hasta contar con una rama/proyecto aislado y pruebas PostgreSQL.

## 1. Objetos propuestos

### `private.pqr_outbox`

| Columna | Tipo | Regla |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| event_key | text | UNIQUE, determinística y permanente |
| submission_id | uuid | FK a `public.pqr_submissions(id)` |
| event_type | text | applicant_confirmation / internal_alert / admin_response |
| status | text | pending / processing / delivered / dead |
| payload_version | smallint | versión del formato |
| payload | jsonb | solo datos mínimos; preferir IDs y resolver datos desde PQR |
| attempts | integer | >= 0 |
| max_attempts | integer | > 0 |
| available_at | timestamptz | próximo intento |
| lease_token | uuid nullable | fencing token del worker |
| leased_until | timestamptz nullable | vencimiento del claim |
| provider_message_id | text nullable | ID devuelto por Resend |
| provider_accepted_at | timestamptz nullable | acuse del proveedor |
| delivered_at | timestamptz nullable | finalización registrada |
| last_error_code | text nullable | clase/código sanitizado |
| last_error_message | text nullable | mensaje breve sanitizado, sin PII/secrets |
| created_at / updated_at | timestamptz | auditoría |

Restricciones:
- `event_key` único globalmente.
- `status` limitado al conjunto definido.
- `attempts >= 0`, `max_attempts BETWEEN 1 AND 20`.
- `processing` requiere `lease_token` y `leased_until`; otros estados no deben conservar lease activo.
- `delivered` requiere `provider_accepted_at` y `delivered_at`.
- El payload no contiene cuerpo completo de la solicitud, adjunto, secretos, bearer token ni datos de tarjeta.

Índices:
- UNIQUE(event_key).
- parcial por (available_at, created_at, id) WHERE status='pending'.
- parcial por (leased_until, id) WHERE status='processing'.
- índice por (submission_id, created_at).

### `private.pqr_request_keys`

Para idempotencia de entrada:
- `request_key uuid primary key`
- `request_fingerprint text not null` (SHA-256 hexadecimal del payload normalizado, excluyendo token Turnstile y campos volátiles)
- `submission_id uuid not null unique references public.pqr_submissions(id)`
- `created_at timestamptz not null`

La clave y el fingerprint se insertan en la misma transacción que la radicación. Reutilizar clave + mismo fingerprint devuelve el radicado original; misma clave + fingerprint diferente produce conflicto. La clave debe ser generada por el navegador una vez por intento lógico y conservarse durante reintentos de red; generar una UUID nueva en cada POST no resuelve duplicados.

## 2. Privilegios y RLS

Esquema objetivo: `private` no expuesto al Data API. Verificar primero si ya existe y qué roles tienen USAGE. Habilitar RLS en tablas privadas como defensa en profundidad, sin políticas para clientes.

Modelo objetivo:
- `anon`: sin USAGE/CRUD/EXECUTE.
- `authenticated`: sin USAGE/CRUD/EXECUTE.
- `service_role`: acceso mínimo a través de RPC aprobados; no acceso directo desde cliente.
- `postgres`: administración/migraciones.

Los RPC de servicio deben ser `SECURITY INVOKER` y calificar todos los objetos con esquema. Revocar `EXECUTE` a `PUBLIC`, `anon` y `authenticated`; conceder solo a `service_role`. Revisar los privilegios por defecto del proyecto: revocar solo a nivel de función puede no neutralizar grants heredados de `PUBLIC`.

No crear vistas públicas del outbox. No añadir tablas internas al listado de schemas expuestos. El hecho de estar en `private` no sustituye grants ni RLS.

## 3. RPC transaccionales (contrato)

Se propone una interfaz de RPC invocada desde Edge Functions backend con service role. Las funciones deben validar parámetros, devolver resultados explícitos y no enviar HTTP ni correo.

### `public.pqr_create_submission_v2(p_request_key uuid, p_fingerprint text, p_submission jsonb, p_initial_events jsonb)`

Una única transacción:
1. Validar formato de request key y fingerprint.
2. Consultar/insertar `private.pqr_request_keys` con control de conflicto.
3. Si clave existente y fingerprint igual: devolver el submission original y `replayed=true`.
4. Si clave existente y fingerprint distinto: devolver error de conflicto sin mutar datos.
5. Insertar `public.pqr_submissions` con las columnas explícitas y valores ya validados por Edge Function.
6. Insertar evento inicial en `public.pqr_events` si el contrato de historial se aprueba.
7. Insertar dos filas outbox: `applicant_confirmation` y `internal_alert`, cada una con event_key determinística derivada del ID de submission y tipo.
8. Guardar request key → submission ID.
9. Retornar ID, reference_code y replay flag.

El RPC no acepta `source_hash` arbitrario sin validación de backend. No cambiar privacy_version 1.3 sin cotejar la versión del aviso/consentimiento que se muestra realmente.

### `public.pqr_admin_status_v2(p_submission_id uuid, p_expected_status text, p_new_status text, p_actor_email text, p_request_id uuid, p_note text)`

En una transacción:
1. Bloquear fila de submission.
2. Comparar el estado actual con `p_expected_status`; conflicto si ya cambió.
3. Comprobar el grafo de transiciones aprobado por negocio (pendiente de aprobación; no asumir todas las transiciones válidas).
4. Deduplicar `p_request_id` con una clave única persistida.
5. Actualizar estado y timestamps.
6. Insertar un único `pqr_events.status_changed`.
7. Insertar outbox solo si esa transición exige notificación.
8. Devolver estado/evento resultante.

### `public.pqr_admin_respond_v2(p_submission_id uuid, p_request_id uuid, p_actor_email text, p_response text)`

En una transacción:
1. Validar longitud de respuesta y autorización del administrador en la Edge Function antes de invocar.
2. Bloquear submission y deduplicar request ID.
3. Persistir evento `response_sent` como intención de respuesta (se recomienda renombrar conceptualmente a response_queued, pero mantener el CHECK actual en la primera migración y no cambiarlo hasta actualizar el panel).
4. Actualizar `responded_at` / `updated_at` sin cambiar status automáticamente.
5. Insertar outbox `admin_response` con clave determinística ligada al request ID.
6. Retornar `queued`, no afirmar que el email ya fue enviado.

### RPC de worker

- `public.pqr_outbox_claim(p_batch_size int, p_lease_seconds int)`: reclamar pendientes y leases vencidos con `FOR UPDATE SKIP LOCKED`; lote acotado (1–25), lease (30–600 s); incrementar attempts al reclamar o al registrar intento según política elegida; devolver lease token nuevo por fila.
- `public.pqr_outbox_finalize(p_id uuid, p_lease_token uuid, p_provider_message_id text, p_provider_accepted_at timestamptz)`: actualizar solo cuando status=processing y token coincide; cero filas = lease vencido/obsoleto.
- `public.pqr_outbox_retry(p_id uuid, p_lease_token uuid, p_error_code text, p_error_message text, p_available_at timestamptz)`: validar token; volver a pending o pasar a dead si se agotaron intentos.
- `public.pqr_outbox_mark_dead(p_id uuid, p_lease_token uuid, p_error_code text, p_error_message text)`: solo lease holder actual.
- `public.pqr_outbox_admin_requeue(p_id uuid, p_actor_email text, p_reason text)`: endpoint administrativo separado, valida allowlist en Edge Function, audita motivo y crea nueva generación de intento sin borrar historia.

Cada RPC es una sola transacción. El worker nunca recibe grants directos de tabla.

## 4. Claves determinísticas

- Confirmación: `pqr/<submission_uuid>/applicant_confirmation/v1`
- Alerta interna: `pqr/<submission_uuid>/internal_alert/v1`
- Respuesta: `pqr/<submission_uuid>/admin_response/<request_uuid>/v1`

No usar un solo key para ambos correos iniciales. Si el mismo evento y el mismo contenido se reintentan, Resend devuelve el resultado original dentro de su ventana de retención. Si el contenido cambia, no reutilizar el mismo key; tratarlo como nuevo evento de negocio.

## 5. Temas aún no cerrados

- Política de retención y borrado de outbox/request keys frente a obligaciones de PQR y privacidad.
- Si se requiere un evento de historial para la radicación inicial.
- Si el reintento manual crea nuevo event_key o reintenta el mismo evento: recomendación, reintentar el mismo evento cuando el payload no cambió; crear nueva generación si hubo corrección de destinatario/contenido.
- Transiciones de estado permitidas.
- Exposición RPC y grants actuales de `service_role` en proyecto.
