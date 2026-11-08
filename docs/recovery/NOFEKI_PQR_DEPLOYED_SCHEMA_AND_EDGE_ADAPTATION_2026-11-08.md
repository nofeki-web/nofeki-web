# NOFEKI PQR — adaptación técnica al esquema y funciones desplegadas
Fecha de inspección: 2026-11-08
Proyecto inspeccionado: `bxjgodhqseoxrnshqtfr` (PostgreSQL 17.11)
Rama de trabajo: `recovery/pqr-admin-retry-fix-20261108`

> **Inspección de solo lectura.** No se ejecutó DDL, no se insertaron datos, no se cambiaron permisos, no se desplegaron funciones y no se enviaron correos.

## 1. Hallazgo que cambia el plan: el código desplegado y GitHub no son idénticos

Se recuperó el código de las Edge Functions activas directamente desde Supabase y se comparó con los archivos de la rama de recuperación.

| Función | Desplegada | Versión | SHA-256 bundle | Fuente GitHub (rama recuperación) |
|---|---:|---:|---|---|
| `pqr-submit` | ACTIVE | 6 | `ad212775d2484fcfd9fd8c065c23d9d0248b12f5670f163817a0c4d7804d10e8` | distinta |
| `pqr-admin` | ACTIVE | 9 | `b91c45b26500300ed55e4258e653493b76527cdc9a93d5a18b6c925b40dffb1f` | distinta |

Los tamaños y contenidos recuperados no coinciden con los archivos de la rama de recuperación. Por tanto:
- No se debe desplegar la rama completa suponiendo que representa el código vivo.
- Toda futura corrección debe partir del bundle desplegado o reconciliar explícitamente las diferencias.
- El repositorio no es todavía una fuente de verdad demostrada para las dos funciones PQR desplegadas.
- No se afirma que la rama de recuperación sea la versión actualmente en producción.

## 2. Esquema PQR real inspeccionado

Las tres tablas PQR existentes están en `public`, tienen RLS activado y, en el momento de la inspección, reportaron cero filas.

### `public.pqr_submissions`

| Columna | Tipo / comportamiento |
|---|---|
| id | uuid PK, gen_random_uuid() |
| reference_code | text UNIQUE |
| request_type | text con CHECK de seis tipos |
| full_name | text, 2–120 |
| email | text, máximo 254 |
| subject | text, 3–160 |
| message | text, 10–5000 |
| attachment_path | text nullable |
| status | text, default Recibida; CHECK de cinco estados |
| privacy_version | text, default 1.2 |
| consented_at | timestamptz, default now() |
| source_hash | text nullable |
| created_at | timestamptz |
| notification_status | text, default pending; CHECK pending/sent/failed/not_configured |
| notification_error | text nullable |
| notification_sent_at | timestamptz nullable |
| responded_at | timestamptz nullable |
| updated_at | timestamptz |

Estados permitidos en la constraint: `Recibida`, `En revisión`, `En gestión`, `Respondida`, `Cerrada`.

### `public.pqr_events`

| Columna | Tipo / comportamiento |
|---|---|
| id | uuid PK |
| submission_id | uuid FK a pqr_submissions.id |
| actor_email | text |
| event_type | text con CHECK |
| old_status | text nullable |
| new_status | text nullable |
| note | text nullable |
| response | text nullable |
| email_status | text nullable; CHECK sent/failed/not_configured |
| created_at | timestamptz |

Tipos permitidos actualmente: `status_changed`, `internal_note`, `response_sent`, `notification_retry`.

### `public.pqr_rate_limits`

- `source_hash` text PK con validación SHA-256 hexadecimal.
- `window_started_at` timestamptz.
- `request_count` integer no negativo.
- `updated_at` timestamptz.

No hay una tabla de notificaciones/outbox en el esquema actual.

## 3. Función de rate limit existente

Existe `public.pqr_consume_rate_limit(p_source_hash text, p_limit integer, p_window_seconds integer) returns boolean`.

- Usa UPSERT sobre `pqr_rate_limits` para incrementar o reiniciar la ventana.
- Tiene `search_path = ''`.
- Es `SECURITY INVOKER` (no definer).
- ACL observado: EXECUTE para `postgres` y `service_role`; no se observó concesión a `anon` ni `authenticated`.
- La Edge Function desplegada `pqr-submit` la invoca con límite 5 por 3600 segundos.

Esta función se debe preservar. No se debe reemplazar por un contador de aplicación ni por un SELECT seguido de INSERT.

## 4. Estado de permisos y RLS observado

