# NOFEKI PQR — diseño de idempotencia y consistencia de notificaciones
Fecha: 2026-11-08
Estado: propuesta técnica preparada; NO aplicada, NO es migración y NO fue probada en una base de datos.
Rama: `recovery/pqr-admin-retry-fix-20261108`

## 1. Decisión técnica

No es seguro intentar resolver duplicados solo con un `SELECT` previo a Resend ni con una comprobación en `pqr_events`: dos solicitudes concurrentes pueden leer "no existe" y enviar dos correos. Tampoco es seguro registrar el evento después del correo y asumir que la escritura siempre tendrá éxito.

La solución requiere una reserva persistente y atómica por operación antes de llamar al proveedor. La reserva usa una clave idempotente estable, única en base de datos. El registro y la transición de estado se realizan mediante RPC/SQL transaccional. Esta propuesta requiere una nueva tabla interna y funciones de base de datos; por eso no se implementa en la Edge Function ni se despliega sin entorno de prueba.

## 2. Semántica que se garantiza

- Una clave de operación solo puede reservarse una vez.
- Solicitudes concurrentes con la misma clave reciben el mismo resultado de reserva; solo una obtiene permiso de envío.
- Un correo con resultado confirmado queda `sent` y nunca vuelve a enviarse para esa clave.
- Un fallo definitivo confirmado por el proveedor queda `failed`; un reintento explícito puede crear un nuevo intento vinculado al original, no reutilizar la misma clave.
- Si la conexión se pierde y no sabemos si el proveedor aceptó el correo, la operación queda `uncertain` y NO se reenvía automáticamente. Requiere conciliación con el panel/API del proveedor.
- Esto prioriza evitar correos duplicados. No promete "exactly once" frente a fallos ambiguos de red; esa garantía solo se puede reforzar si el proveedor soporta y documenta claves idempotentes y su ventana de retención.

## 3. Modelo propuesto

Tabla interna `public.pqr_email_operations` (nombre provisional):
- `id uuid primary key`
- `submission_id uuid not null references public.pqr_submissions(id)`
- `operation_type text not null check in ('response','initial_confirmation','internal_notification','retry_notification')`
- `idempotency_key text not null unique`
- `payload_hash text not null` — hash del destinatario, asunto y cuerpo normalizado; no guardar el cuerpo completo ni el token del proveedor.
- `status text not null check in ('reserved','sending','sent','failed','uncertain')`
- `provider_message_id text null`
- `attempt_count integer not null default 0`
- `last_error_code text null` — código sanitizado, nunca credenciales ni cuerpo completo.
- `created_at, updated_at, sent_at timestamptz`
- `created_by text` — email administrativo validado o actor de sistema, según operación.

Controles:
- RLS habilitada, sin policies para clientes.
- Sin grants CRUD a `anon` ni `authenticated`; solo backend con service_role.
- Unique en `idempotency_key`; índices por `submission_id, created_at` y `status, updated_at`.
- No almacenar datos sensibles de correo innecesarios.
- Retención y borrado se definen antes de producción.

## 4. Flujo de reserva y envío

1. El cliente administrativo genera un UUID de idempotencia por acción y conserva ese mismo UUID si reintenta por timeout.
2. La Edge Function valida bearer token, allowlist, radicado, acción y contenido.
3. Calcula `payload_hash`; si la clave ya existe con hash distinto, responde 409 (la clave no puede reutilizarse para otro contenido).
4. Llama a una función SQL/RPC que inserta la reserva usando UNIQUE/ON CONFLICT y devuelve exactamente uno de: `claimed`, `already_sent`, `in_progress`, `uncertain`, `key_conflict`.
5. Solo `claimed` permite hacer la llamada a Resend.
6. Si Resend confirma aceptación, guardar `sent` y el ID del proveedor.
7. Si Resend devuelve rechazo inequívoco, guardar `failed`; no inferir fallo inequívoco de un timeout.
8. Si hay timeout, desconexión o respuesta ambigua, guardar `uncertain`; bloquear reenvío automático.
9. La UI muestra el estado real y un procedimiento de conciliación para `uncertain`.

La reserva debe realizarse en una transacción breve antes de la llamada HTTP; nunca mantener una transacción abierta mientras se espera a Resend.

## 5. Consistencia de estado e historial PQR

