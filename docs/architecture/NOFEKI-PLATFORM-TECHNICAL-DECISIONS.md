# NOFEKI Platform — decisiones técnicas y plan de implementación

**Estado:** propuesta técnica para aprobación; no autoriza implementación ni despliegue.  
**Fecha de revisión:** 2026-11-07  
**Repositorio:** `nofeki-web/nofeki-web`  
**Rama:** `architecture/nofeki-platform-foundation`

## 1. Decisión ejecutiva

Se recomienda convertir `nofeki.com` en el punto de entrada de una plataforma con una identidad única y dos productos independientes:

- **NOFEKI Gastos:** producto gratuito, personal, que continúa operando sobre sus tablas, políticas RLS, Edge Functions y atajo iOS actuales.
- **NOFEKI OPS:** producto de pago, con licencias/suscripciones y permisos por módulo, con sus propios datos y reglas de acceso.
- **NOFEKI Platform:** portal, catálogo, identidad, organizaciones y autorización común.

La primera implementación debe ser **aditiva y en el mismo proyecto Supabase existente**. No se crea otro sistema de usuarios, no se trasladan gastos y no se cambia el flujo de autenticación actual de Gastos. OPS comienza en un esquema separado del de Gastos; una separación a otro proyecto Supabase queda como decisión futura, solo si la escala o los requisitos empresariales la justifican.

Esta propuesta no cambia producción. Requiere aprobación del diseño y superar los bloqueos de recuperación, migraciones y staging descritos más adelante antes de cualquier DDL.

## 2. Hechos del sistema actual que condicionan el diseño

La revisión de `main` y de la rama de arquitectura confirma:

1. El sitio público actual está en `index.html`; hoy presenta NOFEKI y enlaza directamente a `/gastos.html`. No es todavía un portal autenticado.
2. La aplicación operativa de Gastos está en `gastos.html`.
3. Gastos usa el proyecto Supabase actual y el cliente Auth persiste en `localStorage` con:
   - `storageKey: nofeki-gastos-auth-v1`
   - `persistSession: true`
   - `autoRefreshToken: true`
   - `detectSessionInUrl: true`
   - `flowType: pkce`
4. El restablecimiento de contraseña usa un cliente separado con `storageKey: nofeki-gastos-recovery-auth-v1`, flujo `implicit` y redirección a `/gastos.html?mode=recovery`. El script inicial de `index.html` también redirige a Gastos los enlaces cuyo hash indique `type=recovery`.
5. El registro de Gastos exige Turnstile y las aceptaciones legales. Envía `nofeki_terms_version`, `nofeki_terms_accepted_at`, `nofeki_privacy_version` y `nofeki_privacy_authorized_at` (versión 1.2 en el código revisado). El trigger existente captura esos datos en `legal_acceptance_audit`.
6. Las tablas actuales de Gastos, presupuesto, ingresos, perfiles financieros, categorías, autorizaciones del atajo y PQR tienen sus propias políticas/funciones. El atajo iOS usa autorizaciones revocables independientes de la sesión web.
7. El proyecto remoto todavía no tiene esquema `platform` ni tablas de plataforma. No se creó ningún objeto en esta revisión.
8. La historia de migraciones de producción y los archivos SQL del repositorio siguen sin reconciliarse completamente. No hay restauración aislada verificada ni staging aprobado.

Estos hechos hacen que cambiar el `storageKey`, mover el formulario de recuperación o reescribir el registro de Gastos sea innecesariamente riesgoso.

## 3. Arquitectura objetivo

### 3.1 Capas

| Capa | Responsabilidad |
|---|---|
| Sitio público | Marca, información, precios y acceso al portal |
| NOFEKI Platform | Portal autenticado, catálogo, selector de producto/contexto |
| NOFEKI Identity | Supabase Auth existente y perfiles mínimos |
| NOFEKI Access | Planes, licencias, módulos, roles y permisos |
| NOFEKI Billing | Suscripciones, eventos del proveedor y conciliación (fase posterior) |
| NOFEKI Gastos | Aplicación personal actual, sin reescritura inicial |
| NOFEKI OPS | Aplicación empresarial y datos separados |

