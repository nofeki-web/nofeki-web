# 02 — Worker y adaptación de Edge Functions

**Candidato; no desplegar.** Se parte del snapshot desplegado reconciliado y de los archivos `canonical-candidate`, pero no se reemplaza código activo todavía.

## 1. Worker: ciclo seguro

1. Invocar `pqr_outbox_claim(batch=10, lease=120s)`.
2. Por cada item, validar versión/tipo del payload y reconstruir el email desde datos actuales de PQR (evitar duplicar PII en outbox).
3. Enviar a Resend fuera de la transacción SQL, con `Idempotency-Key: event_key`.
4. En éxito, invocar finalize con id, token, ID de Resend y hora de aceptación.
5. Si finalize retorna cero filas, registrar lease obsoleto; no intentar forzar el estado.
6. En fallo temporal (429, 5xx, timeout, error de red), calcular backoff exponencial con jitter y llamar retry.
7. En fallo permanente (dirección inválida, payload rechazado por 4xx no recuperable), marcar dead y emitir métrica/alerta administrativa.
8. Nunca loggear email completo, cuerpo, PQR, token, service-role key o Resend key.

## 2. Política de retry inicial

- intentos máximos: 8.
- retraso base: 30 segundos.
- fórmula: min(30s × 2^(attempts-1), 6h) + jitter aleatorio 0–20%.
- 429: respetar Retry-After si viene y limitar a 6h.
- 5xx / timeout / fallo de red: retry.
- 400/401/403 de configuración o payload: dead y alerta; no repetir indefinidamente.
- Al alcanzar máximo, dead letter; no borrar fila.

Los valores son propuesta inicial y deben ajustarse a los límites/volumen observados de Resend.

## 3. Idempotencia del proveedor

Resend documenta `Idempotency-Key` para `POST /emails`; la retención publicada es 24 horas. Enviar la clave del outbox como header en cada retry. La clave única del outbox impide crear dos intenciones para el mismo evento a largo plazo, pero la protección de Resend no debe presentarse como garantía indefinida: un retry tras expirar la ventana podría duplicar si el proveedor ya aceptó el correo y no se registró el finalize.

Fuente: https://resend.com/changelog/idempotency-keys

## 4. Cambios de `pqr-submit`

El flujo objetivo:
- Mantener validación de origen, Turnstile, rate limit actual (5/hora), MIME + firma binaria y bucket privado.
- Exigir `Idempotency-Key` UUID del cliente para cada intento lógico; validar UUID y fingerprint en backend.
- Subir adjunto usando una ruta estable ligada a request key/submission ID y manejar reintento de upload con `upsert=false` de forma idempotente (comprobar existencia y hash/metadata; no sobrescribir silenciosamente).
- Invocar un solo RPC de creación que inserta submission, request key, evento inicial y dos outbox events atómicamente.
- No llamar Resend dentro de `pqr-submit`.
- Responder 201 para creación nueva y 200 para replay, con mismo reference_code. Responder 409 cuando una clave se reutiliza con payload distinto.
- El mensaje al usuario indica radicación exitosa; estado de correo queda pendiente hasta worker.

Riesgo de adjuntos: Storage y Postgres no comparten transacción. Debe existir compensación: si el RPC falla después del upload, intentar borrar objeto; y un proceso de reconciliación para objetos huérfanos. Nunca eliminar un adjunto si el RPC devolvió replay de una radicación existente.

## 5. Cambios de `pqr-admin`

- Conservar auth manual actual `auth.getUser(token)` y allowlist exacta; no ampliar administradores.
- GET: cambiar `select(*)` por columnas explícitas tras comprobar contrato del panel. No tocar en esta fase si la UI consume campos no inventariados.
- `status`: invocar RPC atómico con expected status + request UUID; el panel debe conservar el request UUID al reintentar y mostrar conflicto 409 para refrescar estado.
- `respond`: persistir respuesta + historial + outbox; no enviar email síncrono. Devolver `email_status: queued`.
- `retry_notification`: dejar de enviar en línea; solicitar requeue auditado del evento correspondiente, con motivo y actor. El endpoint debe responder queued/requeued, no sent.
- `note`: mantener separado, insertar evento de nota; si se requiere deduplicación, incorporar request UUID.
- El panel debe distinguir `queued`, `delivered`, `dead` y `retrying`; no mostrar "enviado" solo porque el trabajo se encoló.

## 6. Worker endpoint / seguridad

Opciones de ejecución a evaluar en entorno aislado:
- Edge Function privada invocada por scheduler externo autenticado, o
- Supabase Cron/pg_cron + llamada HTTP firmada al worker.

No configurar Cron en producción en esta fase. No crear endpoint `verify_jwt=false` sin autenticación alternativa fuerte. El worker requiere service-role solo en servidor y no devuelve payload PQR al invocador. Añadir límite de lote, timeout y protección contra ejecuciones concurrentes.

## 7. Estado agregado de notificaciones

No calcular el resumen del caso a partir del éxito de un único correo:
- `sent`: todos los correos requeridos del evento de radicación están delivered.
- `pending`: al menos uno pending/processing y ninguno dead.
- `failed`: uno o más dead / error permanente.
- `not_configured`: proveedor/remitente no configurado (mantener distinción de error de configuración).
Se debe decidir si una notificación de respuesta modifica `pqr_submissions.notification_status`; recomendación: no, esa columna resume solo notificaciones iniciales y el panel muestra outbox para respuestas.

## 8. Limitación de entrega

Outbox asegura atomicidad entre cambio de base de datos e intención de notificar. No puede hacer atómica una llamada HTTP a Resend. Resend idempotency mejora el resultado, pero la retención de 24h deja una ventana de ambigüedad residual.
