# NOFEKI PQR — contratos RPC y plan de validación

Fecha: 2026-11-08  
Estado: especificación para revisión. Ninguna RPC ha sido creada ni ejecutada.

## 1. Alcance y seguridad

Este contrato acompaña a `NOFEKI_PQR_IDEMPOTENCY_DRAFT_NOT_EXECUTABLE.sql`. El SQL está en `docs/audit/reference-sql/`, fuera de `supabase/migrations/`. No ejecutar en producción.

Las RPC propuestas son `SECURITY INVOKER`, con `search_path = ''`, referencias de objetos totalmente calificadas y EXECUTE concedido solo a `service_role`. La tabla tiene RLS habilitada y ningún acceso para `anon` o `authenticated`. La Edge Function debe validar sesión y allowlist antes de llamar RPC. Nunca enviar la service key al navegador.

## 2. Contratos

### `pqr_claim_email_operation`

Entrada:
- `p_submission_id: uuid`
- `p_operation_type: response | initial_confirmation | internal_notification | retry_notification`
- `p_idempotency_key: uuid` estable por acción del usuario; en reintentos HTTP se conserva.
- `p_payload_hash: text` SHA-256 hexadecimal del payload normalizado (destinatario + asunto + cuerpo + tipo).
- `p_created_by: text` actor ya autenticado/validado por la Edge Function.
- `p_parent_operation_id: uuid | null` obligatorio solo para `retry_notification`.

Resultado: una fila con `decision`, `operation_id`, `current_status`.
- `claimed`: reserva creada; esta petición puede llamar al proveedor una vez.
- `already_sent`: devolver resultado anterior, sin llamada al proveedor.
- `in_progress`: otra petición conserva la reserva; no enviar.
- `uncertain`: conciliación requerida; no enviar.
- `key_conflict`: misma clave con payload distinto; responder HTTP 409.
- `failed`: intento anterior falló definitivamente; requiere una nueva operación/clave y autorización explícita, no reutilizar la anterior.

### `pqr_finish_email_operation`

Entrada: `p_operation_id`, estado final `sent | failed | uncertain`, ID de proveedor opcional, código de error sanitizado opcional. Devuelve boolean: `true` si la transición `sending` a estado final se aplicó; `false` si no había una operación en `sending`.

Clasificación:
- Respuesta 2xx confirmada del proveedor con ID de mensaje: `sent`.
- Rechazo explícito que garantiza no aceptación: `failed`.
- Timeout, desconexión, respuesta ilegible o fallo al persistir después de aceptación potencial: `uncertain`.
No clasificar todo error de red como `failed`.

### `pqr_set_submission_status_with_event`

Entrada: id PQR, nuevo estado válido, correo del actor validado, nota opcional. Devuelve `true` si la PQR existe y se guardó el cambio junto al evento; `false` si no existe. El error de inserción del evento revierte también la actualización por atomicidad transaccional.

## 3. Flujo de Edge Function esperado

1. Validar origen, método, bearer, usuario y allowlist.
2. Validar PQR y payload; normalizar destinatario/asunto/cuerpo.
3. Exigir `Idempotency-Key` UUID para acciones que envían correo.
4. Calcular SHA-256 del payload canónico.
5. Llamar claim. Solo `claimed` permite una única llamada HTTP al proveedor.
6. Guardar resultado con finish. Si finish falla tras aceptación potencial, no reenviar: reconciliar y dejar `uncertain`.
7. Guardar evento de negocio sin volver a enviar correo si el evento falla.
8. Para reintento manual, comprobar conciliación y crear una operación hija con nueva clave y `parent_operation_id`.

## 4. Pruebas deterministas requeridas

Estas pruebas deben ejecutarse primero contra PostgreSQL aislado, con proveedor simulado y fallos inyectados. No se han ejecutado porque no existe un entorno aislado habilitado/costeado en esta tarea.

| Caso | Resultado esperado |
|---|---|
| 20 claims concurrentes, misma clave y hash | 1 `claimed`; 19 `in_progress` o `already_sent`; una sola llamada al mock |
| Misma clave, hash distinto | `key_conflict`; cero llamadas nuevas |
| Clave ya `sent` | `already_sent`; cero llamadas |
| Clave `uncertain` | `uncertain`; cero llamadas automáticas |
| Rechazo definitivo proveedor | estado `failed`; no marcar enviado |
| Timeout tras enviar request | `uncertain`; no reenvío automático |
| Fallo RPC claim | no llamar proveedor |
| Fallo al insertar evento de estado | rollback de actualización y evento |
| Usuario no allowlisted | 403 antes de reservar/enviar |
| Reintento manual sin conciliación | bloqueado |

## 5. Observaciones de revisión antes de implementación

- El SQL actual propone que la reserva nazca en `sending`; un crash inmediatamente después de la reserva debe tratarse como `uncertain` tras un procedimiento de reconciliación, nunca reabrirse automáticamente.
- La unicidad global de `idempotency_key` evita colisiones entre operaciones. Revisar retención y limpieza antes de producción.
- El payload hash debe generarse sobre JSON canónico con versión de esquema; no incluir tokens ni datos de tarjeta. Evaluar si conviene almacenar hash separado por plantilla.
- `pqr_set_submission_status_with_event` conserva `responded_at` si ya existe y no lo limpia al cambiar a otro estado; validar si esa semántica es la deseada.
- Los estados `failed` y `uncertain` requieren procedimiento administrativo con evidencia del proveedor. No habilitar un botón de retry genérico.
- El SQL no resuelve la idempotencia de creación de radicados en `pqr-submit`; eso es un trabajo separado.

## 6. Verificación de esta entrega

- [x] Esquema de referencia separado de migraciones.
- [x] Contratos de RPC y decisiones HTTP documentados.
- [x] Casos de concurrencia/fallo definidos.
- [ ] SQL parseado/ejecutado en PostgreSQL aislado.
- [ ] Pruebas concurrentes ejecutadas contra base real aislada.
- [ ] Revisión de grants/RLS/advisors.
- [ ] Integración Edge Function + UI.
- [ ] Pruebas end-to-end con proveedor simulado.
- [ ] Aprobación explícita para cualquier cambio en producción.
