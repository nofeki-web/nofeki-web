# NOFEKI PQR — revisión estática del SQL candidato completo
Fecha: 2026-11-08  
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Artefacto revisado
`docs/recovery/outbox-implementation-candidate/NOFEKI_PQR_ATOMIC_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql`

Blob SHA verificado en GitHub: `c9d6033f1026d81d905bfbd0963cf93cf1473398`.

## Contenido incluido
- Columna aditiva `pqr_submissions.version BIGINT NOT NULL DEFAULT 1`.
- `private.pqr_admin_requests` con request_id único, submission, tipo de operación, fingerprint y resultado durable.
- `private.pqr_outbox` con event_key único, tipo, intentos, lease, fencing token, estado y source_event_id.
- RPC `pqr_admin_transition_status`: validación de matriz, expected status/version, no-op, auditoría transaccional e idempotencia.
- RPC `pqr_admin_create_response`: respuesta + evento + Outbox + cambio a Respondida en una sola transacción.
- RPC `pqr_outbox_claim`: lote limitado y SKIP LOCKED.
- RPC `pqr_outbox_finish` y `pqr_outbox_retry`: fencing token y actualización del email_status del evento de respuesta.
- RLS habilitado para tablas privadas, sin grants a clientes; EXECUTE de RPC restringido a service_role.

## Revisión estática realizada
Se recuperó el archivo después de los cambios y se verificó la presencia de cada componente, la ruta docs/recovery (no migration), la ausencia de llamadas mal calificadas a NULLIF/COALESCE y la ausencia de bloques DO incompletos. Todas las comprobaciones estáticas enumeradas pasaron.

## Hallazgos y limitaciones
1. No se dispone de PostgreSQL aislado, Docker/Podman ni Deno en el entorno actual. Por tanto, el SQL no se ha compilado ni ejecutado y no puede declararse sintácticamente validado.
2. No se ejecutaron transacciones concurrentes reales, fallos forzados, rollback, RLS tests ni Supabase Advisors.
3. El candidato no incluye todavía la RPC de creación pública PQR idempotente; la integración de `pqr-submit` necesita otra fase que incluya almacenamiento de clave del cliente y compensación para adjuntos en Storage.
4. No incluye todavía una RPC de reintento manual de dead-letter. Antes se debe resolver la retención de idempotencia del proveedor y exigir auditoría del administrador.
5. No incluye Edge Function worker ni cambios al panel. El claim/finish/retry SQL es solo la capa de persistencia; el worker aún debe cargar datos mínimos por source_event_id y enviar a Resend con event_key.
6. El diseño supone que la Edge Function de administración llama RPC con service_role solo después de validar el bearer token y la allowlist actual. No se debe llamar directamente desde el navegador.

## Decisión de seguridad
El archivo permanece en `docs/recovery/outbox-implementation-candidate/` y se etiqueta NOT EXECUTABLE. No se ha creado migración bajo `supabase/migrations`; no se ha ejecutado SQL en el proyecto Supabase; no se han cambiado funciones activas ni datos.

## Próxima puerta de validación
Antes de preparar una migración:
- ejecutar en PostgreSQL 17 aislado sobre un snapshot del esquema real;
- añadir fixtures mínimos de submission;
- verificar compilación de cada función y grants;
- correr pruebas de idempotencia, concurrencia, rollback y fencing;
- comprobar Advisors/RLS;
- revisar el flujo de adjuntos y la creación inicial de Outbox;
- reconciliar código de Edge Functions desplegadas 6/9 con el repo.

## Revisión complementaria — 2026-11-09

Se inspeccionó el SQL candidato completo (533 líneas) y se contrastó con las Edge Functions recuperadas de la misma rama.

### Defecto estático corregido
- En `public.pqr_outbox_finish`, el terminador del cuerpo PL/pgSQL estaba escrito como `$;` en lugar de `$$;`.
- Esto impedía compilar la función y, por tanto, el archivo completo.
- Se corrigió únicamente el delimitador en el commit `839844d9230444be1e41e48f46847d724fbde26c`.
- El cambio es una corrección estática; no equivale a compilación PostgreSQL ni prueba de ejecución.

### Brechas de integración confirmadas al comparar con las Edge Functions
1. `pqr-submit` todavía inserta la PQR y envía los dos correos directamente desde la Edge Function. No usa clave idempotente, RPC de creación ni Outbox.
2. `pqr-admin` todavía cambia estados mediante UPDATE directo y luego inserta el evento por separado; permite saltos no alineados con la política aprobada y no usa expected_version.
3. La respuesta administrativa todavía llama a Resend antes de persistir el evento; un timeout ambiguo o un fallo de historial puede causar duplicados o pérdida de trazabilidad.
4. `retry_notification` todavía vuelve a enviar una confirmación genérica directamente desde la Edge Function; no identifica un evento Outbox concreto ni registra una operación idempotente.
5. No se encontró un worker Edge Function conectado a las RPC claim/finish/retry.
6. El SQL candidato implementa las RPC administrativas y la cola para respuestas, pero no la RPC idempotente de creación inicial ni la generación de los dos eventos iniciales de correo.
7. El panel/formulario aún requieren integración coordinada: claves estables, versión esperada, presentación del estado individual de cada correo y acción de reintento vinculada a un evento.

### Próximas acciones técnicas
- Diseñar e implementar la RPC de creación PQR idempotente, incluyendo la política de adjuntos y compensación de Storage.
- Añadir en una misma transacción los eventos Outbox independientes `applicant_confirmation` e `internal_alert`.
- Implementar worker con claim/lease/fencing, Resend idempotency key estable, tratamiento de resultado incierto y límites de reintento.
- Migrar `pqr-admin` a las RPC administrativas solo después de probarlas en PostgreSQL aislado.
- Actualizar formulario y panel en un despliegue coordinado, sin ventana de incompatibilidad.
- Ejecutar compilación SQL, pruebas multi-sesión, rollback, grants/RLS y Advisors en entorno aislado.

**Estado:** el defecto de delimitador fue corregido en la rama. La solución sigue siendo candidata y no desplegable hasta superar todas las puertas de validación indicadas.
