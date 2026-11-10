# NOFEKI PQR — revisión del worker Outbox candidato

Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: **candidato aislado; no desplegado; no ejecutado contra Supabase**

## Archivo

`docs/recovery/outbox-implementation-candidate/pqr-outbox-worker/index.ts`

Implementa un worker Edge Function en TypeScript que:
1. Acepta únicamente POST con secreto dedicado `PQR_OUTBOX_WORKER_SECRET`; comparación de secreto en tiempo constante.
2. Usa `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en servidor y crea el cliente sin persistencia/refresco de sesión.
3. Reclama hasta 5 eventos mediante `pqr_outbox_claim(5, 180)`.
4. Carga columnas explícitas de `pqr_submissions`; para `admin_response`, carga `response` y valida el evento origen.
5. Construye HTML escapando los datos y envía a Resend con `Idempotency-Key: event_key`.
6. Confirma con `pqr_outbox_finish` usando el lease token; ante error, libera/reprograma mediante `pqr_outbox_retry`.
7. No registra correo, nombre, asunto, mensaje, cuerpo del proveedor ni token. Solo identificador Outbox, número de intento y códigos acotados.
8. No configura cron, no crea secretos, no modifica la función desplegada ni el panel.

## Configuración que requerirá cuando se apruebe el despliegue

Secretos de Edge Functions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `PQR_FROM_EMAIL`
- `PQR_NOTIFY_EMAIL`
- `PQR_OUTBOX_WORKER_SECRET` (secreto aleatorio independiente, no reutilizar la API key de Resend)

La invocación deberá venir de un scheduler/cron confiable que envíe `Authorization: Bearer <PQR_OUTBOX_WORKER_SECRET>`. No se ha configurado scheduler ni se ha decidido todavía su mecanismo. Si se configura la verificación JWT de Supabase para esta función, el despliegue deberá documentar expresamente cómo se combina con el secreto interno; no se debe dejar una función invocable públicamente sin autenticación.

## Idempotencia y ventana de reintentos

Resend documenta retención de claves de idempotencia de **24 horas**. El worker reutiliza el mismo `event_key` en cada reintento. Los retardos programados suman menos de 24 horas antes del límite de intentos (8), reduciendo el riesgo de repetir un envío después de expirar la protección del proveedor. Esto no equivale a entrega exactamente-una-vez garantizada: fallos prolongados, intervención manual posterior o reintentos fuera de esa ventana necesitan una política específica y podrían duplicar un correo.

La política de reintentos del SQL candidato marca el evento como `dead` al alcanzar `max_attempts`; el worker no reintenta eventos muertos y no contiene acción administrativa para reabrirlos.

## Dependencias y compatibilidad

- Requiere que el SQL candidato de RPC/Outbox esté aplicado en un entorno aislado antes de ejecutar el worker.
- Requiere que el flujo de radicación inserte los eventos `applicant_confirmation` e `internal_alert` en Outbox. El `pqr-submit v6` actualmente desplegado envía esos correos en forma secuencial y **no** inserta Outbox; este worker por sí solo no migra ese flujo.
- Requiere que la RPC de respuesta administrativa cree `response_sent` y su fila `admin_response` en una sola transacción. El `pqr-admin v9` desplegado todavía envía el correo directamente; aún no está integrado con esta RPC.
- La RPC `pqr_outbox_claim` solo reclama hasta 25 filas y acepta leases entre 15 y 600 segundos; el worker usa 5 y 180 segundos para dejar margen a la ejecución secuencial por lote.
- La configuración de Resend y el dominio remitente deben verificarse en el entorno aislado; no se han enviado correos de prueba.

## Riesgos y trabajo pendiente antes de producción

1. Ejecutar el SQL en PostgreSQL aislado y verificar compilación, grants, RLS, transacciones, locks, expiración de lease y fencing token.
2. Probar el worker con mocks de Supabase/Resend y pruebas de integración: fallo antes/después del envío, timeout ambiguo, lease vencido, respuesta 409 concurrente, proveedor 5xx, payload inválido y evento dead.
3. Diseñar la migración coordinada de `pqr-submit` para crear Outbox en la misma transacción que la radicación. La carga del adjunto hoy ocurre antes del INSERT y requiere estrategia de compensación si la transacción falla.
4. Integrar `pqr-admin` con la RPC atómica y revisar la diferencia de comportamiento: el RPC candidato marca automáticamente el caso como `Respondida`; el `pqr-admin v9` actual deja el estado bajo control explícito del administrador.
5. Definir el scheduler, autenticación interna, frecuencia, límites, monitoreo y alertas.
6. Diseñar reintento administrativo de eventos dead con auditoría e idempotencia; no está implementado.
7. No desplegar ni cambiar secretos hasta contar con aprobación explícita y pruebas PostgreSQL satisfactorias.

## Verificación realizada en esta etapa

- Revisión estática de la firma de las RPC y columnas usadas contra el SQL candidato.
- Revisión estática de los tres tipos de evento, escaping HTML, secreto interno, service role solo servidor, idempotency header, lease token y manejo de errores.
- El lote se limitó a 5 con lease de 180 segundos para reducir riesgo de expiración mientras se procesa secuencialmente.
- No se ejecutó Deno, no se compiló TypeScript, no se conectó a Resend, no se ejecutó PostgreSQL y no se invocó ninguna Edge Function desplegada. Por tanto, esto **no** se presenta como prueba funcional.

## Referencias oficiales consultadas

- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase secrets: https://supabase.com/docs/guides/functions/secrets
- Resend idempotency keys y retención de 24 horas: https://resend.com/changelog/idempotency-keys
- Supabase changelog: https://supabase.com/changelog?tags=edge+functions

En el changelog visible no se identificó un cambio incompatible específico para este patrón de Edge Function. La advertencia de Supabase sobre TLS 1.2 del 12 de octubre de 2026 afecta clientes antiguos que no soportan cifrados modernos; no es un motivo para alterar este worker, pero conviene mantener runtimes y clientes actualizados.


## Prueba de modelo ejecutada en entorno local (2026-11-08)

Se ejecutó con Node.js un harness independiente de siete escenarios de estado: claim exclusivo, lease vencido/fencing token, backoff, dead-letter, resultado ambiguo del proveedor conservando la clave, evento entregado no reclamable y suma de retardos menor de 24 horas. Resultado: **7 aprobados, 0 fallidos**.

Esta ejecución fue del harness local equivalente, no del archivo versionado completo ni del worker Deno. No valida llamadas reales a Supabase/Resend ni SQL/PostgreSQL. El archivo versionado de pruebas queda como artefacto reproducible para el entorno de desarrollo.


## Revisión complementaria — 2026-11-09

Se detectó un riesgo en la versión anterior del candidato: el catch general enviaba a `pqr_outbox_retry` también ante timeout de red y ante fallo al persistir `pqr_outbox_finish`. En esos escenarios Resend podría haber aceptado el mensaje, por lo que devolver el evento a `pending` podía producir un duplicado cuando la idempotencia del proveedor ya no estuviera vigente.

### Correcciones incorporadas en rama recovery

- El estado Outbox ahora contempla `uncertain`, incluido un `ALTER TABLE ... DROP/ADD CONSTRAINT` explícito para que la definición candidata sea coherente si la tabla ya existe en el entorno aislado.
- Se añadió RPC `pqr_outbox_mark_uncertain(outbox_id, lease_token, error_code)`, protegida por lease token. Libera el lease y pone el evento en cuarentena; el claim existente no reclama `uncertain`.
- El worker clasifica fallos de red/timeout, respuestas 408/429/5xx, respuesta exitosa sin ID y fallo de persistencia posterior al envío como resultado incierto. Usa la RPC de cuarentena y no el retry automático.
- Los errores previos al envío y los rechazos explícitos no ambiguos conservan el camino de retry acotado.
- La clave `event_key` se mantiene estable; no se crea una clave nueva por intento.

### Validación pendiente

- Revisión estática de los cambios: completada contra los archivos recuperados de GitHub.
- Compilación Deno/TypeScript: pendiente (Deno no está disponible en el entorno actual).
- Compilación y ejecución SQL en PostgreSQL aislado: pendiente.
- Pruebas reales de lease, fencing, transición a `uncertain`, grants/RLS y recuperación administrativa: pendientes.
- No se ha desplegado worker, configurado scheduler ni cambiado secretos.
