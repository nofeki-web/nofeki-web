# NOFEKI PQR — revisión estática y matriz de regresión
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`
Estado: preparación sin despliegue; no se ejecutaron solicitudes contra producción.

## Alcance y seguridad
Se revisaron los archivos `supabase/functions/pqr-submit/index.ts` y `supabase/functions/pqr-admin/index.ts` de esta rama. No se modificó Supabase, Auth, Storage, secretos, variables de entorno ni Vercel. No se enviaron correos, no se insertaron PQR y no se ejecutaron pruebas contra el proyecto real.

El entorno aislado no está disponible actualmente por restricción de costo. Por tanto, esta revisión es estática: no equivale a pruebas de integración ni autoriza despliegue.

## Hallazgos de código

### pqr-submit
1. La rama ya comprueba el error devuelto al persistir `notification_status` después de insertar la PQR. Si falla esa actualización, conserva la radicación y devuelve HTTP 201 con `notification_status_persisted: false`. Esto evita que el frontend interprete como fallida una PQR que ya quedó insertada y vuelva a radicarla.
2. El envío de confirmación al usuario y notificación interna es secuencial. Si el primer correo se envía y el segundo falla, el estado global queda `failed`; un reintento puede duplicar el primer correo. Requiere decisión funcional y prueba antes de modificar.
3. El control de duplicados por reintento del POST no está demostrado por el código revisado. La referencia UUID se genera en cada solicitud; el honeypot y el rate limit no constituyen idempotencia. No reenviar automáticamente desde el cliente al recibir timeout sin una estrategia de idempotencia.

### pqr-admin
1. En la acción `respond`, el correo se intenta enviar antes de persistir `responded_at` y el evento. Si el correo sale y luego falla la escritura del evento, la respuesta HTTP indica `history_saved: false`; repetir la acción podría enviar el mismo correo otra vez. La advertencia no debe ocultarse en UI.
2. En `retry_notification`, el correo se envía antes de actualizar el estado y registrar el evento. Un fallo posterior de base de datos puede dejar un correo enviado sin auditoría; reintentar puede duplicarlo.
3. En la acción `status`, primero se actualiza el estado y después se inserta el evento. Si falla el segundo paso, la operación queda parcialmente aplicada. Se necesita transacción/RPC atómica o compensación diseñada y probada; no cambiarlo en producción desde este documento.
4. La autorización de administrador está codificada mediante allowlist de correo. Verificar que solo la identidad autorizada actual pueda acceder; no ampliar esa lista como parte de esta corrección.

## Matriz obligatoria antes de desplegar

### pqr-submit
- [ ] OPTIONS desde `https://nofeki.com` y `https://www.nofeki.com`: 200 y CORS exacto.
- [ ] Origen no permitido: 403; no insertar filas ni subir adjuntos.
- [ ] Método distinto de POST/OPTIONS: 405.
- [ ] JSON inválido, campos fuera de límites, consentimiento ausente: 400; sin escrituras.
- [ ] Turnstile ausente/no configurado: respuesta controlada; sin PQR.
- [ ] Turnstile inválido o hostname ajeno: 403; sin PQR.
- [ ] Rate limit RPC error: 503; no continuar.
- [ ] Rate limit excedido: 429; no continuar.
- [ ] Adjunto PDF/JPEG/PNG válido <=5 MiB: upload privado y una PQR asociada.
- [ ] MIME/extensión declarados pero firma binaria no coincide: 400; sin upload.
- [ ] Fallo de insert PQR después del upload: borrar el objeto huérfano.
- [ ] Ambos correos enviados: 201, estado sent persistido.
- [ ] Resend no configurado: 201, PQR guardada, estado not_configured.
- [ ] Error al enviar correo: 201, PQR guardada, estado failed.
- [ ] Error al actualizar metadatos de notificación: 201, referencia estable en respuesta, `notification_status_persisted:false`; no duplicar PQR.
- [ ] Fallo parcial de los dos correos: validar qué correo salió y que el reintento no lo duplique (caso bloqueante para definir idempotencia).

### pqr-admin
- [ ] Sin bearer token / token inválido: 401.
- [ ] Usuario autenticado no incluido en allowlist: 403.
- [ ] Origen externo: 403; OPTIONS de dominios permitidos funciona.
- [ ] GET listado, filtro por estado y búsqueda: solo campos previstos.
- [ ] GET detalle: eventos ordenados; URL firmada de adjunto expira a los 300 s.
- [ ] Radicado inexistente: 404.
- [ ] Cambio de estado válido: estado y evento coinciden.
- [ ] Fallo al insertar evento tras cambiar estado: detectar y no declarar éxito; probar atomicidad/recuperación.
- [ ] Nota interna vacía: 400; nota válida: evento interno sin correo.
- [ ] Respuesta válida, Resend enviado: correo y evento registrados una sola vez.
- [ ] Resend falla/no configurado: resultado explícito, sin marcar correo como enviado.
- [ ] Correo enviado y escritura de responded_at falla: caso crítico de posible duplicado al reintentar.
- [ ] Correo enviado y evento falla: respuesta con `history_saved:false`, advertencia visible y procedimiento de conciliación.
- [ ] retry_notification: validar éxito, error de Resend, error de update y error de evento; impedir doble envío al reintentar tras fallo parcial.
- [ ] Acción desconocida y payload inválido: 400 controlado.

## Criterios de aceptación
1. Cero despliegues y cero cambios en producción durante esta fase.
2. Las pruebas deben ejecutarse en un proyecto/branch aislado aprobado o con mocks deterministas que no contacten Resend, Turnstile, Storage ni la base productiva.
3. Probar fallos entre cada efecto externo y cada escritura, no solo el camino feliz.
4. No declarar idempotencia ni entrega de correo exactamente-una-vez sin mecanismo persistente y prueba concurrente.
5. Confirmar CORS explícito en cada respuesta de Edge Function. El gateway ya no debe asumirse como responsable de añadir CORS; consultar la guía vigente.
6. Obtener evidencia de tests, logs y estado de base de datos antes de autorizar un PR o despliegue.

## Orden de trabajo cuando exista entorno sin costo adicional
1. Construir harness de pruebas con adaptadores/mocks para Resend, Turnstile, Storage y Supabase DB.
2. Resolver idempotencia y consistencia de `respond`, `retry_notification` y `status`.
3. Ejecutar toda la matriz y pruebas concurrentes de reintento.
4. Revisión de seguridad, diff final y aprobación explícita antes de cualquier despliegue.

## Referencias
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- CORS para Edge Functions: https://supabase.com/docs/guides/functions/cors
- Pruebas locales de Edge Functions: https://supabase.com/docs/guides/functions/local-testing
- Changelog de breaking changes: https://supabase.com/changelog?types=breaking-change
- Aviso TLS HTTP APIs (desde 10 nov 2026, earliest): https://supabase.com/changelog/cbc-tls-ciphers-deprecated

## Nota de plataforma
El changelog vigente identifica dos asuntos de compatibilidad a vigilar: el cambio de ciphers CBC TLS 1.2 en HTTP APIs a partir del 10 de noviembre de 2026 como fecha más temprana, y la guía de CORS debe ser implementada por cada Edge Function; no asumir que el gateway añade cabeceras CORS. La función PQR ya define cabeceras CORS propias, pero debe verificarse con preflight y respuesta real.
