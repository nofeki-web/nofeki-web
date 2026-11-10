# NOFEKI PQR — contrato de saga y conciliación de Storage

Fecha: 2026-11-10  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: contrato de diseño; no desplegado, no ejecutado y no constituye autorización de migración.

## 1. Principio de consistencia

PostgreSQL y Supabase Storage no comparten una transacción distribuida. La carga del archivo es un efecto externo que debe poder verificarse y compensarse de forma conservadora. La fuente de verdad para decidir si un objeto está en uso es la referencia persistida en `pqr_submissions.attachment_path`, junto con la reserva idempotente y su estado.

**Regla inviolable:** no borrar un objeto si existe una submission que lo referencia, si el resultado de la finalización es ambiguo, o si no se pudo consultar la base de datos para descartar referencias.

## 2. Identidad y ruta determinística

- La Edge Function genera/recibe una clave UUID `Idempotency-Key` y calcula el fingerprint en servidor.
- Ruta privada propuesta: `<uuid-idempotency>/soporte.<ext>`.
- Extensiones permitidas: `pdf`, `jpg`, `png`, derivadas del MIME validado en servidor.
- Subida con `upsert: false`; no sobrescribir un objeto existente.
- Antes de reutilizar un objeto existente, descargarlo o leerlo de forma confiable y comprobar SHA-256, tamaño y MIME real. Los metadatos declarados por el cliente no son prueba.
- La misma clave con fingerprint diferente debe detenerse como conflicto; nunca compartir/reutilizar el objeto.

## 3. Máquina de estados propuesta

| Estado | Significado | ¿Puede reclamar? | Acción segura |
|---|---|---:|---|
| `reserved` | Reserva creada; archivo aún no confirmado | Solo con lease expirado | Validar y subir o continuar sin adjunto |
| `uploaded` | Objeto verificado y metadata vinculada | Solo con lease expirado | Revalidar objeto y finalizar |
| `completed` | Submission + evento inicial + Outbox confirmados en una transacción | No | Reproducir respuesta original |
| `failed` | Fallo definitivo previo a commit, clasificado y recuperable según política | Sí, con nuevo fencing token | Reanudar misma intención y misma clave |
| `uncertain` | No se puede demostrar si finalizó/si el objeto está referenciado | No automáticamente | Conciliación operador/consulta DB |

Transiciones permitidas:

- Nueva intención → `reserved`.
- `reserved` → `uploaded` después de upload y verificación exitosa.
- `reserved` o `uploaded` → `completed` solo en la transacción de finalización.
- `reserved` o `uploaded` → `failed` solo ante fallo definitivo conocido y sin submission comprometida.
- Cualquier resultado con commit/Storage ambiguo → `uncertain` o mantener estado reclamable con la misma clave, pero nunca asumir fallo definitivo.
- `failed` → `reserved`/`uploaded` solo al reclamar de nuevo con fencing token nuevo.
- `uncertain` → `completed` si una consulta autoritativa encuentra la submission asociada y se valida Outbox; o a recuperación controlada si se demuestra que no hubo commit. No hacer transición automática por timeout.

No permitir transición desde `completed` hacia otro estado. No cambiar fingerprint, clave ni ruta en recuperación.

## 4. Protocolo Edge Function

1. Validar método, origen, JSON/multipart, Turnstile, consentimiento, campos, firma/tamaño/MIME del archivo y límites.
2. Calcular SHA-256 del archivo y fingerprint canónico en servidor.
3. Invocar `pqr_submit_reserve` con la clave, fingerprint y source hash. No aceptar hashes, ruta ni token de claim del navegador.
4. Interpretar respuesta:
   - `replay`: devolver radicado original, sin subir ni enviar correo.
   - `key_conflict`: HTTP 409; solicitar nueva intención, no reutilizar esa clave para contenido modificado.
   - `in_progress`: HTTP 202 o 409 reintentable, con Retry-After; no crear submission.
   - `rate_limited`: HTTP 429.
   - `uncertain`: HTTP 503/409 seguro con referencia de soporte; no iniciar otro envío.
   - `claimed`: continuar usando claim token solo en servidor.
5. Si hay archivo, intentar upload privado con `upsert:false`. Si Storage informa que ya existe, verificar bytes/hash/tamaño/MIME del objeto existente; no sobrescribir.
6. Invocar `pqr_submit_mark_uploaded` con la ruta determinística y metadata comprobada. Si devuelve false, detener; el claim pudo expirar o ser reemplazado.
7. Invocar `pqr_submit_finalize`. El commit de PQR + evento inicial + dos Outbox y el estado completed es atómico en PostgreSQL.
8. Ante respuesta de red perdida o timeout de finalize, no borrar archivo ni generar nueva clave. Consultar/reintentar usando la misma clave/fingerprint; si no se puede determinar el resultado, marcar/retener como incierto para conciliación.
9. Solo devolver HTTP 201 cuando finalize confirma commit; devolver 200/201 replay con mismo radicado cuando la reserva ya está completed. Notificaciones deben aparecer como queued, no sent/delivered.

