# 03 — Pruebas, criterios de aceptación y rollout

**No ejecutado contra PostgreSQL.** No afirmar que este paquete está probado en base de datos real.

## 1. Pruebas unitarias/contrato

- Validar cada tipo de evento y versión de payload.
- Rechazar batch fuera de 1–25 y lease fuera de 30–600 s.
- Rechazar request key inválida/fingerprint no hexadecimal.
- Igual request key + mismo fingerprint devuelve el mismo radicado.
- Igual request key + distinto fingerprint devuelve conflicto.
- Dos request keys distintas para dos radicaciones legítimas producen dos casos.
- Event key única impide duplicar notificación del mismo evento.
- La misma clave de Resend siempre se acompaña del mismo payload.
- Error permanente va a dead; error temporal programa retry.
- Error y logs nunca incluyen PII, token ni secreto.

## 2. Pruebas PostgreSQL obligatorias

| Prueba | Resultado esperado |
|---|---|
| Fallo después de insertar submission antes del outbox | Rollback completo: ni submission ni outbox |
| Dos POST simultáneos con misma request key | Una submission; segundo obtiene replay |
| Misma request key con fingerprint distinto | 409 lógico; no cambia datos |
| Dos workers reclaman lote concurrentemente | Ninguna fila entregada a ambos con lease válido |
| Worker A expira; worker B reclama; A finaliza tarde | A no puede finalizar por token distinto |
| Error al insertar evento de historial | Toda mutación revierte |
| Error al insertar outbox | Toda mutación revierte |
| Dos transiciones simultáneas con mismo expected status | Una confirma; otra conflicto |
| Retry con clave Resend dentro de 24h | Mismo email ID del proveedor |
| Aceptación Resend y crash antes de finalize | Retry con misma key; documentar riesgo después de 24h |
| Dead-letter y requeue admin | Se conserva auditoría y actor |
| RLS/grants | anon/authenticated no acceden; service_role solo vía funciones previstas |

Las pruebas deben correr en Postgres 17 (alineado al proyecto inspeccionado), con dos o más sesiones/conexiones reales para concurrencia. Los harness Node/in-memory existentes solo cubren lógica simulada.

## 3. Pruebas funcionales de punta a punta

1. Radicar PQR sin adjunto: una submission, evento inicial y dos filas outbox.
2. Radicar PQR con PDF/JPG/PNG válido: Storage privado y misma atomicidad de datos; simular RPC fallido y comprobar compensación.
3. Turnstile inválido: ninguna fila PQR/outbox.
4. Rate limit excedido: ninguna fila PQR/outbox adicional.
5. Confirmación al solicitante y alerta interna: cada correo se entrega por separado; fallo de uno no cambia el otro.
6. Responder desde panel: la respuesta se guarda inmediatamente, email queued; worker envía y panel refleja delivered.
7. Reintento administrativo: audita quién/cuándo/por qué; no crea duplicado.
8. Cambio de estado: historial y outbox se confirman juntos.
9. Recargar panel tras timeout: no duplica respuesta ni transición.
10. Validar que el panel no confunda queued con delivered.

## 4. Métricas mínimas

- pending_count y oldest_pending_age.
- processing_count y expired_lease_count.
- delivered_count por tipo.
- dead_count y oldest_dead_age.
- attempts histogram.
- rate-limit / 5xx / hard-failure.
- duplicate request suppressions y stale lease finalizations.

Etiquetas de métricas no contienen PII.

## 5. Puertas de salida

No se considera listo hasta:
- [ ] Transiciones de estado aprobadas.
- [ ] Request UUID integrada en formulario y panel.
- [ ] Schema/grants/Data API confirmados en entorno aislado.
- [ ] Migración creada con Supabase CLI en entorno con CLI y revisada; no inventar timestamp de migración.
- [ ] Pruebas PostgreSQL 17 y concurrencia ejecutadas.
- [ ] Pruebas Edge Function con Deno ejecutadas.
- [ ] Advisors security/performance revisados.
- [ ] Contrato UI actualizado para queued/delivered/dead.
- [ ] Backfill/migración de notificaciones antiguas definido (si se requiere).
- [ ] Plan de rollback y reconciliación de adjuntos huérfanos documentado.
- [ ] Aprobación explícita del usuario para PR, migración y despliegue, cada uno por separado.

## 6. Alcance realizado en esta etapa

Solo documentación candidata en una rama separada. No hubo ejecución SQL, cambios en Supabase, despliegues, PR, merge ni envío de correos.