- RLS está habilitado en `pqr_submissions`, `pqr_events` y `pqr_rate_limits`.
- La consulta a `pg_policies` no devolvió políticas para esas tres tablas.
- Los grants de tabla observados fueron para `postgres` y `service_role`; no aparecieron grants de tabla para `anon` o `authenticated`.
- El código de las funciones usa la service-role key únicamente en Edge Functions del servidor.

La alerta INFO de Supabase `rls_enabled_no_policy` aparece para esas tres tablas y también para dos tablas de atajos. En este modelo, ausencia de políticas + ausencia de grants a clientes evita el acceso directo de esos roles; la función backend privilegiada opera con service role. No se debe “resolver” la alerta agregando políticas permisivas. La solución correcta es mantener acceso mínimo y verificar los grants efectivos tras cualquier cambio.

Supabase Advisors también informó:
- WARN: protección de contraseñas filtradas deshabilitada (configuración Auth, no es parte del cambio PQR).
- INFO: dos índices no utilizados en otras tablas (no relacionados con PQR).
- Health: sin findings en la consulta realizada.

## 5. Flujo actual confirmado en la fuente desplegada

### `pqr-submit` (versión 6)

- Valida origen, JSON y tamaño.
- Verifica Cloudflare Turnstile y hostname `nofeki.com` / `www.nofeki.com`.
- Consume rate limit mediante `pqr_consume_rate_limit`.
- Valida adjunto PDF/JPG/PNG y firma binaria; carga a bucket `pqr-attachments`.
- Inserta `pqr_submissions`.
- Envía confirmación al solicitante y luego correo interno a NOFEKI.
- Actualiza `notification_status`, `notification_error`, `notification_sent_at`.
- No implementa clave de idempotencia entrante ni outbox.
- La carga del archivo y el insert de la fila son operaciones separadas.

### `pqr-admin` (versión 9)

- Tiene `verify_jwt=false`, pero valida manualmente el bearer token con `auth.getUser(token)`.
- Mantiene allowlist de administrador de un solo correo; no ampliarla en esta etapa.
- Acciones `status`, `note`, `respond`, `retry_notification` viven en una única función.
- `status`: actualiza la fila y luego inserta el evento por separado.
- `respond`: envía correo antes de guardar el evento de respuesta; luego actualiza `responded_at`.
- `retry_notification`: envía correo, actualiza estado y después inserta evento; la fuente desplegada no comprueba los errores de ambas escrituras finales de manera robusta.
- Lectura de detalle usa `select(*)`; debe pasar a una lista explícita de columnas al refactorizar.

## 6. Mapeo del diseño Outbox a las columnas reales

| Operación | Datos actuales que se conservan | Cambio objetivo |
|---|---|---|
| Crear PQR | campos actuales de `pqr_submissions`, `reference_code`, `source_hash`, `attachment_path` | insertar caso + evento inicial + notificaciones pendientes en una sola transacción |
| Historial | `pqr_events.submission_id, actor_email, event_type, old_status, new_status, note, response, email_status` | insertar historial dentro de la misma transacción de mutación |
| Estado | `pqr_submissions.status, updated_at, responded_at` | control optimista con versión o expected-status; hoy no existe columna version |
| Notificación | `notification_status, notification_error, notification_sent_at` | mantenerlas como resumen/compatibilidad; outbox será la fuente por evento |
| Reintento | `pqr_events.event_type='notification_retry'` | acción administrativa debe encolar/reencolar evento concreto y auditar actor/motivo |
| Adjunto | `attachment_path` y bucket privado existente | mantener storage privado; compensación/limpieza durable para archivo huérfano |

### Decisiones de compatibilidad

1. No renombrar ni eliminar columnas actuales durante la primera fase.
2. Agregar una columna `version bigint not null default 1` solo mediante migración posterior y con prueba de concurrencia.
3. Crear `private.pqr_outbox` y, si se decide, `private.pqr_request_keys`; no crear tablas nuevas en `public`.
4. El outbox no debe guardar el texto completo de PQR ni adjuntos. Guardar solo IDs y metadatos mínimos; el worker obtiene campos necesarios de la fila usando acceso backend.
5. Las notificaciones iniciales son dos eventos independientes: `applicant_confirmation` y `internal_alert`. El éxito de uno no debe marcar el otro como enviado.
6. Una respuesta del administrador es un tercer tipo de evento. Su contenido se conserva en `pqr_events.response` según política de retención existente, pero el outbox debe evitar duplicar ese texto.
7. El worker no debe leer `pqr_submissions` desde el cliente; solo backend autorizado.

## 7. Orden de implementación recomendado (todavía NO ejecutado)