## 5. Compensación y limpieza de objetos huérfanos

La limpieza debe ser un proceso separado, autenticado y auditable. No incluir borrado dentro del catch genérico de `pqr-submit`.

Candidato de elegibilidad para limpieza (todos obligatorios):
- La reserva está en `failed` y su antigüedad supera una ventana de gracia acordada (propuesta inicial: 7 días, sujeto a política de privacidad/retención).
- No existe fila en `pqr_submissions` cuyo `attachment_path` sea esa ruta.
- No existe reserva activa `reserved`/`uploaded` con lease vigente.
- No está en `uncertain`.
- La consulta a DB y Storage fue exitosa y consistente.
- La operación registra actor de sistema, ruta, hash, tamaño, motivo, timestamp y resultado sin registrar PII.

Orden: listar candidatos en DB → volver a comprobar referencias justo antes del borrado → borrar objeto exacto → registrar resultado. Si falla la comprobación DB, abortar. Si el borrado devuelve resultado ambiguo, volver a consultar Storage antes de repetir. Nunca borrar por prefijo completo ni por nombre de archivo genérico.

La ventana de gracia de 7 días es una propuesta para discusión, no una política aprobada. Debe alinearse con la política de retención y solicitudes de titulares.

## 6. Operaciones de recuperación que faltan

Antes de integración, diseñar RPCs server-only con permisos mínimos:
- Marcar fallo definitivo con código sanitizado, solo si claim token vigente y no existe submission.
- Marcar incierto cuando el proceso no puede demostrar el resultado; no permitir que el worker público lo haga.
- Conciliar una reserva incierta por clave: buscar submission asociada, validar reference y Outbox, y resolver sin duplicar.
- Liberar/reclamar una reserva expirada con nuevo token de fencing.
- Registrar intento de limpieza y su resultado, con idempotencia para no borrar referencias nuevas.

No se recomienda implementar aún estas RPC hasta conocer constraints reales, política de retención y modelo de auditoría.

## 7. Seguridad y privacidad

- `service_role` y claim token permanecen exclusivamente en Edge Function.
- El esquema `private` no se expone por Data API; RLS habilitado como defensa en profundidad.
- Revoke EXECUTE de RPC privilegiadas a `PUBLIC`, `anon`, `authenticated`; grant explícito solo a `service_role`.
- Nunca guardar contenido de PQR, email, archivo o Turnstile token en logs de conciliación.
- Bucket privado; no crear URLs públicas. Los enlaces firmados deben ser breves y emitidos solo para operadores autorizados.
- No permitir que un cliente solicite limpieza o marque un request como completado/fallido.

## 8. Pruebas de aceptación específicas de Storage

1. Upload normal → hash/tamaño/MIME coinciden → finalize referencia ruta.
2. Reintento después de upload exitoso → objeto existente verificado y reutilizado sin overwrite.
3. Objeto existente con bytes distintos → conflicto; no overwrite ni finalize.
4. Upload exitoso + timeout antes de mark_uploaded → mismo key recupera objeto y lo verifica.
5. Mark uploaded exitoso + timeout → reintento reconoce metadata idéntica; metadata distinta se rechaza.
6. Lease expira durante upload → token antiguo no puede marcar ni finalizar.
7. Finalize commit exitoso + HTTP response perdida → retry devuelve mismo radicado; objeto no se elimina.
8. Finalize rollback conocido → reserva recuperable; objeto se conserva hasta reintento o limpieza segura.
9. DB no disponible durante conciliación → no borrar.
10. Reserva uncertain → nunca limpieza automática.
11. Submission referencia ruta → limpieza rechazada aunque la reserva parezca failed.
12. Objeto huérfano supera grace period y no hay referencias → borrar ruta exacta y auditar.
13. Borrado Storage ambiguo → verificar existencia antes de reintentar.
14. Dos procesos de limpieza concurrentes → un solo resultado idempotente; no afectar objeto referenciado.

## 9. Decisiones pendientes antes de codificar

- Confirmar columnas, constraints, triggers y FK reales de `pqr_submissions`, `pqr_events`, `private.pqr_outbox`.
- Confirmar bucket, límites, convenciones de ruta y APIs Storage disponibles en el runtime actual.
- Definir retención legal/operativa y aprobar o cambiar la gracia propuesta de 7 días.
- Definir actor y formato de auditoría de las acciones de sistema.
- Validar RPC de rate limit anidada, grants, RLS y transacciones en PostgreSQL 17 aislado.
- Diseñar y probar RPC de failed/uncertain/reconciliation antes de tocar la Edge Function.

## 10. Límite de ejecución

Este documento es especificación. No se ha ejecutado SQL, Storage, Edge Function ni correo. No cambia el proyecto Supabase ni producción.
