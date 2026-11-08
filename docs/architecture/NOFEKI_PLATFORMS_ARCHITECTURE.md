# NOFEKI Platforms — arquitectura objetivo
**Estado:** diseño técnico para revisión. **No desplegar.**  
**Rama:** `platforms/architecture-foundation-20261108`

## 1. Objetivo y principios

NOFEKI Platforms será la capa común de identidad, organizaciones, autorización y estado comercial para todos los productos NOFEKI. NO reemplaza ni reconstruye NOFEKI Gastos: lo incorpora progresivamente.

Principios no negociables:

1. **Continuidad de Gastos:** autenticación actual, sesiones, gastos, presupuestos, ingresos y autorización del Atajo deben seguir funcionando durante toda la transición.
2. **Identidad única:** el identificador canónico de persona es el UUID existente de `auth.users`. No crear usuarios duplicados ni pedir un segundo registro.
3. **Separación de dominios:** Identity, Organizations, Access y Billing tienen responsabilidades distintas y relaciones explícitas.
4. **Aditividad:** las primeras migraciones solo añaden objetos nuevos. No renombrar, eliminar ni alterar tablas/columnas/triggers actuales de Gastos.
5. **Denegar por defecto:** ningún producto o módulo se habilita por mera existencia de una cuenta. Se requiere una concesión de acceso vigente.
6. **Autorización en servidor:** la interfaz puede ocultar productos, pero cada API/Edge Function debe validar la autorización efectiva. Nunca confiar en flags enviados por el navegador.
7. **Trazabilidad:** cambios de rol, licencia, asignación y estado comercial deben poder auditarse.
8. **Reversibilidad:** despliegue por etapas, feature flags y rollback que no requiera borrar datos.
9. **Sin privilegios desde metadata editable:** no usar `user_metadata` para roles, licencias ni decisiones de autorización.
10. **No acoplar facturación a autorización:** Billing registra la situación comercial; Access materializa derechos efectivos a partir de concesiones verificadas.

## 2. Dominios

### Identity — quién es la persona
- Supabase Auth sigue siendo el proveedor de autenticación en esta primera etapa.
- `auth.users.id` es la identidad canónica.
- Perfil de plataforma separado de los datos propios de cada producto.
- No almacenar contraseñas ni duplicar credenciales.
- El perfil de plataforma puede completarse de forma progresiva para usuarios existentes.

### Organizations — a qué entidad pertenece y qué rol cumple
- Una persona puede pertenecer a varias organizaciones.
- Una organización puede tener varios miembros.
- La relación usuario-organización se representa mediante membresías con estado y rol organizacional.
- Los roles organizacionales (owner, admin, member, billing_admin) no conceden por sí solos acceso a todos los productos.
- Los datos empresariales de cada producto permanecen en el dominio de ese producto.

### Access — qué puede utilizar
- Catálogo de productos y módulos.
- Roles y permisos por producto/módulo.
- Concesiones de acceso (entitlements) a nivel personal u organizacional.
- Asignación de licencias a usuarios o a organizaciones.
- Estado, vigencia, límites y origen de cada concesión.
- Regla de decisión: identidad válida + contexto (personal/organización) + concesión vigente + permiso requerido.
- La revocación de una licencia debe afectar el acceso al producto, no borrar datos.

### Billing — qué se compró y cuál es su estado comercial
- Catálogo de planes y precios/versiones.
- Suscripciones/órdenes y registros de pago del proveedor.
- Estado comercial: trial, active, past_due, suspended, canceled, expired, complimentary.
- Facturación no concede acceso directamente desde el cliente. Un proceso confiable traduce un evento comercial verificado en una concesión de Access.
- Mantener el diseño independiente del proveedor de pagos elegido.

## 3. Productos iniciales

| Producto | Modalidad inicial | Alcance |
|---|---|---|
| NOFEKI Gastos | Gratuito | Personal; acceso básico para cuentas actuales |
| NOFEKI OPS | Pago/licenciable | Individual y empresarial; módulos habilitados según licencia |
| Futuros productos | Según definición | Se incorporan al catálogo y al motor común |

El acceso gratuito de Gastos debe quedar explícitamente representado como una concesión de producto, no inferido de que el usuario exista. En la primera transición se asignará a las cuentas actuales de forma idempotente, sin tocar sus datos funcionales.

## 4. Modelo lógico propuesto

Esquema lógico previsto: `platform`. Debe mantenerse fuera de los esquemas expuestos por la Data API, salvo decisión documentada posterior. El acceso de aplicaciones se hará mediante funciones de servidor controladas. RLS y privilegios mínimos se aplicarán como defensa en profundidad.

Entidades previstas (nombres sujetos a revisión antes de crear migraciones):

