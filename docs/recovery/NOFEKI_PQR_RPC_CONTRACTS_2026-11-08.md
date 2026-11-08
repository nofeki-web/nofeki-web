# NOFEKI PQR — contratos RPC y respuestas de idempotencia
Fecha: 2026-11-08
Rama: recovery/pqr-admin-retry-fix-20261108
Estado: propuesta funcional; no implementada ni probada.

## 1. reserve_pqr_email_operation
Entrada:
- submission_id: UUID del radicado existente.
- operation_type: response | initial_confirmation | internal_notification | retry_notification.
- idempotency_key: UUID generado una vez por acción y conservado en reintentos HTTP.
- payload_hash: SHA-256 hex de destinatario + asunto + cuerpo normalizados + tipo.
- created_by: actor autenticado validado en servidor; nunca confiar en un valor enviado por el navegador.

Decisiones:
| decision | Significado | Acción de Edge Function |
|---|---|---|
| claimed | Esta petición insertó la reserva | Puede avanzar a sending y llamar al proveedor |
| already_sent | La clave ya terminó como sent | Devolver resultado existente; cero llamadas al proveedor |
| in_progress | reserved/sending | 202 o 409 controlado; no llamar al proveedor |
| uncertain | Resultado externo ambiguo | Bloquear; conciliación manual |
| key_conflict | Clave repetida con hash/radicado/tipo distinto | HTTP 409; cero llamadas |
| failed | Fallo definitivo ya registrado | No reutilizar clave; reintento explícito con nueva clave |

La inserción con UNIQUE(idempotency_key) es el árbitro de concurrencia. Solo el proceso que recibe claimed puede intentar el envío. Una lectura previa en Edge Function no reemplaza esta reserva.

## 2. mark_pqr_email_sending
Entrada: operation_id.
Precondición: estado reservado.
Efecto: estado sending, attempt_count + 1, updated_at = now().
Si la transición no afecta exactamente una fila, no enviar.

## 3. finish_pqr_email_operation
Entrada: operation_id, outcome (sent | failed | uncertain), provider_message_id opcional, safe_error_code opcional.
- sent: solo ante aceptación inequívoca; guardar ID de proveedor y sent_at.
- failed: solo ante rechazo inequívoco/no aceptación.
- uncertain: timeout, desconexión, 5xx ambiguo o fallo al persistir tras aceptación posible.
- Nunca registrar cuerpo de correo, claves ni tokens en errores.
- Estado sent terminal; uncertain bloquea reenvío hasta conciliación.

## 4. status + pqr_events
Una única RPC debe:
1. validar transición permitida;
2. actualizar pqr_submissions;
3. insertar pqr_events;
4. comprobar filas afectadas;
5. confirmar ambos o revertir ambos.

Respuesta: {ok, submission_id, old_status, new_status, event_id}. No devolver ok si el evento no quedó persistido.

## 5. Mapeo HTTP sugerido
- 200: already_sent / operación consultada con resultado terminal.
- 202: in_progress.
- 409: key_conflict o uncertain bloqueante.
- 422: transición inválida o payload no válido.
- 500/503: error interno antes de llamar al proveedor; no afirmar envío.
La respuesta debe incluir operation_id y status cuando exista, sin datos sensibles.

## 6. Idempotency-Key en el cliente
- Crear UUID al iniciar el clic de envío.
- Reutilizar exactamente ese UUID solo ante reintento técnico de la misma acción y mismo contenido.
- Si cambia el texto/destinatario/asunto, generar otra clave y solicitar confirmación.
- No generar la clave dentro de cada intento de fetch.
- No guardar la clave en localStorage si no es necesario; mantenerla en el estado de la operación y descartarla al finalizar.
- La Edge Function valida formato y vincula la clave al usuario administrador autenticado.

## 7. Separación de operaciones de pqr-submit
Confirmación al solicitante y aviso interno usan dos claves/operaciones independientes. El fallo del segundo correo no autoriza reenviar el primero. La idempotencia de creación del radicado (POST) es un contrato distinto y requiere su propia clave persistente.
