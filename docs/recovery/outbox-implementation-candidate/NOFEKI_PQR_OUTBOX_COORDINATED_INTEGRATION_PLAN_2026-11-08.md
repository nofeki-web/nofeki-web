# NOFEKI PQR — plan de integración coordinada Outbox

Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: diseño de implementación; no cambia producción.

## Objetivo

Mover el envío de correos PQR fuera de las solicitudes HTTP de radicación y administración, garantizando que el evento de negocio y su tarea de correo se registren en la misma transacción PostgreSQL. El worker procesa después las tareas y aplica reintentos.

## Estado real que debe respetarse

- `pqr-submit` desplegada v6: sube adjunto a Storage, inserta `pqr_submissions`, luego envía confirmación y alerta en forma secuencial y actualiza `notification_status`. No escribe Outbox.
- `pqr-admin` desplegada v9: autentica usuario y allowlist `nofeki07@gmail.com`; responde por correo directamente, guarda evento después y mantiene el estado que el administrador haya elegido.
- El RPC candidato `pqr_admin_create_response` cambia automáticamente el estado a `Respondida`. Esto es un cambio funcional frente a v9 y no debe activarse sin aprobación expresa del propietario.
- La base actual no tiene la columna `version`; el SQL candidato la añade.
- El worker solo puede procesar filas Outbox; por sí mismo no crea filas de confirmación/alerta.

## Secuencia propuesta de despliegue (no ejecutar todavía)

### Fase 0 — entorno de validación
1. Crear entorno PostgreSQL aislado que reproduzca tablas, constraints, grants, RLS, buckets y funciones actuales.
2. Ejecutar SQL candidato solo allí.
3. Ejecutar pruebas pgTAP: rollback atómico, doble idempotency key, conflicto de fingerprint, control optimista de versión, transiciones, claim concurrente, lease vencido, fencing token, retry y dead-letter.
4. Corregir todos los errores antes de generar migración definitiva.

### Fase 1 — compatibilidad aditiva
1. Aplicar cambios aditivos en entorno de staging: tabla privada Outbox, tabla de idempotencia administrativa y `version`.
2. Mantener las funciones v6/v9 existentes sin cambios. Aún no se escribe Outbox desde producción.
3. Verificar que la aplicación actual sigue funcionando con el esquema extendido.

### Fase 2 — radicación transaccional
1. Crear RPC pública controlada para radicación que inserte `pqr_submissions`, evento inicial si se define, y dos Outbox (`applicant_confirmation`, `internal_alert`) en una única transacción.
2. Mantener validaciones actuales de origen, honeypot, Turnstile, límites, formatos y rate limit en `pqr-submit`.
3. El archivo se sube primero a Storage porque no comparte transacción con PostgreSQL. Si falla el RPC, eliminar el objeto; si la compensación falla, registrar un identificador de limpieza seguro y activar alerta operacional. Nunca responder 201 si el registro no quedó confirmado.
4. El RPC debe validar parámetros otra vez; no confiar solo en validación de Edge Function. Evitar que la clave de idempotencia sea reutilizable con payload diferente.
5. Tras comprobar el RPC en staging, preparar versión nueva de `pqr-submit` que invoque el RPC y deje de enviar correos inline.
6. Activar Outbox solo después de tener el worker operativo y la programación de ejecución comprobada.

### Fase 3 — administración
1. Actualizar `pqr-admin` conservando la validación bearer token mediante `auth.getUser` y la allowlist exacta vigente.
2. Mantener GET de listado/detalle y URLs firmadas del adjunto; sustituir `select("*")` por columnas explícitas y preservar el contrato JSON que usa `pqr-admin.html`.
3. Reemplazar escrituras directas separadas por RPC atómicas con expected version, request id y fingerprint.
4. Notas y cambios de estado deben escribir evento y actualizar estado dentro de una transacción.
5. Respuesta administrativa debe crear evento + Outbox atómicamente. **Antes de implementar, el propietario debe decidir si la acción "Responder" también cambia automáticamente el estado a "Respondida".** El comportamiento actual v9 no lo hace.
6. Agregar acción de reintento dead-letter dirigida a un Outbox concreto, con actor auditado, confirmación del operador, nueva clave de idempotencia cuando la clave original haya superado 24 horas y protección contra reenvío inadvertido.

### Fase 4 — worker y scheduler
1. Instalar el worker candidato en su ruta deployable solo después de pruebas en staging.
2. Guardar secretos server-side: Resend, remitente, destinatario interno y secreto dedicado de invocación.
3. Elegir scheduler fiable (pg_cron/HTTP, Supabase Cron u orquestador externo) después de revisar compatibilidad, frecuencia, autenticación y reintentos del scheduler. No crear cron todavía.
4. Probar invocación sin token, token incorrecto, lote vacío, lote normal, proveedor 429/5xx, timeout ambiguo, fallo de finish, lease vencido y reintento.
5. Configurar métricas/alertas para filas dead, antigüedad de cola, errores persistentes y falta de invocaciones.

## Contrato de integración del worker

- RPC de claim devuelve `outbox_id, submission_id, source_event_id, event_key, event_type, lease_token, attempt_number, lease_expires_at`.
- Tipos admitidos: `applicant_confirmation`, `internal_alert`, `admin_response`.
- Respuesta administrativa obtiene el cuerpo desde `pqr_events.response` con `source_event_id`.
- Carga columnas explícitas desde `pqr_submissions`.
- Resend recibe `Idempotency-Key = event_key`.
- Solo un lease token vigente puede terminar o reprogramar una fila.
- Límite de idempotencia del proveedor: 24 horas; las recuperaciones manuales posteriores necesitan nueva clave y nueva auditoría.
- El worker no expone endpoint público sin secreto interno y no recibe datos PII del scheduler.

## Rollback

- Antes de activar nuevos escritores, rollback es simplemente mantener las funciones antiguas.
- Después de activar escritor Outbox, no volver a una función antigua que envíe correos inline: podría duplicar envíos. Primero detener la creación de nuevos eventos Outbox de forma coordinada y drenar la cola.
- No borrar filas Outbox, eventos, ni idempotency records durante rollback.
- Mantener SQL aditivo y compatible hasta confirmar que no existen lectores/escritores antiguos.

## Pruebas añadidas en esta etapa

`supabase/functions/tests/pqr-outbox-worker-model.node.test.mjs`

Modelo en memoria cubre exclusión de claim, lease vencido y fencing token, backoff, dead-letter, respuesta de proveedor ambigua con la misma clave y límite de retención. No ejecuta Deno, Supabase ni Resend y no sustituye las pruebas PostgreSQL.

## Bloqueadores antes de integrar panel y producción

1. Pruebas reales PostgreSQL aislado y revisión de seguridad.
2. Contrato de idempotencia para radicación, incluyendo fingerprint del payload y adjunto.
3. Confirmar si responder debe cambiar el estado automáticamente.
4. Elegir scheduler y estrategia de monitoreo.
5. Aprobación explícita para cambios en staging y, separadamente, en producción.