- Identity: `profiles`
- Organizations: `organizations`, `organization_memberships`
- Catálogo: `products`, `product_modules`
- Autorización: `roles`, `permissions`, `role_permissions`, `licenses`, `license_assignments`, `entitlements`
- Billing: `plans`, `plan_entitlements`, `subscriptions`, `billing_events`
- Auditoría: `audit_events`

Las claves foráneas de perfiles y asignaciones personales apuntarán a `auth.users(id)` con política de borrado restrictiva o cuidadosamente definida. No se deben borrar usuarios de Auth en cascada junto con información comercial o auditoría.

## 5. Modelo de decisión de acceso

Una autorización debe contestar al menos:

- ¿Quién es el usuario autenticado?
- ¿En qué contexto opera: personal u organización?
- ¿Qué producto y módulo solicita?
- ¿Qué licencia/concesión habilita ese acceso?
- ¿Está vigente y no revocada?
- ¿Qué permiso concreto requiere la operación?
- ¿El usuario tiene el rol correspondiente en ese contexto?

La resolución debe ejecutarse en servidor. La consulta de autorización debe considerar fechas de vigencia, estado, alcance personal/organizacional y revocación. No confiar en claims obsoletos del JWT para licencias que pueden cambiar inmediatamente.

## 6. Estrategia de convivencia con NOFEKI Gastos

1. Mantener el login actual y `auth.users`.
2. Añadir perfil de Platforms sin reemplazar tablas de perfil existentes, si las hay.
3. Añadir una concesión gratuita para Gastos por usuario existente, con operación idempotente.
4. Mantener los módulos y endpoints actuales de Gastos operando sin depender inicialmente de Platforms.
5. Integrar una lectura de autorización en un punto controlado solo después de pruebas en entorno aislado y con fallback/feature flag.
6. Migrar rutas y navegación gradualmente; nunca bloquear el dashboard actual por indisponibilidad del nuevo portal.
7. Mantener sin cambios las tablas y funciones de Atajo, incluyendo token hash, expiración, idempotencia y revocación.
8. Deshabilitar la integración de Platforms mediante feature flag si se detecta regresión.

## 7. Seguridad

- Esquema privado/no expuesto; no conceder acceso general a `anon` ni `authenticated` por defecto.
- RLS habilitado en todas las tablas nuevas como defensa en profundidad.
- Privilegios mínimos por tabla y función.
- Las funciones privilegiadas deben tener `search_path` fijo, validar identidad/contexto y exponer solo operaciones necesarias.
- Evitar `SECURITY DEFINER` salvo justificación explícita, revisión de privilegios y pruebas.
- Nunca usar `user_metadata` como fuente de autorización.
- No colocar secretos de proveedor ni service-role keys en frontend.
- Webhooks de Billing: verificar firma, idempotencia, timestamp y estado del evento antes de modificar concesiones.
- Auditoría append-only para cambios sensibles; limitar acceso a sus registros.
- Pruebas negativas: usuario A no accede a organización B; miembro no administra licencias sin permiso; usuario no puede concederse licencias; acceso vencido/revocado falla.

## 8. Fases de implementación

A. Diseño y revisión del modelo (actual).  
B. Inventario de autenticación y dependencias reales de Gastos.  
C. DDL aditivo en entorno aislado, no en producción.  
D. Seed de catálogo y concesiones gratuitas de prueba.  
E. Pruebas RLS, permisos, expiración, revocación y aislamiento multi-organización.  
F. Integración opt-in de Gastos con feature flag.  
G. Portal Platforms y administración.  
H. Integración de OPS.  
I. Billing real y automatización de licencias, cuando se elija proveedor y modelo comercial.

## 9. Criterios de aceptación antes de producción

- Login actual y sesiones de Gastos pasan regresión.
- Atajo registra, sincroniza, evita duplicados y respeta revocación.
- Presupuesto e ingresos siguen operando.
- Usuarios existentes conservan el mismo UUID y datos.
- Un usuario personal ve Gastos y no obtiene OPS sin concesión.
- Una licencia de OPS individual no concede acceso a otra organización.
- Un usuario de una organización solo accede a módulos concedidos y permitidos por su rol.
- Expiración/revocación bloquea nuevas operaciones de forma server-side.
- No existen grants públicos accidentales ni políticas RLS permisivas.
- Plan de rollback probado.
- Aprobación explícita antes de cualquier despliegue.

## 10. Límites de este artefacto

Este documento es una especificación. No crea tablas, no modifica Supabase, no cambia el frontend y no habilita productos. El SQL de diseño, si se prepara, debe quedar fuera de `supabase/migrations` hasta ser revisado y probado en un entorno aislado.