### 3.2 Dominio y rutas

- Mantener `https://nofeki.com/` como página pública/landing durante la primera entrega.
- Crear el portal autenticado en el mismo origen, inicialmente como `/plataforma.html` (sin introducir subdominios ni una reescritura de rutas de Vercel).
- El catálogo puede ser público; abrir un producto protegido lleva al inicio de sesión o al portal.
- Mantener `/gastos.html` como ruta directa, estable y funcional durante toda la transición.
- Tras una etapa estable, se puede añadir una ruta amigable `/app` como alias de `/plataforma.html`. No sustituir la landing pública como primer cambio.

La elección de mismo origen evita una migración de cookies/almacenamiento entre subdominios y permite compatibilidad con la sesión de Gastos.

### 3.3 Identidad universal

**Decisión:** reutilizar el mismo proyecto Supabase Auth y el mismo `auth.users.id` para todos los productos.

- No duplicar cuentas ni contraseñas.
- No importar ni recrear usuarios en otro proveedor.
- No cambiar el UUID de ningún usuario.
- No hacer cierre de sesión masivo.
- El portal y Gastos usarán el mismo `storageKey` de sesión (`nofeki-gastos-auth-v1`) y la misma configuración compatible de Supabase JS durante la transición.
- El portal debe validar la identidad con `auth.getUser()`/validación JWT en servidor; `getSession()` en el navegador sirve para recuperar estado de interfaz, no para autorizar operaciones de servidor.
- No almacenar roles, licencias o permisos en `user_metadata` ni aceptar esos valores del navegador.
- El perfil de plataforma se crea bajo demanda mediante bootstrap idempotente, usando el UUID del JWT. No se exige un backfill masivo de todos los usuarios para lanzar el portal.
- El trigger de aceptación legal existente en `auth.users` se conserva. No añadir un segundo trigger de alta de usuario.

**Registro de usuarios nuevos:** el formulario universal debe conservar Turnstile, los textos/checkboxes legales y los metadatos de consentimiento que espera el trigger actual. Hasta que ese flujo sea probado, el portal puede dirigir el registro a la pantalla de creación de cuenta de Gastos; no se debe introducir un segundo formulario que omita la aceptación legal.

**Recuperación de contraseña:** conservar inicialmente la ruta y cliente de recuperación actuales. No cambiar el flujo implicit, PKCE, storage key, enlaces de correo ni redirección hasta probar recuperación en escritorio, iOS Mail, enlaces vencidos y enlaces ya consumidos. La contraseña pertenece a la identidad universal; no hay recuperación por producto.

### 3.4 Sesión y coexistencia con Gastos

En el mismo navegador y origen, el portal reconocerá la sesión existente porque lee la misma clave local de Supabase. En otro dispositivo el usuario inicia sesión normalmente una sola vez; no se copian tokens de un dispositivo a otro.

En la primera etapa:
- No refactorizar el cliente de Gastos.
- No cambiar `storageKey`.
- No cambiar rutas ni callback de recuperación.
- No modificar el flujo de registro/consentimiento.
- No tocar el atajo iOS ni sus tokens.
- Probar portal y Gastos abiertos en pestañas distintas, refresh simultáneo, expiración/refresco de token y cierre de sesión explícito.

Una extracción futura de un cliente Auth compartido solo se hará después de pruebas de regresión; no es requisito para el primer portal.

## 4. Modelo de productos, planes y acceso

### 4.1 Catálogo

Los códigos son identificadores estables, no etiquetas visuales:

