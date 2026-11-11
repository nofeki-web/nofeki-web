# NOFEKI PQR — contrato de implementación del worker Outbox
Fecha: 2026-11-09
Rama: `recovery/pqr-admin-retry-fix-20261108`
Estado: diseño técnico previo a implementación; no desplegado ni probado.

## 1. Alcance

El worker procesa exclusivamente filas de `private.pqr_outbox` reclamadas mediante `public.pqr_outbox_claim`. No acepta instrucciones de destinatario, asunto, HTML o contenido de correo desde el navegador. Carga los datos mínimos desde el radicado y el evento fuente usando el cliente Supabase con service role, dentro de la Edge Function.

Eventos soportados:
- `applicant_confirmation`: confirmación de recepción al solicitante.
- `internal_alert`: aviso interno de nuevo radicado.
- `admin_response`: respuesta formal ya persistida en `pqr_events`.

No se implementa envío directo desde `pqr-submit` ni `pqr-admin` una vez integrado el Outbox.

## 2. Invocación y autorización

- Función interna invocada por scheduler/cron autenticado o mecanismo privado equivalente.
- Rechazar solicitudes sin secreto de invocación válido; comparar en tiempo constante cuando sea viable.
- No habilitar CORS público ni aceptar invocación del navegador.
- Nunca exponer service role, secreto de scheduler ni credenciales Resend.
- Límite por ejecución: reclamar máximo 10 filas (RPC admite máximo 25); timeout y concurrencia configurados conservadoramente.
- La función puede ejecutarse más de una vez: la seguridad depende del lease y la idempotencia, no de una suposición de ejecución única.

## 3. Secuencia obligatoria por evento

1. Invocar `pqr_outbox_claim(batch_size, lease_seconds)`.
2. Para cada fila, cargar radicado/evento y validar que el tipo y los datos mínimos correspondan.
3. Construir el mensaje exclusivamente en servidor con plantillas versionadas.
4. Enviar a Resend con `Idempotency-Key: event_key` (el SDK debe pasar el valor como `idempotencyKey`).
5. Si Resend confirma aceptación inequívoca, llamar `pqr_outbox_finish(outbox_id, lease_token, provider_message_id)`.
6. Si Resend rechaza inequívocamente antes de aceptar, llamar `pqr_outbox_retry` con código de error sanitizado y backoff.
7. Si hay timeout, desconexión, respuesta ambigua o aceptación posible seguida de fallo al guardar, tratar como resultado incierto: no inventar éxito ni generar otra clave. Mantener el evento bloqueado para conciliación o aplicar el estado `uncertain` mediante una RPC específica antes de habilitar reintento manual.

## 4. Hallazgo que bloquea el worker final

La primera versión del SQL/worker candidato no separaba resultados ambiguos. En la revisión del 2026-11-09 se corrigió el candidato: el SQL ahora incluye `uncertain` y una RPC fenced `pqr_outbox_mark_uncertain`; el worker clasifica timeouts, fallos de red, 408/429/5xx, respuesta sin ID y fallo al persistir `finish` como inciertos. La RPC libera el lease y el claim no vuelve a reclamar estos eventos. Esta corrección es estática y todavía requiere compilación Deno y pruebas PostgreSQL aisladas.

La RPC debe:
- aceptar solo lease vigente;
- pasar de `processing` a `uncertain`;
- borrar lease y token;
- guardar código seguro, nunca cuerpo de respuesta ni datos personales;
- impedir que `claim` reclame automáticamente `uncertain`;
- exigir conciliación administrativa auditada para reabrir el evento.

## 5. Política de reintentos

- Reintentar solo fallos transitorios inequívocos.
- Backoff exponencial con jitter, acotado por el máximo permitido por la RPC y por `max_attempts`.
- Errores permanentes de destinatario/configuración deben terminar en `dead` o una clasificación terminal equivalente; no ciclar indefinidamente.
- Cada reintento conserva exactamente el mismo `event_key`.
- `delivered` es terminal.
- `dead` requiere acción administrativa auditada.
- `uncertain` nunca se reenvía automáticamente.

## 6. Construcción de mensajes

