# Decisión funcional — respuesta formal y estado PQR

Fecha: 2026-11-08  
Estado: **APROBADA por el propietario del producto**  
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Decisión

Cuando el administrador registre una respuesta formal mediante la acción `respond`, la operación debe cambiar el estado del caso a **`Respondida`** dentro de la misma transacción que:

1. valida el estado actual y la versión esperada;
2. registra el evento `response_sent` con el texto de respuesta y el actor;
3. crea el evento Outbox `admin_response` vinculado al evento de respuesta;
4. incrementa la versión del caso y actualiza `responded_at` / `updated_at`;
5. registra la clave idempotente de la solicitud administrativa y su resultado.

La notificación se envía después por el worker. El resultado de entrega **no** determina el estado del caso.

## Semántica separada

- **Respondida:** respuesta formal guardada y registrada correctamente en la base.
- **Notificación enviada:** el proveedor confirmó la aceptación del correo; se registra en el evento/Outbox.
- **Cerrada:** el administrador finaliza el caso explícitamente después del seguimiento que corresponda.

Si el envío falla, el caso permanece `Respondida` y la notificación se reintenta; no se revierte la respuesta ni se devuelve el caso a `En gestión`.

## Reglas del panel

- La acción manual de estado no debe permitir establecer `Respondida`; esa transición solo ocurre a través de la RPC de respuesta formal.
- Una respuesta solo se puede crear desde `En gestión`, conforme a la política de transiciones aprobada.
- Un caso `Cerrada` no admite respuesta nueva en este primer diseño; reabrirlo requiere la transición explícita prevista por la política.
- El panel debe mostrar por separado estado del caso y estado de la notificación.
- Repetir la misma petición idempotente devuelve el resultado original y no crea un segundo evento/correo.
- La clave reutilizada con contenido distinto debe responder conflicto.

## Alcance de esta aprobación

Esta aprobación fija el comportamiento funcional y permite continuar el trabajo de integración en la rama de recuperación. **No autoriza** ejecutar SQL en producción, cambiar secretos, desplegar Edge Functions, alterar el panel en producción ni activar el scheduler.

## Referencia técnica

El RPC candidato `public.pqr_admin_create_response` ya implementa el cambio atómico a `Respondida` junto con evento y Outbox. La integración de `pqr-admin` debe invocarlo en lugar de enviar el correo directamente y hacer escrituras separadas.