- Productos: `gastos`, `ops`.
- Módulos iniciales de OPS (propuesta): `inventario`, `movimientos`, `compras`, `analisis`, `configuracion`, `usuarios`.
- Los nombres y descripciones visibles pueden cambiar sin alterar los códigos.

Cada producto tiene estado, ruta y política de acceso. Cada plan es una versión inmutable de un conjunto de derechos. Un cambio de módulos o límites genera una nueva versión del plan; no se reescriben derechos históricos de licencias activas.

### 4.2 Gastos gratuito

- Gastos se presenta como disponible para toda cuenta autenticada.
- El catálogo define un plan gratuito predeterminado `gastos_free` con sus módulos base.
- No se requiere crear una fila de licencia individual para cada usuario existente. El acceso gratuito se deriva del plan predeterminado del producto.
- En el primer lanzamiento, la autorización efectiva de Gastos sigue siendo la actual: autenticación + RLS por `auth.uid()`. No introducir una consulta a licencias en cada operación de Gastos.
- Si en el futuro Gastos incorpora niveles o límites, se agregan gradualmente sin bloquear los registros actuales.

### 4.3 OPS de pago

- OPS no tiene plan predeterminado gratuito de producción. Se puede mostrar una demo o lista de espera, pero no conceder acceso a datos reales sin entitlement.
- Un plan define módulos y límites (por ejemplo usuarios/cupos, ubicaciones, registros o capacidades), no roles de personas.
- Una licencia activa otorga el derecho comercial; una asignación y un rol determinan quién puede ejercerlo y qué acciones puede realizar.
- La licencia puede pertenecer a una persona o a una organización, nunca a ambas simultáneamente.
- Cada usuario de una licencia empresarial debe tener membresía y asignación activa. La licencia de la empresa no convierte automáticamente a todos sus miembros en administradores.
- La revocación/suspensión debe bloquear en backend nuevas operaciones protegidas. Ocultar botones no es autorización.

### 4.4 Modelo de datos recomendado

Mantener datos de control en esquemas privados y exponer solo operaciones acotadas.

**Esquema privado `platform`:**

| Tabla | Campos/reglas esenciales |
|---|---|
| `profiles` | `user_id` PK/FK a `auth.users.id`; nombre visible opcional; timestamps |
| `organizations` | id, nombre, slug único, estado, creador |
| `organization_members` | organization_id + user_id únicos; estado; joined_at |
| `products` | code único, nombre, estado, ruta, default_plan_id opcional |
| `product_modules` | product_id + code únicos; estado |
| `plans` | product_id, code, version, estado; combinación code/version única |
| `plan_entitlements` | plan_id + module_id únicos; límites/atributos declarativos |
| `licenses` | plan_id, titular usuario XOR organización, estado, vigencia, origen |
| `license_members` | license_id + user_id únicos; estado y asignador |
| `roles` | producto, alcance personal/organizacional, código estable |
| `permissions` | producto, módulo, acción/código estable |
| `role_permissions` | role_id + permission_id únicos |
| `user_product_roles` | roles personales de producto cuando se necesiten |
| `organization_member_roles` | roles de miembro dentro de una organización |
| `audit_events` | actor, acción, recurso, contexto, resultado y fecha; sin secretos |

**Esquema expuesto `platform_api`:** solo funciones/RPCs deliberadas, nunca tablas de licencias, membresías o permisos. La exposición de este esquema se configura expresamente en Supabase Data API. Funciones con `search_path` fijo/vacío, referencias cualificadas, validación del usuario autenticado y EXECUTE concedido solo a los roles necesarios.

Funciones candidatas:
- `bootstrap_me()`: crea el perfil si falta y devuelve datos mínimos del usuario actual.
- `get_my_catalog()`: devuelve catálogo y acceso efectivo del usuario actual.
- `get_my_product_access(product_code)`: devuelve derechos efectivos propios, no datos de otros usuarios.
- Operaciones administrativas/invitaciones/licencias: solo a través de endpoints backend con permisos administrativos verificados.