- Confirmación al solicitante: destinatario desde `pqr_submissions.email`; radicado y resumen mínimo desde registro persistido.
- Alerta interna: dirección desde secreto/configuración de servidor, nunca desde payload público.
- Respuesta administrativa: destinatario desde radicado y cuerpo desde evento `response_sent` asociado por `source_event_id`.
- Escapar contenido no confiable en HTML. No interpretar texto del solicitante como HTML.
- No incluir adjuntos en notificaciones por defecto.
- No registrar PII, contenido del mensaje, adjuntos, tokens, API keys ni headers de autorización en logs.

## 7. Observabilidad

Registrar solo: outbox_id, event_type, intento, resultado categórico, duración, provider_message_id cuando exista y código seguro. Nunca registrar email completo ni contenido.

Métricas mínimas: filas reclamadas, entregadas, reintentadas, muertas, inciertas, antigüedad de la más antigua y errores de RPC/proveedor.

## 8. Criterios de aceptación

- Dos workers concurrentes no obtienen el mismo lease vigente.
- Un lease expirado se puede reclamar con token nuevo.
- El token antiguo no puede finalizar ni reintentar.
- Cada evento lógico usa una clave Resend estable.
- Confirmación y alerta interna son eventos independientes.
- Fallo de una notificación no altera la otra.
- Timeout ambiguo nunca se convierte en reenvío automático.
- Mensaje administrativo se obtiene del evento exacto, no de un campo mutable del frontend.
- La función no registra PII ni secretos.
- Se prueba con adaptador falso; no se envían correos reales durante pruebas.

## 9. Dependencias pendientes

1. Añadir estado `uncertain` y RPC fenced de conciliación.
2. Confirmar columnas reales para email/nombre/radicado y estructura exacta de `pqr_events`.
3. Verificar el soporte actual de idempotency key en la versión del SDK Resend usada por el proyecto.
4. Definir mecanismo de scheduler y secreto de invocación sin abrir endpoint público.
5. Implementar y probar en entorno aislado con Deno y PostgreSQL antes de integrar o desplegar.

## 10. Estado de seguridad

Este documento no crea una Edge Function ni configura cron. No se han enviado correos, cambiado secretos, modificado Supabase ni desplegado código.


## Implementación candidata disponible (2026-11-09)

Existe código en `docs/recovery/outbox-implementation-candidate/pqr-outbox-worker/index.ts`. La revisión de hoy corrigió la clasificación de resultados ambiguos y añadió la RPC de cuarentena en el SQL candidato. No se ha copiado a `supabase/functions`, no se ha desplegado y no se ha configurado scheduler.

La verificación estática recuperando los archivos desde GitHub confirmó:
- estado `uncertain` incluido en constraint;
- RPC con fencing token;
- EXECUTE revocado de PUBLIC/anon/authenticated y concedido a service_role;
- worker invoca la RPC de cuarentena en vez de reintentar automáticamente;
- misma clave `event_key` enviada a Resend.

La verificación no compila TypeScript ni SQL. La política de recuperación administrativa de `uncertain` sigue pendiente.


## 11. Límite temporal de idempotencia del proveedor — bloqueo añadido 2026-11-10

La clave `event_key` solo deduplica dentro de la ventana de retención garantizada por el proveedor. El backoff configurado suma aproximadamente 13,7 horas en condiciones ideales, pero no limita las pausas del scheduler ni el tiempo real entre intentos. Por tanto, no basta con conservar la misma clave: el worker debe aplicar un límite temporal persistido.

Antes de la primera llamada a Resend, registrar en base de datos `first_provider_attempt_at` (o un vencimiento equivalente), sin reiniciarlo en reintentos. `pqr_outbox_claim` debe devolver ese dato. El worker debe comparar el tiempo actual con un límite conservador anterior al vencimiento documentado por Resend y, si ya se alcanzó, no llamar al proveedor: debe poner el evento en `uncertain` y exigir conciliación administrativa auditada. La marca debe persistir aunque el proceso se reinicie. La política exacta debe verificarse contra la documentación vigente de Resend y probarse con pausas de scheduler superiores a 24 horas.

Este control no está implementado en el SQL ni en el worker actuales. OUT-05 de la matriz es bloqueante. No declarar el worker listo hasta implementar y probar este límite.
