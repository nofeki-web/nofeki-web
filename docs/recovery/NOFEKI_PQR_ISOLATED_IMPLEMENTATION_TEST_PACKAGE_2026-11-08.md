# NOFEKI PQR — paquete aislado de implementación y validación
Fecha: 2026-11-08
Rama destino: `recovery/pqr-admin-retry-fix-20261108`

> **SOLO LABORATORIO. NO ES MIGRACIÓN. NO EJECUTAR EN PRODUCCIÓN.**
> Este paquete define un esquema de ensayo separado (`pqr_lab`), tablas ficticias y contratos para probar atomicidad, idempotencia, leases y fencing. No depende de las tablas reales `pqr_submissions` ni `pqr_events`. No se aplicó SQL a Supabase.

## 1. Objetivo de salida

Validar, antes de adaptar el diseño al esquema real:

1. Una petición repetida con la misma clave y huella no crea otro caso.
2. La misma clave con contenido distinto produce conflicto.
3. La mutación del caso, el evento de historial y la intención de notificación son atómicos.
4. Dos workers no reclaman simultáneamente el mismo evento vigente.
5. Un worker antiguo no puede finalizar un evento después de que otro haya recuperado su lease.
6. El fallo del proveedor programa reintento; el error permanente termina en dead-letter.
7. Un evento entregado no vuelve a enviarse por un reintento normal.

## 2. Modelo aislado de laboratorio

Objetos propuestos, todos dentro del esquema privado `pqr_lab`:

- `submissions`: caso ficticio y estado actual.
- `request_keys`: clave de idempotencia y huella del request.
- `events`: historial inmutable.
- `outbox`: intenciones de notificación y estado del worker.
- RPCs: `create_submission`, `transition_submission`, `claim_outbox`, `finish_outbox`, `retry_outbox`.

No se debe crear ninguna tabla de ensayo en `public`. El esquema no debe quedar expuesto por la Data API. El cambio de Supabase que impide la exposición automática de nuevas tablas en proyectos existentes desde el 30-oct-2026 refuerza que no debemos asumir exposición ni permisos por defecto; el diseño evita depender de ellos.

## 3. SQL de laboratorio — DDL de referencia

Ejecutar únicamente en una base PostgreSQL desechable, después de confirmar que se trata de un entorno aislado sin datos reales. El bloque es deliberadamente independiente de los nombres/columnas del esquema PQR actual.

```sql
begin;

create schema if not exists pqr_lab;

create table pqr_lab.submissions (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  request_fingerprint text not null,
  status text not null default 'Recibida'
    check (status in ('Recibida','En revisión','Respondida','Cerrada')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pqr_lab.request_keys (
  idempotency_key text primary key,
  request_fingerprint text not null,
  submission_id uuid not null unique references pqr_lab.submissions(id),
  created_at timestamptz not null default now()
);

create table pqr_lab.events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references pqr_lab.submissions(id),
  event_key text not null unique,
  event_type text not null,
  from_status text,
  to_status text,
  actor_ref text not null,
  request_id text not null,
  created_at timestamptz not null default now()
);

create table pqr_lab.outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  submission_id uuid not null references pqr_lab.submissions(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','delivered','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lock_token uuid,
  delivered_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'processing' and locked_until is not null and lock_token is not null)
    or status <> 'processing'
  )
);

create index outbox_pending_due_idx
  on pqr_lab.outbox (available_at, created_at)
  where status = 'pending';

create index outbox_expired_lease_idx
  on pqr_lab.outbox (locked_until)
  where status = 'processing';

-- No grants to anon/authenticated. Lab functions are not a public API.
revoke all on schema pqr_lab from public;
revoke all on all tables in schema pqr_lab from public;
revoke all on all functions in schema pqr_lab from public;

commit;
```

