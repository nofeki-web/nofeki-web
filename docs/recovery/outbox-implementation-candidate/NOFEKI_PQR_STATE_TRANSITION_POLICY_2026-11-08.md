# NOFEKI PQR — política de estados y contrato de transición

Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: decisión funcional aprobada por el usuario; especificación candidata, no desplegada.

> Este documento formaliza la decisión de adoptar transiciones controladas. No modifica producción ni sustituye una migración ejecutable. La matriz deberá convertirse en una RPC transaccional y validarse en PostgreSQL aislado antes de cualquier despliegue.

## 1. Estados oficiales

Se conservan exactamente los cinco valores ya existentes en la base y en el panel:
- `Recibida`
- `En revisión`
- `En gestión`
- `Respondida`
- `Cerrada`

No se renombran estados para evitar romper filtros, datos históricos ni integraciones existentes.

## 2. Matriz de transiciones

| Estado actual | Estado solicitado | Decisión | Condición |
|---|---|---|---|
| Recibida | En revisión | Permitir | Acción administrativa autorizada |
| En revisión | En gestión | Permitir | Acción administrativa autorizada |
| En gestión | Respondida | Permitir | Debe existir respuesta formal no vacía, persistida como evento y Outbox en la misma transacción |
| Respondida | Cerrada | Permitir | Cierre explícito; registrar actor y fecha |
| Respondida | En gestión | Permitir como reapertura | Motivo obligatorio; registrar evento de reapertura |
| Recibida | En gestión | Rechazar | Debe pasar por revisión |
| Recibida | Respondida | Rechazar | Debe pasar por revisión y gestión |
| En revisión | Respondida | Rechazar | Debe pasar por gestión |
| En gestión | Cerrada | Rechazar | No cerrar sin respuesta formal |
| Cerrada | Cualquier estado | Rechazar en esta versión | Estado terminal; una reapertura posterior requiere decisión de producto y evento específico |
| Cualquier estado | Mismo estado | No-op idempotente | Devolver estado actual sin crear evento ni notificación duplicados |

La transición `Respondida → En gestión` es la única reapertura incluida inicialmente. `Cerrada` es terminal para evitar reabrir casos archivados accidentalmente.

## 3. Semántica de Respondida y Cerrada

- `Respondida` significa que la respuesta formal quedó guardada de manera durable y que su evento de notificación quedó encolado en Outbox dentro de la misma transacción.
- No significa que el proveedor de correo ya haya aceptado o entregado el mensaje. El panel debe mostrar por separado el estado de entrega de la respuesta.
- `Cerrada` significa que un administrador terminó explícitamente la gestión. No debe asignarse automáticamente por el worker de correo ni por el mero hecho de que la notificación se haya enviado.
- Una respuesta con error de entrega no debe borrarse ni perderse; la notificación queda visible para reintento/revisión sin cambiar automáticamente el estado de la PQR.

## 4. Contrato de la RPC de transición

Nombre candidato: `public.pqr_admin_transition_status`.

Entrada lógica:
- `p_submission_id UUID`
- `p_expected_status TEXT`
- `p_target_status TEXT`
- `p_actor_email TEXT` derivado/validado por Edge Function; no confiar en un valor libre del navegador
- `p_request_id UUID` estable para idempotencia
- `p_reason TEXT` requerido para reapertura; opcional en avance ordinario

Reglas transaccionales:
1. La Edge Function autentica al usuario y verifica la allowlist vigente antes de llamar la RPC.
2. La RPC bloquea la fila de `public.pqr_submissions` con `SELECT ... FOR UPDATE`.
3. Verifica que el estado actual coincida con `p_expected_status`. Si no coincide, devolver conflicto controlado (HTTP 409 desde la capa Edge) sin sobrescribir el cambio concurrente.
4. Si el estado actual ya es `p_target_status`, devolver no-op; no insertar un segundo evento.
5. Verifica la matriz de transición en servidor, nunca solo en el HTML.
6. Para `Respondida → En gestión`, exige motivo normalizado no vacío y lo registra en `pqr_events`.
7. Actualiza el estado y `updated_at`; incrementa una versión monotónica si la columna version se incorpora al esquema candidato.
8. Inserta el evento de auditoría en `public.pqr_events` en la misma transacción.
9. Si una transición genera notificación, inserta la intención Outbox en esa misma transacción con clave determinista; el worker envía después, fuera de la transacción.
10. Si cualquier escritura falla, toda la transacción se revierte.

