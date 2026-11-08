# NOFEKI Platforms — auditoría de autenticación y convivencia
**Fecha:** 2026-11-08  
**Base de código:** `main`, commit `3f00f86826bd9cd225a5d5c67a92cdc2994211ca`.  
**Método:** lectura estática de `gastos.html`, `vincular-atajo.html`, `index.html` y `vercel.json`. No se ejecutó navegador ni se realizaron llamadas de escritura a producción.

## 1. Hallazgos confirmados

### 1.1 NOFEKI Gastos mantiene una identidad Supabase Auth
- `gastos.html` crea el cliente con el proyecto Supabase actual y la clave publishable.
- Usa el storage key `nofeki-gastos-auth-v1`, `localStorage`, `persistSession:true`, `autoRefreshToken:true`, `detectSessionInUrl:true` y flujo PKCE.
- El alta usa `auth.signUp`, incluye captcha y consentimiento; login usa `signInWithPassword`.
- El logout explícito ejecuta `client.auth.signOut()`.
- La recuperación usa un cliente separado con storage key `nofeki-gastos-recovery-auth-v1`, `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false` y flujo implicit. Luego la página contempla tanto code/PKCE como access/refresh token.
- La página `vincular-atajo.html` utiliza el mismo storage key `nofeki-gastos-auth-v1` y las mismas opciones persistentes del cliente principal. Esto permite que el flujo de vinculación lea la sesión de Gastos en el mismo navegador.

### 1.2 La identidad actual debe conservarse
Las operaciones de Gastos envían `currentUser.id` como `user_id`; el Atajo y la administración de autorizaciones dependen de la misma identidad. La migración a Platforms debe conservar el UUID de `auth.users` como clave canónica. No se debe crear un segundo usuario ni migrar contraseñas.

### 1.3 Guardas y operaciones actuales
- El guardado de gasto vuelve a consultar `auth.getSession()` antes del insert.
- La eliminación consulta sesión y filtra por `id` y `user_id`.
- La consulta y revocación del Atajo obtienen el access token de la sesión y llaman a `gestionar-atajos`.
- La página tiene timeout de inactividad de 15 minutos.
- El listener de Auth carga un usuario autenticado si todavía no hay `currentUser`.

## 2. Riesgos y puntos de atención

### R1 — El evento SIGNED_OUT no desmonta el dashboard
El listener registra el evento y muestra un mensaje, pero deliberadamente no limpia `currentUser` ni vuelve al login. Esto se diseñó para evitar que un refresh/transitorio desmonte un formulario durante un guardado. Sin embargo, también puede dejar una interfaz visualmente autenticada después de un cierre de sesión externo o en otra pestaña. Las operaciones protegidas vuelven a consultar sesión, lo que reduce el riesgo de escritura con sesión inexistente, pero la interfaz puede quedar desincronizada.

**Tratamiento recomendado:** no cambiarlo en esta fase. Diseñar y probar un manejo de SIGNED_OUT que distinga logout explícito, pérdida real de sesión y operación crítica en curso. Debe conservar formularios no enviados y mostrar estado coherente.

### R2 — Inicialización y recuperación de contraseña tienen dos clientes
El cliente de recuperación usa otro storage key y flujo implicit; el cliente principal usa PKCE. La página contiene lógica manual para ambos formatos. Es un área sensible: cambiarla puede invalidar enlaces enviados o interferir con sesiones existentes.

**Tratamiento recomendado:** congelar el flujo actual hasta disponer de pruebas de recuperación reales en un entorno controlado. No unificar clientes ni cambiar flowType como parte de Platforms sin una prueba específica.

### R3 — Carga inicial y callback pueden competir
La página llama `getSession()` durante el arranque y también escucha `onAuthStateChange`. El callback agenda `loadUser(session.user)` si `currentUser` todavía no está establecido. Es posible que el arranque y el callback intenten cargar el mismo usuario casi simultáneamente.

**Tratamiento recomendado:** revisar `loadUser` y sus guards de concurrencia. No cambiar sin verificar que los estados de dashboard, categorías, gastos, presupuesto e ingresos no se carguen dos veces ni queden a medias.

### R4 — Platforms no debe apropiarse de la sesión de Gastos
No se debe introducir otro Supabase client con storage key distinto para el mismo login ni otro proveedor de identidad. Tampoco se debe reemplazar el cliente actual antes de probar coexistencia.

**Tratamiento recomendado:** Platforms utilizará inicialmente el mismo Supabase Auth y el mismo UUID. La primera integración debe consultar autorización desde servidor sin cambiar el mecanismo de sesión.

### R5 — El portal principal actual no parece ser el login de Gastos
La página `index.html` revisada no muestra llamadas a Supabase Auth en las coincidencias consultadas. Su contenido y navegación deben auditarse por separado antes de decidir si será el portal de entrada o una landing pública con enlace a Platforms.

## 3. Diseño de integración recomendado

### Etapa 1 — Sin tocar Auth
- Mantener el login, storage key, PKCE, recuperación y timeout existentes.
- Incorporar un catálogo y un portal informativo sin exigir nueva sesión.
- No cambiar la URL actual de Gastos ni los contratos de sus funciones.

### Etapa 2 — Resolución de identidad
- Después del login actual, usar `session.user.id` como identidad.
- Consultar perfil y concesiones de Platforms a través de una función de servidor.
- Si Platforms está temporalmente indisponible, no bloquear el uso de Gastos mientras se mantenga el entitlement gratuito vigente en el diseño de migración.
- No otorgar permisos a partir de `user_metadata` o datos manipulables por el cliente.

### Etapa 3 — Integración gradual
- Feature flag desactivado por defecto.
- Activación primero para cuentas internas de prueba.
- La autorización se verifica en servidor para cada operación nueva de OPS.
- Los endpoints existentes de Gastos permanecen sin dependencia de Platforms hasta terminar regresión.

## 4. Pruebas necesarias antes de cualquier cambio

1. Inicio de sesión existente en web y persistencia tras recarga.
2. Cierre de sesión explícito y cierre desde otra pestaña.
3. Refresh de token con red intermitente.
4. Recuperación de contraseña desde correo en iOS y escritorio.
5. Alta nueva con Turnstile y consentimiento.
6. Carga inicial concurrente sin duplicar consultas ni mostrar estados parciales.
7. Guardar/eliminar gasto durante transición de sesión.
8. Vincular, usar y revocar el Atajo en la misma cuenta.
9. Presupuesto e ingresos después de recarga y reautenticación.
10. Platforms no disponible: Gastos sigue accesible y no pierde datos.

## 5. Decisión

**No se recomienda modificar ahora el bloque de autenticación de `gastos.html`.** La mejor ruta es diseñar Platforms como una capa de identidad y autorización que reutilice la sesión existente, con integración opt-in y pruebas de regresión.

Esta auditoría es estática. No demuestra que los flujos se hayan ejecutado correctamente ni sustituye pruebas de navegador. No se cambiaron archivos de producción, Auth, tablas, RLS, Edge Functions, configuración de Vercel ni variables de entorno.