### Fase A — Reconciliación del código desplegado
- Guardar una copia controlada del source bundle exacto de versiones 6 y 9.
- Comparar línea por línea con GitHub y decidir qué cambios de la rama se deben portar.
- Identificar el origen de las diferencias y fijar un commit de referencia.

### Fase B — Migración aditiva
- Crear schema `private` si aún no existe, comprobando el estado antes.
- Crear tabla outbox con claves únicas, índices parciales, lease y fencing token.
- Crear request-key store con fingerprint y referencia al caso.
- Agregar versión de concurrencia a submissions.
- No conceder acceso a `anon` ni `authenticated`.
- Revisar default privileges, ACL y RLS; evitar SECURITY DEFINER salvo justificación.
- Mantener rate limiter existente sin cambios.

### Fase C — RPCs atómicas
- `pqr_create_submission`: solicitud + request key + evento inicial + dos outbox events.
- `pqr_transition_submission`: lock + expected version + estado + evento + outbox.
- `pqr_record_admin_response`: respuesta + evento + outbox, sin enviar correo.
- `pqr_claim_outbox`: lote limitado con `FOR UPDATE SKIP LOCKED`, lease y token nuevo.
- `pqr_finish_outbox`, `pqr_retry_outbox`, `pqr_dead_letter_outbox`: validar token de lease en cada escritura.
- Todas las firmas y grants deben quedar restringidos a la capa backend prevista.

### Fase D — Edge Functions
- `pqr-submit`: mantener Turnstile, validación, rate limit y carga; reemplazar insert+emails por RPC transaccional y devolver la misma referencia en retry.
- `pqr-admin`: mantener auth y allowlist; las acciones status/respond/retry llaman RPCs, no hacen escrituras múltiples desde TS.
- Nueva función worker interna: reclama, envía mediante Resend y finaliza/reintenta con lock token.
- Mantener CORS, límites, logs sanitizados y nunca exponer service-role key.

### Fase E — Pruebas y rollout
- Pruebas de integración PostgreSQL, sesiones concurrentes y rollback.
- Verificación del soporte de idempotency key de Resend; si no existe para el endpoint de email, documentar la ventana inevitable de duplicado tras aceptación y crash.
- Probar adjunto + rollback y limpieza compensatoria.
- Ejecutar Security Advisors y revisar grants.
- Despliegue solo después de reconciliar fuente y obtener aprobación explícita.

## 8. Riesgos y decisiones abiertas

- **Referencia/idempotency key del cliente:** el formulario público debe generar una clave estable por intento y reutilizarla cuando reintenta tras timeout. Si no podemos modificar el frontend, se puede generar clave en servidor, pero no se podrá deduplicar una petición repetida tras perder la respuesta.
- **Adjuntos:** Storage y Postgres no comparten transacción. Se requiere patrón compensatorio: upload con ID de intento, insert transaccional, y limpieza/reconciliación de objetos huérfanos.
- **Email exactamente una vez:** no se puede garantizar solo con PostgreSQL. Verificar idempotencia del proveedor y usar el mismo event key como provider idempotency key si está soportado.
- **Versionado:** el esquema real no tiene `version`; debe agregarse antes de usar control optimista.
- **Estados:** las constraints de base y la lista de estados del admin coinciden hoy, pero las transiciones permitidas (grafo) no están definidas por la DB; definirlas explícitamente antes de codificar RPC.
- **Retención de datos:** definir cuánto tiempo se conserva `response` y payloads de notificación. No ampliar datos personales dentro del outbox.

## 9. Resultado de esta etapa

- [x] Source bundle desplegado recuperado para ambas Edge Functions.
- [x] Diferencias con GitHub confirmadas.
- [x] Columnas, constraints, FKs y RLS de las tres tablas PQR inspeccionadas.
- [x] Función rate limit, firma, definición, search_path y ACL inspeccionados.
- [x] Políticas y grants revisados.
- [x] Advisors de seguridad, rendimiento y health consultados.
- [x] Diseño outbox mapeado a esquema real sin cambiarlo.
- [ ] Código de producción reconciliado con repositorio.
- [ ] Migración/RPC implementada.
- [ ] Pruebas PostgreSQL ejecutadas.
- [ ] Worker y proveedor integrados.
- [ ] Aprobación de despliegue.

**Conclusión:** ya existe información suficiente para diseñar la migración real sin inventar columnas. El siguiente paso seguro no es ejecutar DDL: es reconciliar las versiones desplegadas 6/9 con los archivos de GitHub y acordar el grafo de estados, la clave de idempotencia del formulario y la política de reintentos del proveedor.
