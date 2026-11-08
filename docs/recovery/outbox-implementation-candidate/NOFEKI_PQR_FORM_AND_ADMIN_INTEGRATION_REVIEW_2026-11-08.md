# NOFEKI PQR — revisión del formulario público y panel admin para Outbox
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`

> Revisión estática de fuentes de GitHub y snapshots desplegados. No se modificaron HTML, Edge Functions, base de datos ni configuración de producción. No se enviaron correos ni se crearon radicados.

## 1. Formulario público: `pqr.html`

### Contrato actual confirmado
- Campos enviados: `request_type`, `full_name`, `email`, `subject`, `message`, `consent`, `website`, `turnstileToken`, y opcionalmente `attachment{name,mime,base64}`.
- Endpoint: `POST /functions/v1/pqr-submit`.
- El formulario valida HTML y límites de archivo antes del POST.
- Desactiva el botón durante el envío, muestra el radicado devuelto y limpia el formulario tras éxito.
- Ante error conserva los campos, pero el bloque `finally` invalida y reinicia Turnstile.
- No envía encabezado ni campo de clave idempotente.
- El código actual transforma el adjunto a base64 antes del POST.
- La función desplegada v6 usa Turnstile, rate limit, valida tipos/campos y escribe privacy_version `1.3`. El HTML revisado no envía versión de política; la fuente desplegada la fija en servidor.

### Riesgo principal
Si el servidor guarda la solicitud pero la respuesta HTTP se pierde, la persona vuelve a enviar el formulario y puede crear otro radicado y dos notificaciones adicionales. El botón deshabilitado solo evita doble clic dentro de la misma página; no deduplica recargas, reintentos de red ni un nuevo intento manual.

### Cambio requerido cuando el backend esté listo
1. Al iniciar una nueva intención de radicación, generar un UUID `request_id` en el navegador.
2. Mantener ese UUID junto al borrador mientras el intento esté pendiente; reutilizarlo ante timeout, desconexión o error ambiguo. No crear otro UUID solo porque Turnstile expiró.
3. Enviar `Idempotency-Key: <uuid>` (y opcionalmente el mismo `request_id` en JSON solo si el contrato server lo requiere; elegir un único canal en la implementación final).
4. El backend valida formato, calcula fingerprint SHA-256 del payload normalizado y guarda clave + radicado + outbox en una transacción.
5. Misma clave + mismo fingerprint: devolver el mismo radicado sin crear caso ni correos nuevos. Misma clave + fingerprint distinto: HTTP 409.
6. Al éxito confirmado: limpiar borrador y clave. Si el usuario modifica sustancialmente los datos para iniciar una solicitud distinta, crear una clave nueva explícitamente.
7. Turnstile se renueva en cada intento HTTP; nunca persistir el token CAPTCHA en el borrador ni reutilizarlo en el reintento.
8. No persistir nombre, correo, mensaje ni adjunto en localStorage/sessionStorage para lograr idempotencia; persistir solo UUID y estado mínimo del intento. El backend debe calcular el fingerprint.

### Precaución de integración
No añadir el encabezado hoy de forma aislada: la Edge Function v6 no implementa idempotencia, por lo que lo ignoraría. Activar cliente y servidor en el mismo despliegue coordinado.

## 2. Panel administrativo: `pqr-admin.html`

### Contrato actual confirmado
- Autenticación mediante Supabase Auth y sesión persistida.
- Cada llamada a `pqr-admin` adjunta bearer token y publishable key.
- La Edge Function verifica usuario y allowlist antes de operar.
- La interfaz permite listar, filtrar por estado, buscar y abrir detalle.
- Acciones actuales: `status`, `note`, `respond`.
- No hay control visible para `retry_notification`, aunque la función v9 admite esa acción.
- El selector presenta los cinco estados permitidos por backend: `Recibida`, `En revisión`, `En gestión`, `Respondida`, `Cerrada`.
- No hay grafo de transiciones: UI y backend aceptan cualquier salto entre esos cinco estados, incluido un estado igual al actual.
- La acción de respuesta no envía identificador idempotente. Si la petición se pierde tras el envío, un nuevo clic puede enviar una segunda respuesta.
- La UI ya distingue correo enviado de historial guardado mediante `history_saved`, pero no evita el reenvío duplicado.
- La lectura de detalle en el backend usa `select("*")`; reducir a columnas explícitas en el refactor.

### Cambios requeridos para Outbox
- Estado: enviar `expected_status` y `expected_version` (cuando la columna version exista) y una `transition_request_id` estable. El backend debe rechazar conflictos HTTP 409 y no permitir que un estado antiguo sobrescriba uno más reciente.
- Respuesta: crear `response_request_id` estable por respuesta preparada. Al confirmar el envío, el cliente conserva el mismo identificador en caso de timeout y el backend devuelve el resultado persistido en lugar de crear otro correo.
- Reintento: agregar un control explícito “Reintentar confirmación” solo cuando exista un evento fallido/dead elegible. El control debe apuntar al evento Outbox exacto, no regenerar un correo a partir de `pqr_submissions` ni enviar sin consultar estado.
- Historial: mostrar por separado el estado de cada notificación (confirmación, alerta interna, respuesta), sin inferir que ambas iniciales fueron enviadas por un solo `notification_status`.
- Estado de UI: diferenciar “en cola”, “procesando”, “enviado”, “reintento programado” y “requiere revisión”; no mostrar “enviado” hasta que el worker confirme la aceptación del proveedor y se persista el ACK.
- Acciones con escritura: deshabilitar el botón mientras espera, pero confiar en idempotencia de backend, no solo en la UI.

## 3. Grafo de estados

La fuente actual solo define el conjunto de cinco valores, no los movimientos permitidos. No se inventa una política. Antes de programar la RPC debe confirmarse con NOFEKI si se permite:
- Recibida → En revisión
- En revisión → En gestión
- En gestión → Respondida
- Respondida → Cerrada
- Cualquier reapertura o corrección posterior

Propuesta conservadora para aprobación: permitir avance secuencial y transiciones explícitas de corrección/reapertura solo por acción administrativa auditada. No codificar hasta aprobación del dueño del proceso.

## 4. Matriz de cambios coordinados

| Capa | Cambio | Dependencia |
|---|---|---|
| Formulario público | UUID estable por intento + reuso ante retry | RPC idempotente y contrato HTTP |
| `pqr-submit` | claim/replay de request key + transacción PQR/event/outbox | tablas privadas y RPC |
| Panel admin | IDs estables para status/response | RPCs idempotentes |
| `pqr-admin` | transición atómica, respuesta persistida y reintento de evento | grafo aprobado y outbox |
| Worker | claim/lease/fencing + Resend idempotency key | tabla outbox, cron/invocación protegida |
| Historial UI | estados por evento | API admin nueva de detalle |

## 5. Hallazgos que bloquean una implementación segura
1. No hay clave idempotente en el formulario ni en la API.
2. No existe grafo de estados aprobado.
3. El panel no expone reintento de notificación aunque el backend sí tiene acción; antes de agregarlo debe rediseñarse para seleccionar evento Outbox.
4. La respuesta administrativa no es idempotente y el correo se envía antes de persistir el historial.
5. El HTML actual y la Edge Function desplegada no pueden actualizarse por separado sin una ventana de incompatibilidad.

## 6. Orden de integración recomendado
1. Aprobar grafo de estados y reglas de reapertura.
2. Terminar y probar en base aislada las RPC atómicas y el worker.
3. Publicar API backend compatible que acepte claves idempotentes sin retirar inmediatamente los parámetros antiguos.
4. Actualizar formulario y panel admin en el mismo release coordinado.
5. Probar reintentos con pérdida de respuesta HTTP, doble clic, refresh, sesión expirada, Turnstile renovado, respuesta administrativa y concurrencia de dos administradores.
6. Verificar RLS/grants, Advisors y logs; después solicitar aprobación separada para despliegue.

## 7. Estado
- [x] Formulario público inspeccionado.
- [x] Panel administrativo inspeccionado.
- [x] Contratos actuales comparados con funciones desplegadas v6/v9 recuperadas.
- [x] Contrato de idempotencia del cliente documentado.
- [x] Brecha de retry_notification y grafo de estados documentados.
- [ ] Grafo de estados aprobado.
- [ ] RPCs y worker implementados y probados en aislamiento.
- [ ] HTML y Edge Functions integrados.
- [ ] Despliegue aprobado.
