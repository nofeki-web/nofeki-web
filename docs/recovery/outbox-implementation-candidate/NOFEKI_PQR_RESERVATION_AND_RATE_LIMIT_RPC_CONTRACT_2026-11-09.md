# NOFEKI PQR — reserva idempotente coordinada con rate limit
Fecha: 2026-11-09
Rama: recovery/pqr-admin-retry-fix-20261108
Estado: contrato técnico de implementación; NO es migración ejecutable.

## Propósito

Cerrar el hueco entre el formulario público y el Outbox: reservar una intención de radicación una sola vez, vincularla a un fingerprint calculado por servidor y consumir cuota únicamente cuando nace una clave nueva.

## Contrato de persistencia

Tabla privada `private.pqr_submission_requests`:
- `idempotency_key uuid primary key`
- `request_fingerprint text not null` (64 hex)
- `source_hash text not null` (hash de IP/contexto, no IP en claro)
- `state text not null`: `reserved | uploaded | completed | failed | uncertain`
- `submission_id uuid null references public.pqr_submissions(id)`
- `storage_object_path text null`
- `attachment_sha256 text null`
- `attachment_bytes bigint null`
- `safe_error_code text null`
- `created_at, updated_at, completed_at timestamptz`
- restricciones de estado, hash, bytes positivos y coherencia de completed/submission_id.

No almacenar payload PII, base64, token Turnstile ni IP sin hash. La tabla y sus índices deben quedar en esquema privado, RLS habilitado y sin grants a anon/authenticated.

## RPC conceptual: pqr_submit_reserve

Entrada:
- UUID de idempotencia.
- fingerprint SHA-256 calculado en Edge Function.
- source_hash calculado en Edge Function usando IP proxy confiable + namespace/version.
- límite y ventana configurados en servidor, nunca parámetros libres del navegador.

Secuencia transaccional:
1. Validar formato de clave, fingerprint y source_hash.
2. Tomar advisory transaction lock derivado de la clave idempotente. Serializa dos solicitudes concurrentes con la misma clave.
3. Consultar `private.pqr_submission_requests` por clave:
   - fingerprint distinto: `key_conflict`;
   - completed: `replay` y devolver submission_id/reference de la operación existente;
   - reserved/uploaded con lease vigente: `in_progress`;
   - uncertain: `uncertain`, nunca reclamar automáticamente;
   - failed recuperable: aplicar política explícita de reanudación, no crear otra fila.
4. Si la clave no existe, tomar advisory transaction lock derivado de source_hash para serializar nuevas claves de la misma fuente.
5. Invocar `public.pqr_consume_rate_limit(source_hash, limit, window_seconds)` dentro de la misma transacción.
6. Si la cuota se deniega, devolver `rate_limited` sin insertar reserva.
7. Si se permite, insertar la reserva `reserved` y devolver `claimed`.
8. Confirmar la transacción. Una excepción revierte tanto la cuota como la reserva.

La función de rate limit existente usa upsert atómico. Antes de codificar la RPC, verificar su firma, permisos efectivos y si puede invocarse desde el contexto SECURITY DEFINER elegido. No duplicar ni cambiar su semántica sin prueba.

## Seguridad de locks

- Locks en orden fijo: idempotency key y luego source_hash.
- Usar namespace/semilla distintos para los dos advisory locks.
- Documentar y probar colisiones de hash: pueden serializar operaciones no relacionadas, pero no deben permitir duplicados ni saltarse cuota.
- No aceptar limit/window del cliente. Constantes de configuración del servidor o tabla privada de configuración.
- Todas las funciones deben tener search_path vacío y nombres cualificados.
- La RPC privilegiada no puede quedar ejecutable por anon/authenticated.

## Lease y recuperación

La reserva necesita lease acotado y propietario/claim token para evitar que una ejecución caída deje el envío bloqueado para siempre. Un proceso de recuperación:
- puede reclamar solo reservas vencidas en estados recuperables;
- rota un token de fencing;
- nunca reanuda una reserva `uncertain` sin conciliación de Storage/DB;
- no borra objetos si una submission los referencia;
- no vuelve a consumir rate limit cuando retoma la misma clave.

La política exacta de expiración y recuperación debe acordarse con el contrato de saga de Storage antes de escribir SQL definitivo.

## Respuestas HTTP de Edge Function

| Reserva | HTTP | Resultado |
|---|---:|---|
| claimed | continuar saga | 201 solo después de finalización DB |
| replay | 200 | mismo radicado, `replayed: true` |
| in_progress | 202 | reintentar con la misma clave |
| key_conflict | 409 | clave ligada a contenido distinto |
| uncertain | 503 | requiere conciliación, sin repetir efectos |
| rate_limited | 429 | no se creó reserva |
| error de reserva | 503 | misma clave se conserva |

Turnstile se verifica en cada intento HTTP, incluso replay. El replay no consume una cuota adicional.

## Contrato del navegador