Seguridad:
- La Edge Function conserva autenticación y allowlist actuales; no ampliar administradores en este cambio.
- RPC y tablas Outbox deben quedar restringidas al rol de backend previsto. Revocar EXECUTE de `PUBLIC`, `anon` y `authenticated` cuando corresponda; conceder solo lo necesario a `service_role`.
- Preferir `SECURITY INVOKER`; no añadir `SECURITY DEFINER` para sortear permisos. Si un diseño probado lo hiciera imprescindible, documentar la justificación, fijar `search_path = ''`, calificar objetos y revisar grants/advisors.
- No usar SQLSTATE `40001` como error de negocio personalizado en RPC PostgREST: la nota de Supabase del 2026-11-04 advierte que PostgREST 14 puede reintentar transacciones ante ese código. Usar error estándar/SQLSTATE apropiado y mapear el conflicto a HTTP 409 en Edge Function.

## 5. Auditoría e historial

Cada transición efectiva registra:
- submission_id
- actor administrativo validado
- estado anterior y nuevo
- fecha/hora de servidor
- request_id
- motivo cuando sea reapertura
- versión anterior/nueva si se incorpora control optimista por versión

No registrar eventos para no-op idempotente. Nunca permitir que un actor o timestamp suministrado por el cliente suplante la identidad o el reloj del servidor.

## 6. Comportamiento del panel

- El selector solo ofrece destinos válidos desde el estado actual.
- La acción de reapertura se presenta explícitamente, exige motivo y confirmación.
- Si hay conflicto por edición simultánea, mostrar que el caso cambió en otra sesión, recargar detalle y pedir al administrador que revise antes de volver a actuar.
- Separar estado de PQR de estado de notificación: en cola, procesando, enviado/aceptado por proveedor, reintento programado o requiere revisión.
- No ofrecer retry global de confirmaciones. Cada reintento apunta a un evento Outbox exacto y conserva su event_key; registrar quién reintentó y cuándo.

## 7. Pruebas obligatorias

1. Cada transición permitida de la matriz.
2. Cada salto prohibido de la matriz.
3. Reapertura Respondida → En gestión sin motivo: rechazo.
4. Reapertura con motivo: estado y evento de auditoría se confirman juntos.
5. Cerrada → cualquier estado: rechazo.
6. Mismo estado solicitado dos veces: no-op, un único evento.
7. Dos administradores envían cambios concurrentes desde el mismo estado: una transición gana; la otra recibe conflicto y no sobrescribe.
8. Fallo al insertar evento tras actualizar estado: rollback completo.
9. Fallo al insertar Outbox: rollback completo del cambio que requiere notificación.
10. Respondida con correo pendiente/fallido: estado PQR permanece Respondida; estado de correo visible por separado.
11. Reintento de la misma request_id: devuelve resultado previo sin duplicar evento.
12. Request_id repetido con payload distinto: conflicto.
13. Administrador no autorizado: Edge Function rechaza antes de mutación.
14. Usuario anon/authenticated no puede invocar directamente RPC privilegiada ni leer Outbox.

## 8. Secuencia de implementación

1. Mantener esta política como fuente única del grafo.
2. Diseñar RPC de transición y RPC idempotente de respuesta sobre la misma estrategia de locking/auditoría.
3. Implementar modelo Node de estados/concurrencia y ampliar matriz de pruebas.
4. Revisar SQL completo y grants/RLS con documentación vigente.
5. Ejecutar pruebas PostgreSQL aisladas; el modelo Node no sustituye estas pruebas.
6. Integrar Edge Function y panel admin en una sola versión coordinada.
7. Solicitar autorización explícita antes de migrar o desplegar producción.

## 9. Verificación de documentación

- Supabase Database Functions: https://supabase.com/docs/guides/database/functions
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase changelog: la advertencia sobre PostgREST 14 y errores SQLSTATE 40001 fue publicada el 2026-11-04: https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

## 10. Límites actuales

- No hay PostgreSQL aislado, Docker/Podman ni Deno disponible en el entorno de trabajo registrado.
- Las pruebas de modelo Node se etiquetarán como simulación/in-memory, nunca como integración PostgreSQL.
- No se ejecutó SQL contra el proyecto Supabase.
- No se modificaron Edge Functions desplegadas, HTML de producción, secretos, Storage, Auth, migraciones aplicadas ni configuración de proyecto.
