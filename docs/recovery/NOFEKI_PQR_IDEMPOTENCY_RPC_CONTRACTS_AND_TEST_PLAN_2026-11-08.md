# NOFEKI PQR — contratos RPC y plan de pruebas de idempotencia
Fecha: 2026-11-08
Estado: especificación de revisión. El SQL relacionado es referencia no ejecutable; no se ha probado contra PostgreSQL.
Rama: `recovery/pqr-admin-retry-fix-20261108`

## 1. Alcance de la entrega

El archivo `docs/audit/reference-sql/NOFEKI_PQR_IDEMPOTENCY_DRAFT_NOT_EXECUTABLE.sql` propone:
- Tabla interna `public.pqr_email_operations`.
- RPC `pqr_claim_email_operation` para reservar una clave idempotente.
- RPC `pqr_finish_email_operation` para persistir el resultado del proveedor.
- RPC `pqr_set_submission_status_with_event` para actualizar estado e historial dentro de una misma transacción.

El SQL termina en `ROLLBACK` como protección adicional si alguien lo ejecuta accidentalmente en una sesión SQL. Esto NO es una garantía de seguridad ni reemplaza mantenerlo fuera de `supabase/migrations/`. No ejecutarlo.

## 2. Contrato: pqr_claim_email_operation

Parámetros:
- `p_submission_id uuid`
- `p_operation_type text`: response | initial_confirmation | internal_notification | retry_notification
- `p_idempotency_key uuid`
- `p_payload_hash text`: SHA-256 hexadecimal (64 caracteres) del payload normalizado; calcularlo en backend.
- `p_created_by text`: actor autenticado y autorizado por la Edge Function.
- `p_parent_operation_id uuid`: obligatorio solo para retry_notification.

Resultado:
- `decision`: claimed | already_sent | in_progress | uncertain | key_conflict | failed
- `operation_id uuid`
- `current_status text`

Reglas:
- Solo `claimed` permite que la solicitud actual llame al proveedor.
- `already_sent`, `in_progress`, `uncertain` y `failed` no permiten un envío automático.
- `key_conflict` debe traducirse a HTTP 409.
- El navegador crea la clave UUID al iniciar la acción y conserva exactamente la misma clave si reintenta por timeout. El backend calcula el hash; nunca confía en un hash proporcionado por el cliente.
- Un retry manual crea una clave nueva y referencia la operación anterior mediante `parent_operation_id`.

## 3. Contrato: pqr_finish_email_operation

Parámetros:
- `p_operation_id uuid`
- `p_final_status text`: sent | failed | uncertain
- `p_provider_message_id text`: identificador confirmado por Resend cuando status=sent.
- `p_error_code text`: código sanitizado; nunca credenciales, bearer tokens, cuerpo de correo ni información personal.

Resultado: booleano. `true` indica que se actualizó una fila que estaba en `sending`; `false` indica que no se realizó transición (por ejemplo, estado ya terminal o ID inexistente).

Semántica:
- `sent`: aceptación inequívoca del proveedor.
- `failed`: rechazo inequívoco que confirma que el proveedor no aceptó el mensaje.
- `uncertain`: timeout/desconexión o error posterior a la aceptación en que no puede conocerse el resultado.
- No clasificar timeout como failed.
- El SQL de referencia no permite reabrir una operación terminal.

## 4. Contrato: pqr_set_submission_status_with_event

Parámetros:
- `p_submission_id uuid`
- `p_new_status text`: Recibida | En revisión | En gestión | Respondida | Cerrada
- `p_actor_email text`
- `p_note text` opcional, máximo 2.000 caracteres.

Resultado: booleano; false si no existe el radicado. La función bloquea la fila, lee el estado anterior, actualiza `pqr_submissions` e inserta `pqr_events` dentro de la misma transacción. Un error al insertar el evento debe revertir también la actualización.

La función no reemplaza la validación de sesión/allowlist: la Edge Function debe autenticar y autorizar antes de llamar el RPC.

## 5. Máquina de estados esperada