- Crear UUID con `crypto.randomUUID()` al iniciar una intención de radicación.
- Reutilizar la misma clave en reintentos de red del mismo payload sin cambios.
- Enviar `Idempotency-Key` y añadirlo a CORS.
- No persistir PII, adjunto ni token Turnstile en localStorage/sessionStorage.
- Mantener la clave solo en memoria durante la vida de la página en la primera versión. Si se requiere recuperación tras refresh, aprobar explícitamente persistir únicamente UUID + estado no sensible.
- Si cambia cualquier campo o adjunto después de un intento ambiguo, invalidar la clave anterior y crear otra para la nueva intención.
- Renovar Turnstile para cada POST.
- Limpiar clave al recibir éxito definitivo. Conservarla ante 202/503/timeout.
- Nunca mostrar éxito hasta que el backend confirme que la transacción de radicación se confirmó.

## Pruebas de aceptación

1. 50 claves idénticas concurrentes con mismo fingerprint: una reserva y un único consumo de cuota.
2. Misma clave + fingerprint distinto: conflicto, sin segundo consumo ni segunda reserva.
3. Misma clave completada: replay y mismo radicado, sin consumo adicional.
4. Dos claves distintas concurrentes desde mismo source_hash: límite aplicado sin excedente.
5. Denegación de cuota: no deja reserva huérfana.
6. Excepción después de consumir cuota pero antes de insertar: rollback de ambas operaciones.
7. Dos source_hash distintos: no se bloquean entre sí salvo colisión advisory inocua.
8. Caller anon/authenticated no puede invocar RPC ni consultar tabla privada.
9. Reintento con Turnstile vencido: se rechaza el intento HTTP y no cambia el estado durable.
10. Lease vencido: reanudación segura sin nuevo consumo de cuota.

## Bloqueos para SQL ejecutable

- Inspeccionar definición real y grants de `pqr_consume_rate_limit`.
- Definir política exacta de lease/claim token de reserva.
- Alinear retorno de reserva con la generación actual de reference_code.
- Implementar RPC reserve + finalize con las mismas restricciones de seguridad.
- Probar en PostgreSQL aislado con constraints, grants, RLS y concurrencia reales.
- Solo después actualizar el formulario y Edge Function como una versión coordinada.

## Límite de esta etapa

Este contrato no modifica funciones desplegadas, formulario, tablas, buckets, secretos ni datos. No se ha ejecutado SQL ni se afirma que la idempotencia esté implementada.


## Implementación candidata preparada — 2026-11-09

Se creó el archivo separado:
`NOFEKI_PQR_IDEMPOTENT_SUBMISSION_AND_INITIAL_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql`.

Incluye:
- tabla privada `private.pqr_submission_requests` con fingerprint, hash de fuente, estado, token de fencing, lease, metadatos de Storage y vínculo al radicado;
- `pqr_submit_reserve`: serializa por clave y por fuente, cobra rate limit únicamente al crear una clave nueva y permite reanudar una reserva vencida sin consumir cuota otra vez;
- `pqr_submit_mark_uploaded`: registra solo metadatos verificados y ruta determinística ligada al UUID;
- `pqr_submit_finalize`: inserta radicado, historial inicial y dos filas Outbox (`applicant_confirmation`, `internal_alert`) en una sola transacción; no envía correos;
- grants únicamente a `service_role` para las RPC y tabla privada.

La RPC de reserva es SECURITY INVOKER. Por tanto, al invocarse con service_role, la llamada anidada a `pqr_consume_rate_limit` usa el mismo rol; esto respeta el modelo de permisos observado y evita introducir SECURITY DEFINER. Debe comprobarse con ACL reales en PostgreSQL aislado.

## Límites detectados antes de integración

- La ruta determinística propuesta es `<idempotency-uuid>/soporte.<ext>`; la Edge Function debe verificar bytes/hash al encontrar un objeto ya existente. La RPC no puede verificar Storage por sí sola.
- La RPC de finalización no incluye PII ni cuerpo del archivo en la tabla de reservas. Los datos de PQR se insertan solo al finalizar.
- El código de referencia conserva el formato actual `NFK-YYYY-XXXXXXXX`; la restricción UNIQUE real y el manejo de colisión deben verificarse. Ante colisión, toda la transacción revierte; la misma clave puede reintentarse.
- La RPC no escribe `notification_status` porque el CHECK/default real de esa columna aún debe inspeccionarse. La respuesta RPC informa `queued` y las filas Outbox son la fuente de verdad; al integrar, el panel deberá derivar los estados por evento o actualizar la columna tras verificar su contrato.
- El actor del evento inicial usa `system@nofeki.com`; validar cualquier CHECK de email/actor real. Si existe restricción distinta, definir identidad de sistema compatible antes de migrar.
- Falta una RPC explícita de transición a `failed`/ `uncertain`, conciliación de Storage, limpieza conservadora y expiración/retención. No marcar como fallida una operación con resultado ambiguo.
- El candidato depende de la tabla `private.pqr_outbox` y de las restricciones/columnas del candidato Outbox administrativo.

**No se ha ejecutado ni compilado SQL.** La revisión fue estática sobre texto y contratos inspeccionados. No hay pruebas de PostgreSQL, RLS, ACL, rollback o concurrencia real.
