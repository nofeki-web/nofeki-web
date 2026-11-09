# NOFEKI PQR — integración candidata de radicación con Outbox
Fecha: 2026-11-08
Rama: `recovery/pqr-outbox-implementation-20261108`
Estado: candidato documental/SQL; no desplegado ni ejecutado.

## Objetivo
Sustituir en `pqr-submit` el INSERT directo y los dos envíos síncronos a Resend por una sola RPC transaccional que guarde la radicación y cree dos trabajos Outbox.

## RPC propuesta
Archivo de referencia: `NOFEKI_PQR_SUBMISSION_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql`.

`public.pqr_create_submission_v2(p_request_key, p_fingerprint, p_submission)`:
- Inserta el registro de idempotencia, la submission y dos eventos Outbox en una sola transacción.
- Un replay con la misma clave y fingerprint devuelve el radicado original.
- Misma clave y fingerprint distinto produce conflicto `PT409`.
- La transacción revierte request key, submission y Outbox si falla cualquiera de los inserts.
- No envía correo y no guarda el cuerpo PQR en Outbox.
- Mantiene los campos y restricciones actuales; no cambia privacy_version por su cuenta.

## Adaptación de Edge Function
Al portar el código desplegado v6:
1. Conservar allowlist CORS, método POST, tamaño máximo, honeypot, validación de campos, consentimiento, Turnstile y hostname.
2. Conservar `pqr_consume_rate_limit` con límite 5/3600; no reemplazarlo.
3. Conservar verificación MIME, tamaño 5 MiB y firma binaria para PDF/JPG/PNG.
4. Generar ID/reference una sola vez por request lógico; calcular fingerprint SHA-256 del contenido normalizado (tipo, nombre, email, asunto, mensaje, consentimiento/version legal y metadatos/hash de adjunto). Excluir token Turnstile, IP y campos volátiles.
5. Requerir `Idempotency-Key` UUID del cliente. El formulario debe conservar la misma clave al reintentar un timeout y generar una nueva solo cuando el usuario inicia una nueva radicación.
6. Subir el adjunto antes de la RPC a ruta determinística ligada a request key. No usar upsert ciego: si el objeto ya existe, verificar tamaño/hash/metadatos antes de reutilizarlo.
7. Invocar RPC una sola vez con columnas explícitas.
8. Si RPC crea el caso: responder 201; si replay: responder 200; si fingerprint difiere: 409.
9. Si RPC falla antes de confirmar: intentar borrar el adjunto. Registrar fallo de compensación de forma sanitizada y programar reconciliación de objetos huérfanos; no borrar el archivo si la RPC devolvió replay.
10. Eliminar de `pqr-submit` todo envío a Resend y todo UPDATE posterior de notification_status. La notificación queda pendiente y el worker la procesa.
11. Respuesta al usuario debe informar radicación, no prometer que el email ya fue entregado.

## Riesgos detectados / puertas obligatorias
- **Frontend aún no inspeccionado ni adaptado:** sin `Idempotency-Key` estable no se obtiene deduplicación de reintentos entre solicitudes HTTP. No activar el nuevo contrato hasta integrar el formulario.
- **Adjuntos y retry:** Storage no participa en la transacción PostgreSQL. La ruta estable, hash y reconciliación de huérfanos deben probarse.
- **RPC requiere Outbox existente:** este SQL depende de `private.pqr_outbox` y de la capa base del candidato Outbox.
- **Eventos iniciales:** el esquema actual permite tipos conocidos, pero no se agrega evento de historial inicial hasta confirmar el contrato del panel.
- **Email summary:** `notification_status` debe mantenerse compatible; su agregado se actualiza desde worker/RPC, no desde el request público.
- **Rate limit:** hoy se consume antes de la idempotencia. Un retry podría consumir otra unidad. Para no debilitar el límite, mantenerlo al principio en primera iteración; en PostgreSQL aislado evaluar una política que no permita abusos ni penalice retries legítimos.
- **Fingerprint:** debe incluir hash criptográfico del adjunto, no el base64 ni el token Turnstile.

## Pruebas PostgreSQL requeridas
- Alta nueva crea 1 submission + 2 outbox.
- Misma key/fingerprint concurrente: 1 submission, 2 outbox; la segunda llamada devuelve replay.
- Misma key/fingerprint diferente: PT409 y cero mutaciones adicionales.
- Fallo al insertar submission: request key revierte.
- Fallo al insertar Outbox: submission y request key revierten.
- Retry con adjunto existente y hash coincidente no duplica ni sobrescribe.
- RPC falla y compensación elimina objeto.
- Fallo de compensación deja identificador de huérfano para reconciliación.
- Sin adjunto: no se intenta Storage.
- Turnstile inválido / rate limit excedido: no se invoca RPC.
- Verificar permisos, RLS, schema private, función SECURITY INVOKER y search_path vacío.

## Estado
No se ha modificado `supabase/functions/pqr-submit/index.ts`, frontend, Supabase, Storage, secretos ni despliegues. Este artefacto completa el contrato de radicación en la rama recovery, pero no constituye integración funcional probada.
