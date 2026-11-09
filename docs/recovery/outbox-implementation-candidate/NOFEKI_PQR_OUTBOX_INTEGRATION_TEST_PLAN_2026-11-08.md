# NOFEKI PQR Outbox — batería de pruebas de integración

**Estado:** preparada; pendiente de ejecución en PostgreSQL aislado y Supabase local.
**Prohibido:** ejecutar contra el proyecto remoto/producción.
**Prerequisito:** aplicar manualmente los dos SQL candidatos en una base desechable con el esquema PQR de prueba, nunca en el proyecto productivo.

## Objetivo
Validar atomicidad de respuesta, idempotencia, control optimista de versión, entrega asíncrona, reintentos, seguridad de RPC y coherencia entre Edge Function, worker y panel.

## Entorno
- PostgreSQL/Supabase local o proyecto temporal descartable; PostgreSQL 17.x.
- pgTAP habilitado; Deno compatible con Supabase Edge Runtime.
- Resend en modo de prueba o servidor HTTP simulado; no usar destinatarios reales.
- Datos sintéticos exclusivamente. No copiar PII de producción.
- Secrets locales de prueba; jamás reutilizar service-role ni secretos productivos.

## Orden de ejecución
1. Restaurar un esquema sintético que refleje las columnas, checks e índices relevantes de PQR.
2. Aplicar el SQL base candidato completo.
3. Aplicar el addendum administrativo.
4. Ejecutar `supabase test db`.
5. Ejecutar pruebas Deno del worker y Edge Function con servicios simulados.
6. Ejecutar pruebas de concurrencia contra PostgreSQL temporal.
7. Ejecutar pruebas de navegador con usuario administrador sintético y usuario fuera de allowlist.
8. Guardar logs sin correos, tokens, contenido PQR ni datos personales.
9. Destruir el entorno temporal al finalizar.

## Matriz funcional obligatoria

