# NOFEKI Platforms — matriz inicial de acceso

**Estado:** propuesta funcional para revisión; no representa permisos ya desplegados.

## 1. Conceptos que no deben confundirse

| Concepto | Pregunta que responde | Ejemplo |
|---|---|---|
| Identidad | ¿Quién inició sesión? | UUID de Supabase Auth |
| Perfil | ¿Qué datos describen a la persona? | Nombre, preferencias |
| Membresía | ¿A qué organización pertenece? | Miembro de Empresa A |
| Rol | ¿Qué responsabilidades tiene en ese contexto? | Admin de inventarios |
| Producto | ¿Qué aplicación existe? | NOFEKI OPS |
| Módulo | ¿Qué área del producto existe? | Inventario, Compras |
| Licencia | ¿Qué derecho comercial fue asignado? | OPS Pro, 10 usuarios |
| Entitlement | ¿Qué capacidad concreta está habilitada? | Ver inventario |
| Permiso | ¿Qué acción puede ejecutar? | inventory.read |

## 2. Contextos

- **Personal:** el usuario actúa en su propio espacio. Gastos comienza aquí.
- **Organización:** el usuario actúa dentro de una organización mediante una membresía activa.
- El contexto activo debe ser explícito y validado en servidor; no basta con enviar un organization_id desde el navegador.

## 3. Roles organizacionales iniciales

| Rol | Gestión de miembros | Gestión de licencias | Uso de módulos |
|---|---:|---:|---:|
| owner | Sí | Sí | Según concesiones |
| admin | Según permiso | Según permiso | Según concesiones |
| billing_admin | No por defecto | Sí | No concede acceso funcional por sí solo |
| member | No | No | Según rol de producto y concesiones |

Los roles son plantillas de permisos, no una autorización universal. El owner tampoco debe obtener módulos que la organización no tenga licenciados.

## 4. Roles por producto

Los roles de producto se asignan por contexto (personal u organización) y producto. Ejemplos para validar:

- Gastos personal: owner de su propio espacio.
- OPS individual: owner de su espacio individual.
- OPS empresarial: ops_admin, inventory_manager, buyer, analyst, viewer.

La lista definitiva de roles de OPS se definirá al especificar sus módulos y flujos.

## 5. Concesiones (entitlements) propuestas

Una concesión describe un derecho concreto y su alcance:

- subject_type: user u organization.
- subject_id: UUID de usuario u organización.
- product_key y opcional module_key.
- capability/permission_key cuando se requiera granularidad.
- source_type: free, subscription, manual_grant, trial, promotion.
- status: active, suspended, revoked, expired.
- valid_from y valid_until.
- limits JSON validado por servidor (por ejemplo, seats o límites funcionales).

La licencia comercial y la concesión efectiva deben estar relacionadas, pero no ser la misma entidad. Un plan puede producir varias concesiones y una concesión debe poder auditar su origen.

## 6. Matriz de productos inicial

| Perfil/contexto | Gastos | OPS |
|---|---|---|
| Cuenta personal existente | Gratuito, sujeto a concesión migrada | Sin acceso salvo licencia |
| Usuario nuevo personal | Gratuito según política de alta | Sin acceso salvo licencia |
| Miembro de organización sin licencia OPS | Según su concesión personal | Sin acceso |
| Miembro de organización con licencia OPS | Según su concesión personal | Solo módulos licenciados y permisos de su rol |
| Billing admin | No cambia | Administra estado comercial; no obtiene automáticamente acceso operativo |

## 7. Casos de prueba obligatorios

1. Usuario autenticado sin concesión de OPS: denegado.
2. Usuario con Gastos gratuito: acceso a Gastos.
3. Usuario con OPS vencido: denegado en servidor.
4. Usuario revocado: denegado aunque la UI conserve estado anterior.
5. Miembro de organización A que consulta organización B: denegado.
6. Member que intenta cambiar su propio rol: denegado.
7. Billing admin que intenta usar módulo operativo sin rol/concesión: denegado.
8. Admin de una organización no puede conceder derechos superiores a los comprados.
9. Un evento duplicado de Billing no duplica licencias ni concesiones.
10. Revocar OPS no elimina datos del cliente ni afecta Gastos.

## 8. Decisiones abiertas antes del DDL

- ¿Una cuenta puede tener varios espacios personales o solo uno?
- ¿Las licencias OPS se comprarán por usuario, por organización, por sede o combinadas?
- ¿Se permitirán usuarios externos/invitados?
- ¿Qué límites por plan tendrá OPS (usuarios, almacenes, SKU, transacciones)?
- ¿Qué permisos podrá delegar un owner y cuáles serán exclusivos del soporte NOFEKI?
- ¿Cómo se manejarán cancelación, mora, periodo de gracia y reactivación?
