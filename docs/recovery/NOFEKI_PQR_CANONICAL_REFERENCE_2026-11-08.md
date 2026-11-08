# NOFEKI PQR — fuente de referencia reconciliada (candidata, no desplegada)
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Qué significa este paquete

Este paquete establece una única referencia de revisión para el siguiente ciclo técnico:
- Snapshots exactos del entorno activo: `deployed-snapshots/pqr-submit-v6/index.ts` y `deployed-snapshots/pqr-admin-v9/index.ts`.
- Candidato reconciliado: los dos archivos bajo `canonical-candidate/`.
- Comparación de cambios: `NOFEKI_PQR_EXACT_SOURCE_RECONCILIATION_2026-11-08.md`.

Los archivos de `canonical-candidate` son copias del código de la rama de recuperación después de verificar sus diferencias con el código desplegado. No son un deploy ni una afirmación de que ya estén ejecutándose.

## Reglas de control

1. El snapshot desplegado es evidencia de qué código estaba activo en la inspección.
2. El candidato es la base para la siguiente implementación; conserva mejoras de manejo de errores del branch.
3. Ningún archivo de este paquete debe desplegarse directamente sin completar pruebas y revisión.
4. No cambiar la allowlist de administrador, secretos, CORS, validación Turnstile ni la función de rate limit como parte de la reconciliación.
5. La siguiente iteración implementa idempotencia/outbox/atomicidad en un candidato separado y añade pruebas reales de PostgreSQL.
6. Todo cambio de esquema sigue pendiente de aprobación y ejecución aislada.

## Resultado de verificación

- pqr-submit candidato: idéntico byte por byte al archivo de recuperación consultado.
- pqr-admin candidato: idéntico byte por byte al archivo de recuperación consultado.
- No se modificó `supabase/functions/pqr-submit/index.ts` ni `supabase/functions/pqr-admin/index.ts` en este commit.
- No hubo cambios en Supabase, Storage, Auth, secrets ni despliegues.

## Límites actuales

El candidato todavía conserva las limitaciones ya identificadas: no tiene idempotency key, no crea outbox, ejecuta emails dentro del request, y hace escrituras de estado e historial separadas. Es una base reconciliada, no la solución final de consistencia.
