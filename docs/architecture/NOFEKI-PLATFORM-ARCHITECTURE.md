# NOFEKI Platform — arquitectura y plan de implementación

**Estado:** diseño técnico en revisión; no aplicar a producción.  
**Repositorio:** `nofeki-web/nofeki-web`  
**Base de partida:** rama `main`; esta especificación vive en una rama independiente.  
**Principio:** la identidad pertenece a NOFEKI; los datos y las operaciones pertenecen a cada producto; el acceso se valida en el servidor.

## 1. Objetivo y límites

Convertir `nofeki.com` en el portal principal de NOFEKI con autenticación universal, catálogo de productos y control de acceso por licencias. NOFEKI Gastos continúa funcionando y NOFEKI OPS se incorpora como producto independiente.

Esta fase no cambia el comportamiento de producción, no migra usuarios y no altera las tablas ni funciones actuales de Gastos.

## 2. Decisiones arquitectónicas

1. Reutilizar el proyecto Supabase existente como identidad inicial. No crear un segundo registro de usuarios ni duplicar `auth.users`.
2. La PK de `platform.profiles.user_id` será el mismo UUID de `auth.users.id`.
3. Mantener el cliente y el `storageKey` actual de Gastos (`nofeki-gastos-auth-v1`) durante la transición. No cambiar el flujo de recuperación ni sus rutas hasta contar con pruebas de regresión.
4. Crear un esquema PostgreSQL `platform` privado, no expuesto al Data API. El navegador no consultará directamente tablas internas de licencias o permisos.
5. Resolver la inicialización de perfiles mediante un flujo de bootstrap autenticado, idempotente y controlado por servidor. No añadir en esta fase un trigger nuevo a `auth.users`: se evita acoplar el alta de cuenta al portal y se preserva el trigger legal existente.
6. La licencia acredita derecho comercial; los roles y permisos determinan qué puede hacer el usuario. Son controles separados.
7. El contexto activo (personal u organización) es una selección de interfaz, nunca una prueba de autorización.
8. Gastos conserva sus tablas, RLS, Edge Functions, atajo iOS, recuperación y registro legal. El portal no debe conceder acceso a OPS por ocultar o mostrar botones: toda operación protegida vuelve a validar permisos en backend.
9. Billing se diseña para añadirse después. No se integra pasarela ni cobros en esta fase.

## 3. Modelo de datos propuesto

Todas las tablas siguientes pertenecen a `platform`, salvo que se indique lo contrario.

### Identidad y organizaciones

| Tabla | Propósito | Claves / reglas |
|---|---|---|
| `profiles` | Perfil universal mínimo | `user_id` PK y FK a `auth.users(id)`; nombre visible opcional; timestamps |
| `organizations` | Empresas/equipos | UUID PK; nombre; slug único; estado; creador |
| `organization_members` | Membresías | UUID PK; organization_id + user_id únicos; estado; fecha de alta |

Un usuario puede tener un perfil personal y pertenecer a cero o varias organizaciones. No se copian datos financieros de Gastos a organizaciones.

### Catálogo y planes

| Tabla | Propósito | Claves / reglas |
|---|---|---|
| `products` | Catálogo de aplicaciones | Código único estable: `gastos`, `ops`; estado |
| `product_modules` | Capacidades dentro de cada producto | Código único por producto; estado |
| `plans` | Planes comerciales | Producto; código; versión; estado |
| `plan_entitlements` | Derechos incluidos en un plan | Plan + módulo + límites/atributos; restricción única |

Los códigos de producto y módulo son identificadores estables; los nombres y textos visibles pueden cambiar sin romper autorizaciones.

### Licencias y asignaciones

| Tabla | Propósito | Claves / reglas |
|---|---|---|
| `licenses` | Derecho de uso adquirido/concedido | Referencia a plan; titular individual **o** organización; estado; inicio/fin; origen |
| `license_members` | Usuarios habilitados por licencia | Licencia + usuario únicos; estado; asignado por; fechas |

En `licenses`, exactamente uno de `owner_user_id` o `owner_organization_id` debe ser no nulo. Una licencia individual puede habilitar a su titular. Una licencia empresarial habilita miembros asignados hasta el límite contratado. Los cupos se reservan en una transacción para evitar sobreasignación concurrente.

Estados mínimos de licencia: `pending`, `active`, `suspended`, `expired`, `revoked`. El acceso solo se concede cuando la licencia está activa, dentro de vigencia y con una asignación válida.

### Autorización