| ID | Escenario | Acción | Resultado esperado |
|---|---|---|---|
| DB-01 | Respuesta formal válida | Caso En gestión, versión N; invocar RPC | Respondida, versión N+1, un evento y un Outbox, atómicos |
| DB-02 | Repetición idéntica | Repetir UUID y fingerprint | Mismo resultado replay; sin duplicados |
| DB-03 | Misma clave, otro contenido | Reusar UUID con fingerprint distinto | PT409; cero cambios |
| DB-04 | Estado incorrecto | Responder desde cualquier estado distinto de En gestión | Rechazo; cero cambios |
| DB-05 | Versión obsoleta | Enviar expected_version antiguo | Conflicto; cero cambios |
| DB-06 | Transición manual a Respondida | Invocar transición de estado | Rechazo use_admin_response_operation |
| DB-07 | Nota idempotente | Crear nota y repetir | Un evento internal_note |
| DB-08 | Retry confirmación idempotente | Reencolar con misma clave | Un solo retry y un solo Outbox adicional |
| DB-09 | Rollback por fallo | Forzar fallo al insertar Outbox | Ni evento ni cambio de estado sobreviven |
| DB-10 | Dos respuestas concurrentes | Dos sesiones, mismo caso/versión | Solo una gana; un evento y un job |
| DB-11 | Dos cambios concurrentes | Dos sesiones, misma versión | Solo una transición gana |
| DB-12 | Claim concurrente | Dos workers reclaman lotes | Sin dos leases activos para el mismo job |
| DB-13 | Lease vencido | Reclamar, vencer y reclamar de nuevo | Token anterior no puede finish/retry |
| DB-14 | Finish correcto | Finalizar con lease vigente | Outbox delivered; proyección de correo correcta |
| DB-15 | Retry temporal | Fallar antes del máximo | Outbox pending con backoff; estado PQR intacto |
| DB-16 | Dead letter | Agotar max_attempts | Outbox dead; confirmación failed; caso no retrocede |
| DB-17 | Finish duplicado | Repetir finish tras entrega | false/stale; sin alterar entrega |
| DB-18 | RPC privada | Ejecutar como anon/authenticated | Permiso denegado |
| DB-19 | Tablas privadas | Consultar tablas private como cliente | Sin acceso |
| DB-20 | Seguridad funciones | Revisar SECURITY, search_path y grants | INVOKER, search_path vacío, solo service_role |
| EDGE-01 | No autenticado | POST sin sesión válida | 401; ninguna RPC |
| EDGE-02 | Admin no permitido | Sesión válida fuera de allowlist | 403 antes de RPC |
| EDGE-03 | Idempotency-Key inválida | Omitir o UUID inválido | 400; ninguna RPC |
| EDGE-04 | Acción inválida | Acción/estado no permitido | 400; ninguna RPC |
| EDGE-05 | Conflicto RPC | RPC responde PT409 | HTTP 409 controlado |
| WORK-01 | Secreto incorrecto | Bearer inválido | 401; no claim |
| WORK-02 | Método incorrecto | GET inesperado | 405 |
| WORK-03 | Resend 429/5xx | Simular error temporal | Retry/backoff; no delivered |
| WORK-04 | Timeout ambiguo | Proveedor acepta, cliente pierde respuesta | Reintento conserva event_key |
| WORK-05 | Respuesta sin source event | admin_response sin source_event_id | Error seguro; no envío |
| WORK-06 | HTML malicioso | Campos sintéticos con etiquetas/script | Contenido escapado |
| WORK-07 | Falla finish RPC | Resend acepta, finish falla | Lease expira; reintento con misma clave |
| UI-01 | Estado Respondida | Abrir caso respondido | Se muestra; no editable manualmente |
| UI-02 | Respuesta formal | Responder caso En gestión | Indica registrada/en cola; historial actualizable |
| UI-03 | Retry confirmación | Pulsar reintentar | Se encola; no afirma entrega inmediata |
| UI-04 | Doble click/timeout | Repetir mismo POST | Misma Idempotency-Key; una operación |
| UI-05 | Sesión expirada | Abrir panel sin sesión válida | Cierra acceso y limpia datos privados visibles |

## Criterios de aprobación
- Todos los escenarios DB-01 a DB-20, EDGE-01 a EDGE-05, WORK-01 a WORK-07 y UI-01 a UI-05 pasan.
- Ninguna respuesta formal duplica evento o job.
- Ningún error de correo revierte el estado del caso.
- Un lease antiguo nunca confirma ni reprograma un job reclamado por otro worker.
- No hay secretos, PII ni cuerpo de correo en logs.
- No hay grants cliente a tablas privadas ni RPC administrativas.
- Tres ejecuciones consecutivas sin flakiness.

## Bloqueadores conocidos
1. El retry administrativo actual reencola solo applicant_confirmation; no existe retry de admin_response en dead-letter.
2. La retención de idempotencia del proveedor es finita. Impedir reenvío con la misma event_key fuera de la ventana documentada o definir recuperación explícita.
3. Resuelto en candidato: no se permite reabrir Respondida a En gestión. El flujo aprobado queda lineal; cualquier reapertura futura requerirá una operación explícita y auditada.
4. El retry crea Outbox con source_event_id nulo. Confirmar que el worker solo lo use para applicant_confirmation.
5. El worker usa secreto compartido y no tiene scheduler. Configurar invocación autenticada y cron solo tras aprobar pruebas.
6. El formulario y panel deben probarse en navegador contra funciones del entorno temporal.

## Comandos — solo en equipo/entorno aislado
Consultar primero las opciones de la versión instalada: `supabase --version`, `supabase test db --help`, `deno test --help`.
Después de instalar y arrancar stack local: `supabase start`, `supabase test db`.
Ejecutar tests Deno con permisos mínimos y mocks; definir ruta/imports reales al preparar el entorno.
No ejecutar estos comandos apuntando a producción.
