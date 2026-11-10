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
| SEC-01 | anon/authenticated invocan RPC privilegiada | Permiso denegado | PG ACL | Pendiente |
| SEC-02 | anon/authenticated consultan request/outbox privados | Sin acceso | PG RLS/ACL | Pendiente |
| SEC-03 | Logs de fallos | Sin PII, contenido, token ni API keys | Unit + review | Pendiente |
| DATA-01 | Constraints/defaults reales de tablas | Candidatos compatibles o adaptados antes de migración | Schema inspection | Pendiente |
| DATA-02 | Radicado colisiona con unique constraint | Rollback íntegro; reintento controlado genera nuevo ID/radicado | PG integration | Pendiente |
| DATA-03 | Evento inicial y actor de sistema | Valores admitidos por constraints y semántica auditada | PG integration | Pendiente |

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