| Tabla | Propósito | Claves / reglas |
|---|---|---|
| `roles` | Roles definidos por producto/contexto | Código estable; alcance personal u organizacional |
| `permissions` | Acciones atómicas | Código único; producto/módulo |
| `role_permissions` | Permisos de cada rol | PK compuesta role_id + permission_id |
| `organization_member_roles` | Roles de un miembro en una organización | Miembro + rol; contexto organizacional |

Los roles iniciales se definirán por producto. Para OPS se prevén, como mínimo, propietario/administrador, supervisor y operador, pero el catálogo final se validará con los flujos reales del producto. Gastos no necesita roles empresariales para su primera etapa: conserva el acceso personal actual.

### Auditoría

| Tabla | Propósito |
|---|---|
| `audit_events` | Eventos de seguridad y administración de plataforma |

Registrar actor, acción, recurso, contexto organizacional cuando aplique, resultado, fecha y metadatos no sensibles. No guardar contraseñas, tokens, secretos ni datos completos de tarjetas.

## 4. Reglas de integridad y autorización

- Todas las PK de plataforma serán UUID.
- FKs con `ON DELETE RESTRICT` para entidades comerciales/auditoría; no borrar en cascada historial de licencias ni auditoría.
- Las relaciones de membresía y asignación tendrán restricciones únicas e índices por claves de búsqueda.
- La base de datos será la autoridad para vigencia, estado y cupos; el frontend no calcula derechos.
- No usar `raw_user_meta_data` / `user_metadata` para roles, licencias ni permisos.
- No aceptar del navegador `user_id`, rol o licencia como autoridad: derivar identidad del JWT validado y consultar estado vigente.
- El esquema `platform` no se añadirá a los esquemas expuestos del Data API. Revocar acceso por defecto a `anon` y `authenticated`; no conceder permisos amplios.
- Las operaciones necesarias se expondrán mediante Edge Functions/RPCs acotadas, con validación de JWT y autorización en servidor.
- Cualquier función privilegiada debe vivir en esquema no expuesto, tener `search_path` fijado, validar actor y recurso, y conceder EXECUTE solo a los roles necesarios. Preferir SECURITY INVOKER; SECURITY DEFINER solo con justificación y revisión independiente.
- Si se usa una vista, exigir `security_invoker = true` o mantenerla no expuesta.
- La licencia empresarial no implica que todos los miembros tengan acceso: cada usuario debe estar asignado y tener rol vigente.
- Suspender/revocar una licencia debe bloquear operaciones protegidas en el backend, aunque exista una sesión autenticada.

## 5. Flujos

### Inicio de sesión y bootstrap

1. El usuario entra por el portal y autentica con el mismo Supabase Auth.
2. Se valida la sesión en servidor; no basta con leer datos del cliente.
3. Una operación de bootstrap idempotente asegura que exista `platform.profiles` para el UUID autenticado.
4. El portal consulta catálogo y derechos efectivos mediante endpoints del servidor.
5. El usuario ve Gastos si tiene acceso base gratuito y OPS únicamente si una licencia válida lo habilita.
6. Al abrir una app, el backend de esa app vuelve a verificar identidad, licencia, asignación, rol y permiso.

El bootstrap no modifica ni reemplaza el trigger legal actual. Los registros de aceptación legal continúan siendo responsabilidad del mecanismo existente.

### Recuperación de contraseña

Durante la transición se conservan las URLs y el flujo actual de recuperación de Gastos. El portal podrá compartir la misma ruta de recuperación solo después de probar PKCE, enlaces abiertos desde iOS Mail, enlaces vencidos y sesiones ya activas. No cambiar `storageKey` ni el modo de flujo en esta fase.

### Organización y licencias

1. Un usuario crea una organización o recibe invitación.
2. El servidor valida su permiso de administración.
3. Una licencia organizacional activa habilita cupos.
4. Un administrador asigna miembros dentro de los cupos disponibles.
5. Cada operación reserva/verifica cupo transaccionalmente y registra auditoría.
6. Al retirar a un miembro, se revoca su asignación sin borrar su historial ni su cuenta.

## 6. Integración gradual de productos

### NOFEKI Gastos

- Se mantiene `gastos.html` y sus endpoints actuales durante la primera etapa.
- El portal añade un acceso a Gastos; no mueve ni reescribe la aplicación.
- El acceso gratuito se representa como derecho del producto, pero la validación de Gastos seguirá respetando su modelo de usuario actual hasta una fase específica de integración.
- No tocar gastos, presupuestos, ingresos, categorías, perfiles financieros, autorizaciones del atajo ni tablas PQR en la migración inicial.