**Nota:** el DDL crea únicamente estructuras. No configura roles del proyecto ni autoriza a `service_role`. En una prueba local se ejecuta con el propietario del laboratorio. La futura implementación Supabase debe definir explícitamente `USAGE`, privilegios mínimos de tabla y `EXECUTE` para el rol backend requerido; jamás conceder acceso directo a `anon` o `authenticated`.

## 4. Contratos transaccionales

### 4.1 Crear solicitud

`create_submission(idempotency_key, fingerprint, subject, actor_ref)`

En una sola transacción:

1. Validar que clave y huella no estén vacías.
2. Buscar/bloquear la clave de idempotencia.
3. Si existe y la huella coincide, devolver el caso original con `replayed=true`.
4. Si existe y la huella difiere, devolver conflicto; no mutar datos.
5. Si no existe, insertar caso, clave, evento `submitted` y outbox `pqr:<submission_id>:submitted:v1`.
6. Devolver el caso y el identificador del evento.

La restricción única es la autoridad final frente a dos peticiones concurrentes. No implementar la deduplicación solo como un SELECT previo desde Edge Function.

### 4.2 Cambiar estado

`transition_submission(submission_id, expected_version, new_status, request_id, actor_ref)`

En una sola transacción:

- Bloquear la fila del caso con `FOR UPDATE`.
- Comprobar versión esperada y transición permitida.
- Deducir una clave determinista desde caso + request_id.
- Si ya existe el evento de esa petición, devolver el resultado previo.
- Actualizar estado y versión.
- Insertar evento de historial.
- Insertar outbox.
- Devolver estado/versión/evento.

Una versión obsoleta debe devolver conflicto sin escribir historial ni outbox. La llamada no envía correos.

### 4.3 Reclamar eventos

`claim_outbox(batch_size, lease_seconds)`

- Limitar tamaño de lote y duración de lease en servidor.
- En una transacción corta seleccionar eventos `pending` vencidos y `processing` con lease expirado.
- Usar `FOR UPDATE SKIP LOCKED`.
- Cambiar a `processing`, incrementar intentos, asignar `locked_until` y un `lock_token` nuevo por fila.
- Confirmar transacción antes de hacer llamadas de red.

### 4.4 Finalizar / reintentar

`finish_outbox(id, lock_token, provider_message_id)` actualiza solo si coinciden ID, estado `processing` y token. Si no coincide, devuelve `stale_lease`.

`retry_outbox(id, lock_token, sanitized_error, next_available_at)` aplica la misma condición de fencing. El backoff y el límite de intentos se aplican en servidor; errores permanentes pasan a `dead`.

No guardar credenciales, tokens, contenido completo del correo ni datos sensibles en `last_error`.

## 5. Reglas de seguridad para el futuro despliegue

- Esquema privado y fuera de los esquemas expuestos por Data API.
- RLS como defensa adicional si se conceden privilegios a roles que puedan acceder a tablas; preferir ningún acceso directo desde cliente.
- Preferir funciones `SECURITY INVOKER`. Si una función `SECURITY DEFINER` resulta imprescindible, justificarlo, fijar `search_path = ''`, cualificar cada objeto, comprobar autorización dentro de la función y revocar `EXECUTE` a `PUBLIC`, `anon` y `authenticated`.
- Conceder solo al rol backend necesario. No poner service-role/secret key en navegador, app ni Atajo iOS.
- No usar `user_metadata` como fuente de autorización.
- Mantener allowlist/rol de administrador validado en backend.
- Payload mínimo y sin adjuntos binarios: guardar referencia segura al archivo, no copiar el archivo al outbox.
- Auditoría de acciones manuales de reintento: actor, motivo, evento objetivo y request ID.
- Ejecutar Supabase Advisors y revisar permisos efectivos antes de cualquier rollout.

## 6. Matriz de pruebas de integración PostgreSQL