No crear una función genérica que permita al cliente consultar permisos de cualquier `user_id`.

**Esquema `ops`:** tablas de negocio de OPS, con aislamiento por organización y RLS. Se expone solo si los flujos necesitan acceso directo vía PostgREST; de lo contrario, se mantiene privado y se accede por Edge Functions. La decisión se toma al diseñar el primer módulo OPS. Nunca mezclar sus tablas con las de Gastos.

**Esquema `billing` (fase posterior):** clientes del proveedor, suscripciones, eventos de webhook idempotentes y registros de conciliación. No es requisito para lanzar el portal ni para emitir las primeras licencias manuales de prueba.

### 4.5 Evaluación de autorización

Para cada operación protegida de OPS el backend debe comprobar, en este orden:

1. JWT válido y usuario activo.
2. Producto y módulo activos.
3. Plan/licencia con vigencia y estado que permitan acceso.
4. Si es empresarial, membresía y asignación del usuario a esa licencia.
5. Rol vigente en el contexto solicitado.
6. Permiso atómico para la acción y recurso concreto.
7. RLS/propiedad del recurso y pertenencia a la organización.

El contexto personal/organizacional seleccionado en la interfaz es solo contexto; nunca una prueba de autorización. El backend deriva el usuario del JWT y no confía en `user_id`, rol, licencia ni organización enviados por el navegador.

## 5. Suscripciones y cobros

**Decisión:** separar suscripción, licencia y permisos.

- **Suscripción:** estado comercial y de cobro que informa el proveedor.
- **Licencia:** derecho de uso resultante (puede originarse en una suscripción, una concesión manual o una promoción).
- **Entitlements:** módulos y límites que incluye el plan.
- **Roles/permisos:** acciones que puede ejecutar cada miembro.

Flujo futuro:

1. El usuario/empresa selecciona un plan.
2. El backend crea la sesión de checkout en el proveedor; nunca desde el navegador con privilegios.
3. El proveedor envía webhook firmado.
4. El backend verifica firma, fecha y evento; guarda un identificador de evento único para idempotencia.
5. La transacción actualiza suscripción y licencia; registra auditoría.
6. El portal consulta derechos efectivos desde NOFEKI, no desde parámetros de retorno de checkout.
7. Renovación, cancelación, mora y reembolso actualizan la licencia según reglas explícitas.

Estados propuestos de suscripción: `incomplete`, `trialing`, `active`, `past_due`, `paused`, `canceled`, `unpaid`, `expired`. La política de gracia para `past_due`, reembolsos y cancelación al final del periodo se debe decidir antes de activar cobros. No asumir que un retorno exitoso del navegador equivale a pago confirmado.

No seleccionar todavía proveedor, precio, periodicidad ni impuestos. Esa decisión requiere comparar disponibilidad en Colombia, medios de pago, comisiones, facturación, webhooks y obligaciones tributarias. Hasta entonces, OPS puede usar licencias de prueba/manuales controladas por administración y auditadas, sin checkout productivo.

## 6. Proyecto Supabase para OPS

**Recomendación inicial:** mismo proyecto Supabase, con esquema de negocio `ops` separado y controles propios. Ventajas: misma identidad, menos complejidad de SSO, menos infraestructura y menor coste operativo inicial.

No significa compartir datos: OPS no consulta tablas de Gastos; Gastos no consulta OPS. Cada esquema tiene RLS, grants, funciones y pruebas propias.

Reevaluar proyecto independiente si aparecen requisitos de aislamiento contractual, residencia de datos, carga, disponibilidad o clientes empresariales dedicados. Si se separa, no compartir service-role keys ni asumir que un access token del proyecto actual será aceptado automáticamente por otro proyecto. Se necesitará federación de identidad/OIDC o validación de JWT de tercero configurada y probada, con issuer, firma, expiración y audience específicos.