### NOFEKI OPS

- Se registra como producto y sus módulos en el catálogo.
- Se habilita solo con licencia válida.
- Su modelo de datos y sus políticas se mantienen separados de Gastos.
- Antes de conectar OPS, definir si comparte este proyecto Supabase o usa uno independiente. Si se separa, la identidad central emitirá credenciales/audiencias específicas y el proyecto OPS validará emisor, audiencia, firma y permisos; nunca compartir service-role keys ni sesiones internas.

### Billing futuro

La estructura admite órdenes, pagos, renovaciones, facturas y webhooks como una fase posterior. La pasarela será la fuente de confirmación de pago; el navegador nunca podrá activar una licencia por sí mismo.

## 7. Plan de trabajo por etapas

| Etapa | Trabajo | Salida / criterio de aceptación |
|---|---|---|
| 0 | Conciliar migraciones Git ↔ Supabase, revisar configuración CLI, backup y restauración | Historial consistente y restauración aislada demostrada |
| 1 | Crear staging independiente y pruebas de Auth | Staging sin datos reales sensibles; login y recuperación verificados |
| 2 | Implementar esquema privado y catálogo mínimo | Migraciones reproducibles; advisors sin hallazgos críticos |
| 3 | Implementar bootstrap, perfil, catálogo y autorización | Pruebas de usuario existente/nuevo, no autorizado y licencia vencida |
| 4 | Portal principal y navegación | Gastos sigue funcionando; OPS bloqueado sin licencia |
| 5 | Organizaciones, cupos, invitaciones y roles | Pruebas de concurrencia, aislamiento y revocación |
| 6 | Integración controlada de OPS | Pruebas de permisos y separación de datos |
| 7 | Billing | Solo tras definir proveedor, términos, impuestos y conciliación |

## 8. Pruebas obligatorias antes de producción

- Usuario existente de Gastos inicia sesión en el portal y conserva UUID, gastos e historial.
- Usuario nuevo se registra y el trigger legal existente sigue capturando aceptación.
- Recuperación desde escritorio y iPhone Mail funciona con enlaces válidos, vencidos y ya usados.
- Usuario sin licencia de OPS no puede acceder por URL directa ni invocar endpoints OPS.
- Usuario con licencia vencida, suspendida o revocada pierde acceso en backend.
- Usuario de organización A no puede leer ni modificar recursos de organización B.
- Miembro sin rol administrativo no puede invitar, asignar cupos ni modificar licencias.
- No se puede superar el número de cupos con solicitudes concurrentes.
- Revocar miembro/licencia no elimina gastos, historial ni auditoría.
- El atajo iOS registra y deja de registrar conforme a sus autorizaciones actuales.
- Las funciones PQR y el registro legal siguen operando.
- RLS, grants, SECURITY DEFINER, funciones y vistas pasan revisión.
- Prueba de restauración y procedimiento de rollback completados antes del despliegue.

## 9. Rollback

- La migración inicial es aditiva y no altera tablas actuales.
- No desplegar el portal como ruta principal hasta completar pruebas.
- Mantener `gastos.html` y sus rutas antiguas accesibles.
- Desactivar la navegación nueva mediante configuración reversible si falla el portal.
- No borrar tablas de plataforma ni historial en un rollback; deshabilitar el feature y conservar auditoría.
- Toda migración aplicada debe tener script de reversión revisado, salvo datos/auditoría que deban preservarse.
- No ejecutar rollback de producción sin identificar dependencias y obtener aprobación expresa.

## 10. Bloqueos antes de escribir/aplicar la migración

1. Confirmar el estado real de `supabase/migrations` en el repositorio y compararlo con `supabase_migrations.schema_migrations`. No reparar ni marcar migraciones como aplicadas hasta explicar cada diferencia.
2. Verificar el estado de backup, PITR si está disponible y restauración a un proyecto aislado.
3. Crear staging separado; el proyecto actual no tiene branches Supabase verificadas.
4. Confirmar CLI y configuración de Data API, esquemas expuestos y permisos.
5. Revisar las definiciones completas de policies, grants, triggers y funciones que interactuarán con el nuevo esquema.

**Regla de salida:** no aplicar DDL en producción, no cambiar Auth y no desplegar frontend hasta que todos los bloqueos anteriores estén resueltos y las pruebas en staging pasen.
