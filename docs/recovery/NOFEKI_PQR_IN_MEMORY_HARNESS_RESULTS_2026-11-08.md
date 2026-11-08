# NOFEKI PQR — resultado de validación del harness en memoria
Fecha: 2026-11-08
Rama: recovery/pqr-admin-retry-fix-20261108
Estado: 8 escenarios ejecutados en Node.js 22.16.0; 8 pasaron, 0 fallaron.

## Qué se ejecutó
Se ejecutó localmente con Node.js integrado `node:test` una réplica del contrato del harness determinista, sin dependencias externas:
- 50 solicitudes simultáneas con la misma clave: una reserva ganadora y una llamada al proveedor simulado.
- Misma clave con payload distinto: conflicto.
- Operación enviada: terminal.
- Timeout ambiguo: estado uncertain y reintento automático bloqueado.
- Rechazo inequívoco: failed y misma clave no reutilizable.
- Clave vinculada a radicado y tipo de operación.
- Transiciones de estado no repetibles y estado sent terminal.
- Confirmación y notificación interna como operaciones separadas.

Resultado observado:
```
tests 8
pass 8
fail 0
```

## Qué demuestra
La lógica de la máquina de estados y los escenarios simulados se comportan como se espera bajo el adaptador en memoria utilizado.

## Qué NO demuestra
- No se ejecutó Deno ni el archivo TypeScript `pqr-idempotency-harness.test.ts`.
- No se ejecutó PostgreSQL ni se probaron conexiones independientes.
- El mutex del adaptador simula atomicidad; no demuestra la carrera real de `UNIQUE(idempotency_key)`.
- No se probaron RPC, transacciones, rollback, RLS ni ACL.
- No se llamó a Supabase, Resend, Turnstile ni Storage.
- No es evidencia para desplegar ni para afirmar idempotencia en producción.

## Siguiente puerta técnica
Preparar un PostgreSQL aislado efímero o local y una prueba de integración con dos o más conexiones independientes. La suite debe probar la restricción UNIQUE real, estados terminales, transacciones de status + pqr_events, grants/RLS y fallos entre aceptación simulada del proveedor y persistencia. No apuntar a producción.
