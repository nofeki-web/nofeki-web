# NOFEKI PQR — matriz de pruebas de aceptación: idempotencia, Storage y Outbox

Fecha: 2026-11-10  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: matriz de verificación; pendiente de ejecutar en PostgreSQL 17 aislado y runtime Deno de pruebas.

## Convenciones

- **Static**: inspección de código/documentación; no demuestra ejecución.
- **Unit**: harness aislado con dependencias simuladas.
- **PG integration**: PostgreSQL 17 aislado con esquema/roles/constraints equivalentes.
- **Storage integration**: bucket privado de pruebas, sin datos reales.
- **E2E**: navegador/formulario + Edge Functions + DB + Storage + Resend sandbox/test recipient.

## Matriz

| ID | Escenario | Resultado esperado | Nivel requerido | Estado |
|---|---|---|---|---|
| IDEM-01 | Misma key y mismo payload, secuencial | Mismo radicado; una submission; dos Outbox | PG integration | Pendiente |
| IDEM-02 | Misma key y mismo payload, 20 concurrentes | Un claim efectivo; una submission; dos Outbox | PG integration | Pendiente |
| IDEM-03 | Misma key, payload distinto | 409 key_conflict; sin segunda submission | PG integration | Pendiente |
| IDEM-04 | Respuesta HTTP perdida después del commit | Reintento reproduce radicado | E2E + PG | Pendiente |
| IDEM-05 | Crash después de reserve, antes de upload | Lease expira; retry mismo key recupera | PG + Storage | Pendiente |
| IDEM-06 | Crash después de upload, antes de mark_uploaded | Retry verifica objeto existente y continúa | Storage + PG | Pendiente |
| IDEM-07 | Crash después de mark_uploaded, antes de finalize | Retry reclama lease y finaliza sin duplicar objeto | PG + Storage | Pendiente |
| IDEM-08 | Finalize rollback | No hay submission/Outbox parcial; request recuperable | PG integration | Pendiente |
| IDEM-09 | Finalize commit + timeout de respuesta | No borrar objeto; retry devuelve mismo radicado | E2E + PG + Storage | Pendiente |
| RATE-01 | Reintento misma key | No consume cuota adicional | PG integration | Pendiente |
| RATE-02 | Keys distintas mismo source hash bajo concurrencia | Límite atómico, sin oversubscription | PG integration | Pendiente |
| RATE-03 | Parámetros de límite nulos/fuera de rango | Error 22023; no mutación | PG integration | Pendiente |
| RATE-04 | Error en RPC rate-limit anidada | Transacción reserve rollback; no request huérfano | PG + ACL | Pendiente |
| LEASE-01 | Lease activo, segundo request | in_progress; no segundo claim | PG integration | Pendiente |
| LEASE-02 | Lease vencido, nuevo claim | Token nuevo; token anterior fenced | PG integration | Pendiente |
| LEASE-03 | Token viejo intenta mark_uploaded/finalize | Operación rechazada/false; no mutación | PG integration | Pendiente |
| FILE-01 | Adjunto PDF/JPG/PNG válido dentro de 5 MiB | Upload privado, hash verificado, path determinístico | Storage integration | Pendiente |
| FILE-02 | MIME permitido pero firma real incorrecta | Rechazo antes de upload | Unit + E2E | Pendiente |
| FILE-03 | Objeto ya existe con mismo contenido | Reutilizar solo tras verificación completa | Storage integration | Pendiente |
| FILE-04 | Objeto ya existe con bytes distintos | No overwrite; no finalize | Storage integration | Pendiente |
| FILE-05 | Lease expira durante upload | Token antiguo no puede confirmar metadata | PG + Storage | Pendiente |
| FILE-06 | DB no disponible al conciliar | No borrar objeto | Unit + Storage | Pendiente |
| FILE-07 | Submission referencia objeto | Cleanup rechaza borrado | PG + Storage | Pendiente |
| FILE-08 | Reserva uncertain | Nunca cleanup automático | PG + Storage | Pendiente |
| FILE-09 | Huérfano failed mayor a grace period | Borrar ruta exacta y auditar solo tras doble chequeo | PG + Storage | Pendiente |
| FILE-10 | Resultado de delete ambiguo | Consultar Storage antes de repetir | Storage integration | Pendiente |
| OUT-01 | Finalize de PQR | Dos eventos independientes y claves determinísticas | PG integration | Pendiente |
| OUT-02 | Applicant email accepted; internal alert falla | Estados independientes | Worker integration | Pendiente |
| OUT-03 | Timeout/5xx tras solicitud a Resend | uncertain, no retry ciego con clave nueva | Worker integration | Pendiente |
| OUT-04 | Worker stale tras expirar lease | No finish/retry con token viejo | PG + Worker | Pendiente |
| OUT-05 | Cola/scheduler reanuda un evento después de la ventana de idempotencia del proveedor | No llamar Resend de nuevo; pasar a `uncertain`/conciliación auditada, sin duplicar correo | PG + Worker + Resend sandbox | Pendiente |
| SEC-01 | anon/authenticated invocan RPC privilegiada | Permiso denegado | PG ACL | Pendiente |
| SEC-02 | anon/authenticated consultan request/outbox privados | Sin acceso | PG RLS/ACL | Pendiente |
| SEC-03 | Logs de fallos | Sin PII, contenido, token ni API keys | Unit + review | Pendiente |
| DATA-01 | Constraints/defaults reales de tablas | Candidatos compatibles o adaptados antes de migración | Schema inspection | Pendiente |
| DATA-02 | Radicado colisiona con unique constraint | Rollback íntegro; reintento controlado genera nuevo ID/radicado | PG integration | Pendiente |
| DATA-03 | Evento inicial y actor de sistema | Valores admitidos por constraints y semántica auditada | PG integration | Pendiente |
| REC-01 | mark_failed con token/lease válidos | Estado failed, token liberado, metadata Storage preservada y audit registrada | PG integration | Pendiente |
| REC-02 | mark_failed con token antiguo o lease vencido | false; sin cambio ni audit de transición | PG integration | Pendiente |
| REC-03 | mark_uncertain con token actual | Estado uncertain; sin reintento automático | PG integration | Pendiente |
| REC-04 | mark_uncertain con token reemplazado | false; worker stale no puede poner en cuarentena el claim nuevo | PG integration | Pendiente |
| REC-05 | Conciliar uncertain con attachment referenciado | Excepción/abort; no cambia estado ni borra objeto | PG integration | Pendiente |
| REC-06 | Conciliar uncertain sin referencia ni submission_id | Estado failed; metadata preservada; actor y razón auditados | PG integration | Pendiente |
| REC-07 | Intentar conciliar estado distinto de uncertain | false; sin mutación | PG integration | Pendiente |
| REC-08 | anon/authenticated invocan RPC de recuperación | Permiso denegado | PG ACL | Pendiente |