| ID | Preparación / acción | Resultado exigido |
|---|---|---|
| DB-01 | Crear con clave K y huella H | 1 caso, 1 evento, 1 outbox |
| DB-02 | Repetir K + H | Mismo caso; ningún registro nuevo |
| DB-03 | Repetir K + H2 | Conflicto; estado intacto |
| DB-04 | Dos sesiones crean K + H simultáneamente | Un caso único; ambas obtienen resultado coherente |
| DB-05 | Forzar excepción después de insertar caso y antes de outbox | Rollback completo |
| DB-06 | Transición con versión vigente | Estado + historial + outbox atómicos |
| DB-07 | Transición con versión antigua | Conflicto; cero escrituras |
| DB-08 | Dos sesiones reclaman el mismo lote | Ningún evento con dos leases vigentes |
| DB-09 | Expirar lease y reclamar con worker B | Token nuevo; lease anterior inválido |
| DB-10 | Worker A finaliza con token viejo | `stale_lease`; no pisa B |
| DB-11 | Error transitorio | `pending`, intentos +1, `available_at` futuro |
| DB-12 | Error permanente / intentos agotados | `dead`; visible para administración |
| DB-13 | Finalizar entregado y reclamar de nuevo | No vuelve a reclamarse |
| DB-14 | Proveedor acepta y worker cae antes de finalizar | Ambigüedad documentada; idempotencia del proveedor si existe |
| DB-15 | Token de lease incorrecto | Ninguna mutación |
| DB-16 | Rol anon/authenticated intenta leer outbox | Denegado |
| DB-17 | Rol anon/authenticated intenta ejecutar RPC worker | Denegado |
| DB-18 | Dos transiciones diferentes compiten por misma versión | Una gana; la otra recibe conflicto |

## 7. Prueba de concurrencia: procedimiento de dos sesiones

En PostgreSQL real, abrir dos sesiones independientes contra la base de laboratorio:

1. Sesión A inicia una transacción y reclama el lote.
2. Antes de confirmar A, sesión B ejecuta la misma reclamación.
3. Verificar que B salta las filas bloqueadas por A y no recibe el mismo evento.
4. Confirmar A.
5. Verificar que B sigue sin recibir el evento mientras el lease de A esté vigente.
6. Expirar el lease de A en el reloj de ensayo o esperar el tiempo configurado.
7. B reclama el evento con token nuevo.
8. A intenta finalizar con su token viejo: debe obtener `stale_lease`.
9. B finaliza con el token nuevo: debe quedar `delivered`.

La prueba debe repetirse con rollback de A, desconexión de sesión y múltiples workers.

## 8. Qué falta para que sea ejecutable contra el proyecto real

Este paquete no inventa columnas ni relaciones de producción. Antes de escribir una migración real hay que obtener:

- DDL exacto y constraints de `pqr_submissions`, `pqr_events` y tabla de notificaciones.
- Firmas y cuerpos actuales de `pqr_consume_rate_limit` y demás RPCs.
- Grants, RLS y esquema de cada tabla.
- Campos reales para destinatarios, plantillas y adjuntos.
- Proveedor de correo, soporte documentado de idempotency key y ventana de retención.
- Confirmación de qué versión de Edge Functions está desplegada realmente.

## 9. Estado de ejecución

- [x] Diseño outbox y contratos previos revisados.
- [x] Esquema de laboratorio y reglas de seguridad especificados.
- [x] Matriz de 18 pruebas de integración definida.
- [ ] SQL ejecutado en PostgreSQL aislado.
- [ ] Pruebas de dos sesiones/concurrencia ejecutadas.
- [ ] Pruebas de permisos/RLS ejecutadas.
- [ ] Integración con proveedor verificada.
- [ ] Adaptación a esquema real revisada.
- [ ] Migración/PR de implementación autorizada.

**Límite actual:** no hay motor PostgreSQL/Deno disponible en el PC corporativo y no se ha conectado una base aislada para ejecutar estas pruebas. Por eso el documento no marca como ejecutadas las pruebas de integración. El modelo Node previo solo valida lógica simulada en memoria y no sustituye estas pruebas.