## 7. Migración de usuarios actuales de Gastos: sin migración de cuentas ni datos

La migración debe ser de **experiencia de entrada**, no de base de datos de usuarios.

### Lo que se conserva

- Todos los registros de `auth.users` y sus UUID.
- Correos, contraseñas (hashes administrados por Supabase), confirmaciones y estado de cuenta.
- Gastos, presupuestos, categorías, ingresos, perfiles financieros y auditoría legal.
- Autorizaciones del atajo, tokens hasheados, fechas de expiración y revocación.
- Flujo PQR y archivos adjuntos.
- Rutas y comportamiento actual de `gastos.html`.

### Procedimiento

1. Desplegar primero un portal de prueba en una ruta nueva del mismo origen; no reemplazar Gastos.
2. Configurar el cliente del portal con el mismo proyecto, publishable key y `storageKey` de Gastos.
3. Usuario con sesión vigente en el mismo navegador entra al portal sin crear otra cuenta; se valida el usuario con Supabase Auth.
4. Si el usuario no tiene sesión vigente, inicia sesión con el mismo correo y contraseña actuales.
5. Ejecutar `bootstrap_me()` de forma idempotente para crear solo el perfil mínimo de plataforma si no existe. No se importan ni duplican filas de Gastos.
6. Mostrar Gastos como producto gratuito y abrir `/gastos.html`. La app sigue validando con su backend/RLS actual.
7. Mostrar OPS bloqueado o como “planes / solicitar acceso” hasta que exista licencia activa.
8. Hacer piloto con cuentas existentes y nuevas; comprobar que sesión, datos y atajo continúan intactos.
9. Solo tras superar regresión, añadir la navegación al portal desde la landing.

### Casos especiales

- **Sesión abierta en Gastos:** el portal debe reconocerla con la misma clave de almacenamiento.
- **Otro navegador/dispositivo:** inicio de sesión normal; no transferir tokens.
- **Enlace de recuperación:** conserva la redirección actual a Gastos hasta que el flujo universal sea probado; no cambiar callback en el primer despliegue.
- **Registro nuevo:** mismo Turnstile y consentimiento legal que hoy; no crear cuentas sin los metadatos que espera el trigger legal.
- **Atajo iOS:** no necesita ser re-enlazado por el portal; su token es una autorización independiente.
- **Cuenta con correo no confirmado o suspendida:** respetar el estado de Supabase Auth; el portal no lo debe saltar.
- **Rollback:** retirar el enlace/portal o deshabilitar su ruta. `/gastos.html` sigue siendo accesible y la sesión/datos no se revierten porque nunca se migraron.

## 8. Orden de implementación propuesto

| Fase | Entregable | Criterio para avanzar |
|---|---|---|
| 0. Recuperación | Historial de migraciones reconciliado; dump completo; backup y restore drill | Esquema reproducible en entorno aislado |
| 1. Staging y regresión base | Proyecto/entorno aislado con datos sintéticos; pruebas actuales de Gastos | Login, recuperación, gastos, presupuesto, ingresos, atajo, PQR pasan |
| 2. Fundación de plataforma | Migraciones aditivas para `platform` y `platform_api`; catálogo/planes/permisos mínimos | RLS, grants, funciones y advisors revisados; sin cambios a tablas existentes |
| 3. Identidad/portal | Bootstrap, catálogo, login universal y ruta `/plataforma.html` | Usuario existente reutiliza sesión; usuario nuevo conserva consentimiento |
| 4. Integración Gastos | Tarjeta/acceso gratuito a `/gastos.html`; pruebas cross-tab y recovery | Gastos no requiere cambios de datos ni nuevo entitlement por operación |
| 5. OPS sin cobros | Primer módulo OPS en esquema separado; licencias de prueba y roles | Acceso directo, revocación, límites y aislamiento probados |
| 6. Organizaciones | Invitaciones, membresías, roles y cupos | Concurrencia y aislamiento entre organizaciones pasan |
| 7. Billing | Proveedor, checkout, webhooks, conciliación, impuestos y políticas de mora/cancelación | Pruebas de webhook duplicado, inválido, tardío y reembolso |
| 8. Lanzamiento gradual | Piloto, métricas, rollback y comunicación | Sin regresiones críticas; despliegue por etapas |

