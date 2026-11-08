# NOFEKI Platforms — inventario técnico inicial

**Fecha:** 2026-11-08  
**Base revisada:** `main` en `3f00f86826bd9cd225a5d5c67a92cdc2994211ca` y proyecto Supabase `bxjgodhqseoxrnshqtfr`.  
**Alcance:** inspección de solo lectura. No se aplicaron cambios en Supabase ni Vercel.

## 1. Repositorio y frontend

El árbol recursivo de `main` contiene páginas HTML independientes, entre ellas:

- `index.html`
- `gastos.html`
- `pqr.html`
- `pqr-admin.html`
- `vincular-atajo.html`
- páginas legales
- `vercel.json`
- `supabase/functions` y `supabase/migrations`

No aparece `package.json`, `src/`, `app/` ni `pages/` en el árbol revisado. Esto sugiere que el portal actual se publica como sitio estático con lógica de navegador dentro de sus páginas, no como una aplicación Next.js/React con proceso de compilación en este repositorio.

**Implicación para Platforms:** no introducir una reestructuración de framework como parte de la primera fase. La integración inicial debe ser aditiva y compatible con el despliegue estático existente. Se puede evaluar una nueva ruta/página de portal aislada, pero antes hay que inspeccionar en detalle el flujo real de sesión y las rutas actuales.

El archivo `vercel.json` revisado define encabezados de seguridad globales y no muestra reglas de build, rewrites ni redirects personalizados en el contenido recuperado.

## 2. Base de datos observada

La inspección de tablas se realizó en modo lectura para `public` y `platform`. Se devolvió el inventario de tablas de `public`; no se observó un esquema `platform` con tablas de negocio en el resultado.

Elementos de Gastos identificados en el inventario:

- `gastos` (39 filas observadas), con `user_id` relacionado con `auth.users`.
- `financial_profiles` (0 filas observadas), perfil financiero/onboarding propio del producto.
- `user_expense_categories` (4 filas observadas).
- `shortcut_authorizations` (21 filas observadas).
- `shortcut_link_codes` (12 filas observadas).
- `budgets` (1 fila observada).
- `budget_categories` (12 filas observadas).
- `income_transactions` (0 filas observadas).
- Tablas de PQR y auditoría.
- RLS aparece habilitado en las tablas devueltas.

Los conteos son una fotografía del momento de inspección, no cifras permanentes. No se consultaron ni exportaron datos personales de filas.

**Implicación para Identity:** no crear otra tabla genérica que replique sin análisis `financial_profiles`. Esa tabla parece contener atributos financieros y onboarding de Gastos, no el perfil universal de Platforms. El perfil universal debe diseñarse separado y con un propósito acotado, después de revisar si existe algún perfil de usuario en frontend o Auth metadata que ya se esté usando.

## 3. Estado de aislamiento

- La búsqueda de ramas Supabase devolvió una lista vacía.
- No se creó branch ni proyecto Supabase.
- No se creó esquema ni tabla en producción.
- No se modificó Auth, RLS, Edge Functions, Vercel ni variables de entorno.

## 4. Riesgos y verificaciones pendientes

1. **Flujo de sesión frontend:** inspeccionar `gastos.html` y `index.html` para identificar inicialización de Supabase, persistencia, callbacks de Auth, guards y recuperación de sesión.
2. **Contratos existentes:** documentar qué páginas y funciones llaman cada tabla/Edge Function antes de añadir cualquier gate de autorización.
3. **Vercel:** verificar configuración real de producción y workflows antes de crear rutas o PRs que pudieran disparar un despliegue.
4. **Perfil universal:** confirmar el modelo de datos actual y evitar duplicar información personal ya mantenida por Auth o por el producto.
5. **Entorno de pruebas:** no hay branch Supabase de desarrollo disponible en el proyecto observado; la opción local se retomará cuando el usuario disponga de computador personal. Cualquier entorno remoto de pago requiere cotización y autorización.

## 5. Decisión técnica provisional

Mantener el repositorio y el frontend actual como base. Diseñar Platforms como una capa aditiva, sin migrar de framework, sin reemplazar Supabase Auth y sin conectar todavía el login de Gastos al motor de permisos. La primera implementación deberá empezar en un entorno aislado y pasar pruebas de regresión antes de cualquier activación.
