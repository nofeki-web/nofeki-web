# NOFEKI PQR — política de recuperación de correos Outbox

**Estado:** decisión técnica candidata para revisión; no desplegada.
**Rama:** `recovery/pqr-outbox-implementation-20261108`.

## 1. Límite de idempotencia del proveedor

Resend conserva las claves de idempotencia durante 24 horas. La misma clave y el mismo payload dentro de esa ventana devuelve el resultado original; la misma clave con otro payload puede producir conflicto. Esta protección no es permanente. Fuente oficial: https://resend.com/changelog/idempotency-keys

## 2. Política obligatoria

1. El worker realiza reintentos automáticos solo dentro de la ventana de 24 horas desde la creación del Outbox original. Se adopta un margen interno conservador de 23 horas.
2. Al superar ese margen, el worker no vuelve a llamar a Resend con esa clave. El trabajo se deriva a revisión manual / dead-letter.
3. Un administrador debe consultar la actividad de Resend por destinatario, asunto, intervalo temporal y contenido/radicado, sin copiar datos sensibles a logs.
4. Si Resend confirma que el mensaje fue aceptado/enviado, se registra como entregado/reconciliado y no se reenvía.
5. Si el resultado sigue siendo ambiguo, no se reenvía. Se deja en revisión hasta tener evidencia.
6. Solo si el administrador verifica que el proveedor no aceptó/envió el correo puede autorizar el reintento manual. Este crea un nuevo Outbox con nueva clave, conserva el evento fuente de respuesta cuando aplica y registra actor, Outbox original y confirmación en el historial.
7. El Outbox original permanece `dead`; no se resetea ni se reutiliza su clave.

**Advertencia:** la nueva clave permite un envío nuevo. La protección frente a duplicados en esta etapa depende de que la verificación manual sea correcta. La confirmación del administrador no convierte el proveedor en una transacción distribuida ni ofrece garantía matemática contra duplicados.

## 3. Recuperación de respuestas administrativas

El mismo mecanismo admite `admin_response` y `applicant_confirmation`. Para `admin_response` exige `source_event_id` y vuelve a usar el texto de respuesta original; no crea una segunda respuesta ni cambia el estado del caso. El evento de auditoría es `notification_retry`.

## 4. Reglas de interfaz

- Acción: **Revisar y reintentar** desde la lista de notificaciones dead-letter del panel administrativo.
- Confirmación obligatoria mediante diálogo: el administrador declara que revisó la actividad de Resend y verificó que el correo no fue aceptado ni enviado.
- Mostrar radicado, tipo de correo, fecha, último código de error y si existe identificador del proveedor.
- No mostrar acción si el Outbox no está `dead` o ya tiene `provider_message_id`.
- Al aceptar, la UI informa “Reintento encolado”, nunca “correo enviado”.
- Si no se puede confirmar la no entrega, la única acción disponible es dejar el trabajo en revisión.

## 5. Reglas del worker

- Nunca reintentar un evento después del límite de seguridad.
- Nunca reintentar automáticamente `dead`.
- El worker procesa solo `pending` y leases expirados dentro de ventana.
- `provider_message_id` no nulo impide crear reintento manual.
- Fallo de persistencia de finish mantiene el lease; al expirar la ventana, requiere reconciliación, no un nuevo envío ciego.

## 6. Pruebas nuevas requeridas

- OUTBOX-38: el worker no reclama pending con más de 23h.
- OUTBOX-39: lease expirado después de ventana pasa a revisión/dead sin envío.
- OUTBOX-40: retry manual sin confirmación explícita falla.
- OUTBOX-41: retry manual de dead-letter crea nuevo Outbox, nueva clave y conserva source_event_id.
- OUTBOX-42: reintento con provider_message_id existente se rechaza.
- OUTBOX-43: retry idempotente no crea dos Outbox.
- OUTBOX-44: retry de admin_response reenvía exactamente la respuesta original sin crear nuevo response_sent ni cambiar estado.
- OUTBOX-45: confirmación de no entrega y actor quedan auditados.
- OUTBOX-46: Outbox original queda dead e inmutable.

## 7. Límites

La inspección de Resend y la reconciliación manual son un control operativo, no una API transaccional que garantice la inexistencia de entrega. La primera versión prioriza no enviar duplicados automáticamente. Un webhook de Resend firmado, persistido en tabla de eventos de proveedor y reconciliación por `email_id` mejoraría la certeza; se recomienda como siguiente iteración, pero no es requisito para activar el bloqueo de reintento automático.