| Estado | Resultado | Acción permitida |
|---|---|---|
| sin operación | claimed / sending | Una única llamada al proveedor |
| sending | sent | Cerrar; no reenviar |
| sending | failed | Solo reintento manual, con nueva clave y autorización |
| sending | uncertain | Conciliar primero; no reenviar automáticamente |
| sent + misma clave | already_sent | Devolver resultado previo |
| sending + misma clave | in_progress | No hacer una segunda llamada |
| misma clave + hash distinto | key_conflict | HTTP 409 |

El borrador marca la operación como `sending` al reservarla. Esto evita que otra solicitud obtenga permiso de envío, incluso si el primer proceso cae. Sin embargo, un registro `sending` abandonado requiere conciliación; no se debe liberar automáticamente para reenvío.

## 6. Plan de pruebas de concurrencia (PostgreSQL aislado)

1. Ejecutar 10-50 llamadas concurrentes con la misma clave/hash: exactamente una devuelve `claimed`; el resto no autoriza envío.
2. Misma clave y hash distinto: `key_conflict`, ninguna llamada adicional al proveedor.
3. Repetición de clave en estado sent: `already_sent`.
4. Repetición en sending: `in_progress`.
5. Repetición en uncertain: `uncertain`.
6. Dos claves distintas para el mismo radicado: dos operaciones independientes.
7. Retry sin parent_operation_id o operación no retry con parent: rechazo.
8. Submission inexistente: error FK; no crear reserva.
9. authenticated/anon: SELECT/INSERT/UPDATE de tabla y EXECUTE de RPC denegados.
10. service_role: puede reservar/finalizar; verificar privilegios efectivos y SECURITY INVOKER.
11. Dos finalizaciones simultáneas: solo una puede cambiar sending a estado terminal.
12. Error al insertar pqr_events: rollback del cambio de status.
13. Error de RPC de reserva: cero llamadas a Resend.
14. Resend acepta pero la escritura final falla: no repetir envío; reconciliar con los registros del proveedor.
15. Timeout en llamada a Resend: uncertain; cero reenvíos automáticos.

## 7. Pruebas con proveedor simulado

- Respuesta 200/201 con ID de mensaje: sent.
- Rechazo inequívoco 4xx: failed.
- Timeout, desconexión o respuesta ilegible: uncertain.
- Fallo de RPC antes del envío: no llamar proveedor.
- Fallo al guardar el resultado tras aceptación: mantener bloqueo y conciliar con proveedor.
- Verificar que logs y respuestas no exponen API key, bearer token, contenido completo ni datos innecesarios.

## 8. Riesgos y decisiones aún abiertas

- El SQL no se ha compilado ni ejecutado; requiere validación en PostgreSQL aislado.
- Confirmar ownership de las funciones, privilegios efectivos de service_role, extensiones y disponibilidad de gen_random_uuid.
- Revisar la política de retención de operaciones y protección de datos.
- Verificar documentación vigente de Resend antes de depender de cualquier soporte de idempotencia del proveedor.
- El estado sending sin respuesta es deliberadamente bloqueante; falta procedimiento operativo de conciliación y pantalla de administración.
- La acción respond requiere que frontend genere y conserve Idempotency-Key. El frontend y las Edge Functions aún no han sido modificados.
- La idempotencia del POST inicial de radicación es un flujo separado y no está resuelta aquí.

## 9. Evidencia y límites

- Se inspeccionó `pqr-admin/index.ts` y la migración `20261107120000_pqr_management_workflow.sql` en esta rama.
- El código actual confirma que status update e insert de evento son operaciones separadas; respond/retry envían correo antes de persistir historial.
- Se documentaron los RPC y escenarios que deben probarse.
- No se ejecutó SQL, Deno, pruebas unitarias, pruebas de concurrencia, llamadas a Resend ni cambios en producción.
- No se modificaron Edge Functions, frontend, Auth, Storage, RLS existente, configuración ni despliegues.
- Esta entrega no demuestra que el SQL compile ni que la idempotencia esté operativa.
