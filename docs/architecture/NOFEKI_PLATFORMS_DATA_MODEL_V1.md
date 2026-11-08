# NOFEKI Platforms — modelo de datos lógico v1

**Estado:** especificación de diseño. No es un esquema desplegado.  
**Rama:** `platforms/architecture-foundation-20261108`  
**Regla:** no ejecutar DDL ni copiar este documento a `supabase/migrations` sin revisión y aprobación.

## 1. Decisiones de diseño para avanzar sin bloquear el trabajo

| Tema | Default propuesto | Motivo / condición |
|---|---|---|
| Identidad | Un UUID de `auth.users` por persona | Reutiliza Auth actual; no duplica cuentas |
| Espacio personal | Uno por usuario en v1 | Reduce complejidad; permitir varios después sin romper el modelo |
| Organizaciones | Una persona puede pertenecer a muchas | Aísla clientes y empresas |
| Licenciamiento OPS | Por organización con cupos; asignación explícita a usuarios | Se adapta a B2B; la compra individual puede representarse como organización personal |
| Gastos | Entitlement gratuito personal por usuario | Preserva la promesa actual |
| OPS | Sin acceso por defecto | Requiere licencia/concesión activa y permiso |
| Invitados | No en v1 | Evita complejidad de identidad externa |
| Facturación | Sin proveedor seleccionado | Billing se modela neutral, sin integración |
| Datos de perfil | Mínimos y opcionales | No duplicar datos de Auth ni el perfil financiero de Gastos |
| Eliminación | Baja lógica/estado y retención definida | No borrar auditoría ni romper referencias |

Estas decisiones son defaults de diseño, no decisiones comerciales irreversibles. Deben confirmarse antes de DDL.

## 2. Dominios y relaciones

- `profiles`: extensión mínima de identidad; PK/FK a `auth.users.id`.
- `personal_workspaces`: espacio personal único por usuario en v1.
- `organizations`: entidad/cliente.
- `organization_memberships`: relación N:M entre usuarios y organizaciones, con rol y estado.
- `products`, `product_modules`: catálogo estable de productos y módulos.
- `permissions`, `roles`, `role_permissions`: catálogo de acciones y roles por producto/contexto.
- `licenses`: derecho comercial adquirido/concedido y sus límites.
- `license_assignments`: asignación de licencia a organización o usuario; no equivale a autorización.
- `entitlements`: concesión efectiva de producto/módulo/capacidad con vigencia, alcance y origen.
- `plans`, `plan_entitlements`: definición versionada de planes.
- `subscriptions`, `billing_events`: situación comercial y eventos verificados.
- `audit_events`: bitácora append-only de operaciones sensibles.

Relación conceptual:

```text
auth.users
  └── profiles
       ├── personal_workspaces
       └── organization_memberships ── organizations
                                      └── license_assignments ── licenses
products ── product_modules ── permissions
   └── roles ── role_permissions
plans ── plan_entitlements ── entitlements
subscriptions ── billing_events
Todos los cambios sensibles ── audit_events
```

## 3. Convenciones de claves y restricciones

- PKs internas: UUID generado por base de datos.
- Identificadores públicos de catálogo: claves textuales estables, por ejemplo `gastos`, `ops`, `inventory`.
- Timestamps: `timestamptz`, almacenados en UTC.
- Fechas de vigencia: intervalo semiabierto `[valid_from, valid_until)`; `valid_until IS NULL` significa sin vencimiento.
- Estados: valores controlados por CHECK o catálogo; no aceptar strings libres desde navegador.
- `subject_type + subject_id`: polimorfismo controlado en la capa de dominio; evitar FK polimórfica sin validación. Para la primera implementación, usar tablas de asignación separadas o validar existencia en función server-side.
- `organization_memberships`: unicidad por `(organization_id, user_id)`.
- `products.key`, `product_modules(product_id, key)`, `permissions.key`, `roles(product_id, key)`: únicos.
- `billing_events.provider_event_id`: único por proveedor para idempotencia.
- `entitlements`: no crear unicidad demasiado restrictiva; pueden coexistir fuentes y concesiones, y el resolvedor debe aplicar precedencia/revocación explícita.
- Índices en FK, estado, vigencia y claves de búsqueda.

## 4. Resolución de acceso (contrato)

Entrada: usuario autenticado derivado de la sesión validada, contexto personal/organización, producto, módulo opcional y permiso requerido.

Orden de decisión:
1. Rechazar si no hay usuario autenticado.
2. Validar que el contexto personal pertenece al usuario o que existe membresía activa en la organización indicada.
3. Buscar concesiones activas aplicables al sujeto y al producto/módulo/capacidad.
4. Validar vigencia y estado de licencia/entitlement.
5. Validar cupos y asignación cuando aplique.
6. Validar rol y permiso para ese contexto.
7. Registrar evento de auditoría para cambios sensibles; no es necesario registrar cada lectura de bajo riesgo.
8. Denegar por defecto ante ausencia, ambigüedad o error del resolvedor.

El cliente puede solicitar contexto, pero nunca definir su propia identidad, rol, permiso, estado de licencia ni entitlement.

## 5. Regla inicial por producto

- `gastos`: una concesión gratuita personal por cuenta existente y por nueva alta, creada de forma idempotente por proceso confiable.
- `ops`: sin concesión inicial; una compra/licencia genera asignación y entitlements.
- Módulos OPS se conceden individualmente por plan/licencia, por ejemplo inventario, compras, planeación y analítica. El catálogo final se definirá con el alcance real del producto.
- La concesión de OPS nunca debe alterar la concesión de Gastos, ni viceversa.

## 6. Borrado, privacidad y retención

- Perfil: baja lógica o anonimización según política legal; no cascada automática desde Auth.
- Organización: estado `archived`; conservar referencias y auditoría.
- Membresía: estado `revoked`, con actor y fecha.
- Licencia/entitlement: revocar o expirar; no borrar.
- Billing events y audit events: append-only, acceso restringido y retención definida legalmente.
- No copiar datos transaccionales de Gastos al esquema Platforms.
- No guardar secretos, contraseñas, tokens del Atajo ni datos de tarjetas.

## 7. Riesgos que requieren decisión antes de implementación

1. Si una organización puede tener múltiples sedes y si estas consumen cupos.
2. Si el propietario de organización puede autoasignarse licencias o requiere administrador NOFEKI.
3. Reglas de mora, periodo de gracia, suspensión y reactivación.
4. Política de retención/eliminación y exportación de datos.
5. Si OPS individual se representa con organización personal o con licencia directa de usuario.
6. Catálogo definitivo de módulos y permisos de OPS.

## 8. Criterios de aceptación de modelo

- Ninguna tabla nueva reemplaza tablas actuales de Gastos.
- No hay FK en cascada que borre auditoría o licencias.
- Toda autorización se puede resolver server-side sin confiar en metadata editable.
- Se puede revocar un entitlement sin borrar datos del producto.
- Un usuario puede pertenecer a varias organizaciones sin mezclar sus datos.
- Gastos gratuito se asigna idempotentemente a cuentas existentes.
- Un miembro no puede elevar su rol ni su licencia.
- Un evento duplicado de facturación no duplica concesiones.