No se debe saltar la fase 0 por querer adelantar el portal. La base actual de migraciones no es todavía reconstruible desde el repositorio.

## 9. Pruebas de aceptación obligatorias

### Identidad y continuidad
- Usuario existente conserva el mismo UUID y puede iniciar sesión con su contraseña actual.
- La sesión existente se reconoce entre `/gastos.html` y `/plataforma.html` en el mismo navegador.
- No hay logout masivo, duplicación de usuarios ni cambios de contraseña.
- Recuperación desde escritorio e iOS Mail funciona para enlaces nuevos, vencidos y usados.
- Registro nuevo conserva Turnstile y el registro de aceptación legal.

### Gastos
- Lectura y escritura de gastos del usuario.
- Presupuestos, categorías, ingresos y perfiles financieros.
- Vinculación, registro y revocación del atajo.
- PQR y acceso a adjuntos.
- Ninguna consulta de Gastos depende del esquema `platform`.

### OPS y acceso
- Sin licencia no hay acceso por URL directa ni por API.
- Licencia vencida, suspendida o revocada bloquea backend.
- Miembro de organización A no accede a datos de B.
- Rol operador no ejecuta acciones administrativas.
- Cupos no pueden sobreasignarse con operaciones concurrentes.
- Los límites del plan se verifican en backend.

### Operación
- Restauración aislada demostrada.
- Migraciones idempotentes/reproducibles y rollback revisado.
- Logs no registran contraseñas, tokens ni secretos.
- Revocación de licencia/miembro tiene efecto inmediato o dentro del TTL documentado.
- Monitoreo y soporte pueden identificar usuario, producto y error sin exponer datos sensibles.

## 10. Bloqueos y decisiones pendientes

### Bloqueos técnicos antes de implementar
1. Reconciliar las 16 versiones del ledger remoto con el SQL fuente; el repositorio solo tiene tres archivos y no es reconstruible todavía.
2. Obtener dump SQL completo y restaurarlo en destino aislado.
3. Verificar backups/PITR y realizar restore drill.
4. Disponer de entorno local/staging con Supabase CLI y Docker; no crear ramas pagas sin aprobación explícita del coste.
5. Definir exactamente qué esquema(s) quedan expuestos en Supabase Data API y revisar grants/default privileges antes de crear `platform_api`.

### Decisiones de producto que deben aprobarse
1. Nombre visible del portal: “NOFEKI Platform”, “Mi NOFEKI” u otro.
2. Primeros módulos reales y matriz de roles de OPS.
3. Planes/precios/límites de OPS y si la primera licencia piloto será manual.
4. Proveedor de pagos y política de mora, gracia, cancelación y reembolso.
5. Si OPS comienza en el mismo proyecto Supabase (recomendado) o si existe un requisito empresarial que obligue a separarlo.

Estas decisiones comerciales no bloquean documentar ni construir el catálogo técnico, pero sí bloquean habilitar cobros y acceso comercial productivo.

## 11. Decisión de release

**GO:** continuar diseño, documentación y preparación de pruebas.

**NO-GO:** DDL en producción, cambios de Auth, reemplazo de `index.html`, cambio de `storageKey`, reescritura de Gastos, despliegue de OPS, cobros o migración de cuentas.

La primera entrega técnica, cuando se apruebe y se libere el bloqueo de recuperación, debe ser una fundación aditiva en staging. La primera entrega visible debe ser el portal en una ruta nueva, con Gastos como acceso gratuito y OPS todavía bloqueado. No se hará un corte masivo.
