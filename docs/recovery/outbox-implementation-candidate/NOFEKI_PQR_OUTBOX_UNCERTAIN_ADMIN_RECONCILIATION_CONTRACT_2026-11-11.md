# NOFEKI PQR — contrato de conciliación administrativa de Outbox uncertain

Fecha: 2026-11-11  
Rama: `recovery/pqr-admin-retry-fix-20261108`  
Estado: diseño + SQL candidato estático; NO ejecutado.

## Objetivo
Resolver eventos `private.pqr_outbox` en estado `uncertain` sin reenvío automático y con auditoría inmutable de quién tomó la decisión, por qué y qué cambió.

## Acciones permitidas

### 1. `confirm_delivered`
Usar únicamente cuando una consulta independiente al proveedor confirme que el correo fue aceptado. Requiere `provider_message_id`. Cambia el evento a `delivered`, conserva `event_key`, guarda el ID del proveedor y actualiza `pqr_events.email_status='sent'` cuando corresponde. No hace llamada de red ni envía correo.

### 2. `authorize_retry`
Usar únicamente cuando exista evidencia positiva de que el proveedor NO aceptó el correo. La razón debe incluir la fuente y referencia verificable de esa comprobación. Cambia a `pending`, rota `event_key` usando el `action_id`, reinicia el contador operativo y limpia `first_provider_attempt_at` para una nueva ventana. No enviar directamente desde la acción administrativa: el worker normal procesa el evento posteriormente.

**Prohibición:** no autorizar reintento basándose solo en que no llegó confirmación al navegador, no aparece en la bandeja de entrada o no se encuentra inmediatamente en el panel del proveedor. Ausencia de evidencia no equivale a evidencia de no aceptación. Si el resultado sigue ambiguo, mantener `uncertain`.

## Seguridad y trazabilidad
- La Edge Function `pqr-admin` debe validar sesión con `auth.getUser` y allowlist vigente antes de llamar la RPC con service_role.
- La RPC no confía en el navegador; actor y motivo deben venir de la función backend autenticada.
- `action_id` UUID estable por acción; repetición idéntica devuelve resultado guardado, reutilización con parámetros distintos se rechaza.
- Bloqueo `FOR UPDATE` sobre la fila Outbox evita dos conciliaciones concurrentes.
- La tabla privada `pqr_outbox_reconciliation_audit` guarda estado anterior/nuevo, clave anterior/nueva, actor, motivo, ID proveedor y fecha.
- La RPC solo acepta filas en estado `uncertain`; no permite conciliar `pending`, `processing`, `dead` o `delivered`.
- No se exponen tablas ni RPC a `anon`/ `authenticated`; ejecución solo `service_role`.

## Integración UI pendiente
En el panel administrativo, una fila uncertain debe mostrar:
- tipo de notificación, radicado, fecha, intento, antigüedad de primera llamada y código de error saneado;
- estado claramente marcado como “Resultado por verificar — no reenviar”;
- acción “Confirmar entrega” que solicita ID del proveedor y motivo;
- acción “Autorizar reintento” que solicita motivo y evidencia verificable de no aceptación, con confirmación explícita;
- historial de conciliaciones, solo lectura.

No mostrar contenido completo del PQR ni dirección de correo innecesariamente en la cola operativa. No añadir botón genérico “Reintentar”.

## Pruebas obligatorias
1. Confirmar entrega con ID válido actualiza Outbox y evento relacionado en una transacción.
2. Confirmar entrega sin ID falla sin mutación.
3. Reintentar con motivo corto o vacío falla sin mutación.
4. Reintentar rota la clave y reinicia primera marca; solo una vez.
5. Mismo action_id y mismos parámetros devuelve resultado previo.
6. Mismo action_id con parámetros distintos se rechaza.
7. Dos administradores concurrentes: solo una transición gana.
8. Fila no uncertain: no mutación.
9. anon/authenticated no pueden ejecutar RPC ni leer auditoría.
10. Usuario autenticado no incluido en allowlist no alcanza la RPC desde pqr-admin.
11. La operación no realiza llamadas HTTP ni envía correos.
12. Worker posterior usa la nueva clave y respeta la nueva ventana de 23 h.

## Hallazgos y bloqueos antes de integración
- Este SQL depende de la tabla y RPC Outbox base; no se debe ejecutar por separado en una base sin ese esquema.
- El archivo base actual presenta un defecto estático que debe corregirse antes de compilar: en `pqr_outbox_mark_provider_attempt`, el cuerpo PL/pgSQL aparece delimitado como `as $` / `$;` en vez de `as $$` / `$$;`. No se ha ejecutado SQL.
- La función candidata usa `service_role` como frontera técnica; es imprescindible revisar el handler `pqr-admin` y garantizar que solo llame tras validar usuario y allowlist. La RPC no reemplaza esa autorización.
- La rotación de `event_key` es deliberada y solo segura después de confirmar no aceptación. Nunca utilizar para “probar suerte”.
- Compilar y probar en PostgreSQL 17 aislado con constraints/roles reales. La autorización de crear la rama Supabase de pruebas con coste horario sigue pendiente.
- No integrar en `supabase/functions`, no configurar cron, no desplegar, no ejecutar SQL en producción.

## Estado
Candidato escrito y revisión estática pendiente. No se han enviado correos ni modificado Supabase.