## Hallazgos estáticos de esta continuación

- Se detectó una referencia inválida a `p_request_type` dentro de `pqr_submit_reserve`: esa función no recibe ese parámetro. Se retiró el predicado para evitar un error de compilación SQL.
- Se añadieron guardas explícitas `IS NULL` para `p_limit`, `p_window_seconds` y `p_lease_seconds`; las comparaciones de rango por sí solas no bloqueaban NULL.
- Se añadieron guardas de NULL para idempotency key/claim token en mark_uploaded y finalize.
- Se comprobó textualmente que el SQL candidato conserva tres funciones, tres aperturas/cierres dollar-quote y que los guards mencionados están presentes.

## Criterios para declarar listo

No declarar listo para integración hasta que:
1. Todas las pruebas PG integration y ACL/RLS estén aprobadas en una instancia aislada.
2. Las pruebas Storage cubran los fallos ambiguos y la limpieza conservadora.
3. El worker pase pruebas de runtime y las pruebas Outbox.
4. Los constraints/defaults reales y la firma/ACL de `pqr_consume_rate_limit` estén confirmados.
5. La revisión de seguridad y privacidad esté aprobada.
6. Haya rollout coordinado y plan de reversa, con aprobación explícita separada para producción.

No se ejecutó PostgreSQL, Deno, Storage, Resend ni el formulario en esta continuación. El estado de toda la matriz permanece **Pendiente**; los chequeos descritos arriba son estáticos.


## Continuación 2026-11-10 — RPC de recuperación

El candidato independiente `NOFEKI_PQR_SUBMISSION_RECOVERY_RPCS_CANDIDATE_NOT_EXECUTABLE.sql` incorpora:
- tabla privada `pqr_submission_recovery_audit`;
- `pqr_submit_mark_failed`;
- `pqr_submit_mark_uncertain`;
- `pqr_submit_reconcile_uncertain`.

Se añadieron REC-01 a REC-08 para cubrir fencing, leases, transición a uncertain, conciliación con y sin referencias, y permisos. Todas permanecen pendientes de PostgreSQL 17 aislado. La matriz no declara aprobaciones funcionales.


Nota de integración: las RPC de recuperación permanecen en un SQL candidato separado del candidato base de radicación. No consolidar ni ejecutar hasta compilar ambos en PostgreSQL 17 aislado y verificar constraints, grants y concurrencia.


## Hallazgo estático adicional — ventana temporal de idempotencia del proveedor (2026-11-10)

El worker conserva `event_key` y el backoff nominal configurado suma menos de 24 horas. Sin embargo, ese cálculo no limita el tiempo real transcurrido: una pausa del scheduler, indisponibilidad prolongada o retraso operativo puede hacer que un evento vuelva a reclamarse después de la ventana de retención de la clave del proveedor. El código actual no consulta ni aplica un vencimiento temporal antes de llamar a Resend. En ese escenario, reutilizar la misma clave ya no garantiza deduplicación.

**Bloqueo para integración:** incorporar una marca persistente de primer intento ante el proveedor (no reiniciable en reintentos), devolverla desde `pqr_outbox_claim` y hacer que el worker se abstenga de llamar a Resend cuando se alcance un margen de seguridad anterior al vencimiento de idempotencia. El evento debe pasar a `uncertain` para conciliación, nunca a un reenvío automático. Probar también retrasos del scheduler superiores a 24 horas. No se ha modificado aún el SQL ni el worker.
