# NOFEKI PQR — modelo de pruebas de concurrencia y fallos
Fecha: 2026-11-08
Estado: especificación de pruebas; no ejecutada.

## Modelo mínimo
La reserva tiene una clave única y un payload hash. El almacén de prueba debe implementar atomicidad real (restricción UNIQUE/transacción); un mock basado solo en SELECT seguido de INSERT no sirve para demostrar concurrencia.

## Pruebas de carrera
1. Lanzar 50 reservas simultáneas con la misma clave y mismo hash.
   - Esperado: exactamente 1 claimed; el resto in_progress/already_sent según el estado observado.
   - Esperado: exactamente 1 llamada al adaptador falso del proveedor.
2. 20 reservas simultáneas con la misma clave y hashes distintos.
   - Esperado: una sola reserva ganadora; todos los hashes incompatibles reciben key_conflict; cero segundo envío.
3. Dos claves distintas para mismo submission_id.
   - Esperado: dos operaciones independientes; envío solo si ambas acciones fueron autorizadas explícitamente.

## Matriz de fallos inyectados
| Punto de fallo | Estado esperado | ¿Reenvío automático? |
|---|---|---|
| RPC de reserva falla | no reservado | No |
| Reserva creada; transición a sending falla | reserved o error conciliable | No |
| Proveedor rechaza inequívocamente | failed | No; requiere nueva acción |
| Proveedor acepta; respuesta recibida | sent | No |
| Timeout después de enviar request | uncertain | No |
| Proveedor acepta; persistencia de sent falla | sending/uncertain tras reconciliación | No |
| Inserción de pqr_events falla en cambio de estado | rollback del cambio de estado | No aplica |
| Cliente repite POST con misma clave | devuelve operación existente | No |
| Misma clave, payload alterado | 409 key_conflict | No |

## Invariantes que deben verificarse
- Nunca más de un caller recibe permiso de envío para la misma clave.
- Nunca llamar al proveedor antes de reservar y reclamar la operación.
- sent es terminal e inmutable.
- uncertain no se reenvía hasta conciliación humana con evidencia del proveedor.
- El cambio de estado y su evento son atómicos.
- Los logs no incluyen tokens, API keys, cuerpo completo ni adjuntos.
- El rol anon/authenticated no puede leer ni mutar la tabla interna.
- Los RPC no son ejecutables por PUBLIC/anon/authenticated.

## Harness propuesto
- DB PostgreSQL efímera o proyecto aislado aprobado, sin datos reales.
- Adaptador falso de Resend que permita: aceptar, rechazar, retrasar, cortar conexión y devolver respuestas ambiguas.
- Dos o más conexiones PostgreSQL independientes para forzar carrera real.
- Pruebas Deno/TypeScript para contrato de Edge Function y pruebas SQL/integración para atomicidad.
- Evidencia: salida de tests, conteo de llamadas al proveedor falso, filas finales y ACL/RLS.
- Prohibido apuntar el harness al proyecto productivo o a Resend real.

## Criterio de salida
No declarar resuelto el riesgo de duplicados hasta que las pruebas 1, 2 y todos los fallos de persistencia pasen en entorno aislado. Esta especificación no demuestra por sí sola idempotencia y no autoriza despliegue.