Las acciones `status` y la actualización de metadatos de `respond` deben ejecutarse en una sola función SQL transaccional:
- Actualizar `pqr_submissions`.
- Insertar el evento correspondiente en `pqr_events`.
- Si falla cualquiera, revertir ambos.
- Comprobar filas afectadas y devolver resultado explícito.
- Restringir EXECUTE a service_role; SECURITY INVOKER preferido y search_path explícito/seguro.
- No crear una SECURITY DEFINER para evitar errores de permisos.

La operación de correo y el evento de correo son conceptos separados: el estado del envío se conserva en `pqr_email_operations`; el historial de negocio se agrega en `pqr_events` después de reconciliar el resultado. No enviar el mismo mensaje de nuevo por un fallo al escribir el historial.

## 6. Aplicación a las acciones existentes

### `respond`
- Requiere `Idempotency-Key` UUID estable para el clic del administrador.
- La clave identifica el mensaje exacto (radicado + tipo + payload hash).
- Una segunda petición con la misma clave no reenvía; devuelve estado existente.
- Si el texto cambia, el frontend debe generar una clave nueva y pedir confirmación explícita.
- No cambiar el estado de la PQR automáticamente; respetar la acción explícita `status`.

### `retry_notification`
- No debe repetir el mismo intento automáticamente cuando el resultado es `uncertain`.
- Un reintento manual solo se habilita si el proveedor confirma que el primer intento no fue aceptado o si se ha resuelto la ambigüedad.
- Cada reintento manual es una operación nueva vinculada a la operación previa; queda auditado.

### `pqr-submit`
- La confirmación al solicitante y la notificación interna son dos operaciones independientes, cada una con clave derivada de la PQR y el tipo de correo.
- Una falla de la notificación interna no debe provocar reenvío de la confirmación al usuario.
- No volver a insertar una PQR solo porque falló la persistencia del estado de correo.
- La idempotencia del POST de radicación es un problema separado: necesita una clave de envío del formulario y unicidad persistente antes de garantizar que un timeout del navegador no cree dos radicados.

## 7. Matriz de pruebas requerida

- Dos solicitudes concurrentes con la misma clave: exactamente una reserva `claimed`.
- Misma clave y payload diferente: 409, cero llamadas al proveedor.
- Misma clave ya `sent`: devolver estado previo, cero llamada nueva.
- Dos claves distintas para el mismo radicado: dos mensajes distintos solo si el administrador los autorizó.
- Rechazo HTTP definitivo del proveedor: `failed`, sin marcar como enviado.
- Timeout después de iniciar llamada: `uncertain`, cero reenvío automático.
- Proveedor acepta y escritura de confirmación falla: la operación queda `sending`/lease expirada y pasa a `uncertain`; no reintentar a ciegas.
- Fallo de RPC antes de llamada al proveedor: no se envía correo.
- Falla inserción de evento de estado: rollback también de la actualización del estado.
- Reintento manual de `uncertain`: bloqueado hasta conciliación explícita.
- Usuario no administrador: 403 antes de cualquier reserva o llamada al proveedor.
- Verificar que ningún log/response expone API key, bearer token o cuerpo completo de correo.

## 8. Plan de implementación por fases

1. Aprobar esquema, retención y semántica de `uncertain`.
2. Crear SQL draft y revisar grants/RLS/índices/funciones en aislamiento.
3. Implementar RPC de reserva, finalización y transición estado+evento.
4. Actualizar `pqr-admin` y frontend para enviar y conservar `Idempotency-Key`.
5. Añadir tests unitarios de la máquina de estados y pruebas de concurrencia.
6. Ejecutar pruebas de fallo inyectado con un proveedor simulado.
7. Verificar soporte y ventana de idempotencia de Resend con documentación vigente antes de depender de ella.
8. Solo con evidencia y autorización expresa, abrir PR y planear despliegue.

## 9. Límites de esta entrega

- No se cambió `pqr-admin/index.ts` ni `pqr-submit/index.ts`.
- No se creó una migración en `supabase/migrations/`.
- No se ejecutó SQL ni se alteró producción.
- No se llamó a Resend, Turnstile, Storage ni a datos reales.
- No se afirma que los duplicados estén ya resueltos. Esta entrega define el mecanismo seguro que requiere un esquema y pruebas aisladas.

## Referencias Supabase
- Database Functions y RPC: https://supabase.com/docs/guides/database/functions
- Edge Functions: https://supabase.com/docs/guides/functions
- Edge Function local testing: https://supabase.com/docs/guides/functions/local-testing
- Changelog de breaking changes: https://supabase.com/changelog?types=breaking-change
- CORS: https://supabase.com/docs/guides/functions/cors
