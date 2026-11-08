# NOFEKI — Revisión de privilegios efectivos (2026-11-07)

## Alcance y método
Consulta de solo lectura al catálogo PostgreSQL de producción. Se evaluaron privilegios efectivos con `has_table_privilege` para anon, authenticated y service_role; RLS; y `has_function_privilege` para funciones public. No se ejecutaron cambios.

## Hallazgos
- Las 12 tablas públicas revisadas tienen RLS habilitado; ninguna tiene FORCE ROW LEVEL SECURITY.
- anon no tiene SELECT ni INSERT efectivo en las tablas de negocio consultadas.
- authenticated tiene SELECT/INSERT/UPDATE/DELETE en tablas de datos de usuario según el diseño RLS; financial_profiles no concede DELETE; legal_acceptance_audit solo SELECT para el usuario.
- Las tablas internas PQR y Shortcut no conceden operaciones a anon ni authenticated; service_role sí tiene operaciones en pqr_events, pqr_rate_limits, pqr_submissions, shortcut_authorizations y shortcut_link_codes, con la excepción de DELETE en shortcut_link_codes.
- service_role tiene acceso CRUD efectivo a gastos y SELECT en user_expense_categories, pero no presenta SELECT/INSERT/UPDATE/DELETE efectivo en budgets, budget_categories, financial_profiles, income_transactions o legal_acceptance_audit. No es necesariamente defecto: los flujos actuales usan authenticated/RPC para datos financieros y service_role para tablas internas.
- service_role y postgres tienen BYPASSRLS; anon y authenticated no.
- Funciones: save_monthly_budget solo EXECUTE para authenticated; issue_shortcut_authorization y pqr_consume_rate_limit solo para service_role; rutinas trigger/definer consultadas sin EXECUTE para anon/authenticated/service_role.
- Las funciones SECURITY DEFINER consultadas tienen ACL limitada al propietario postgres; no se encontró EXECUTE público en esas rutinas.

## Interpretación y cautelas
1. RLS habilitado no equivale a FORCE RLS. Los roles con BYPASSRLS (service_role/postgres) pueden eludir RLS, por lo que su autorización debe mantenerse en Edge Functions/RPC y secretos server-side.
2. La matriz es de privilegios efectivos PostgreSQL, no una prueba funcional del API REST ni de cada flujo UI.
3. No revocar ni ampliar permisos basándose solo en este documento. Cambios podrían romper Edge Functions o el cliente.
4. Las políticas de fila y el propietario de cada tabla siguen siendo controles independientes; revisar conjuntamente antes de cualquier cambio.

## Recomendaciones
- Mantener service_role exclusivamente en Edge Functions/server-side.
- Antes de modificar grants, construir una matriz endpoint → rol SQL → tablas/operaciones → validación de usuario/propietario → RLS.
- Probar regresión de alta, lectura, edición y eliminación de gastos, ingresos, presupuestos, categorías, atajos y PQR con cuentas anon/autenticadas/admin.
- Revaluar FORCE RLS solo si se diseña explícitamente; no activarlo como endurecimiento automático.

## Estado
Solo auditoría documental. Sin SQL de escritura, migraciones, cambios de Auth/RLS, despliegues ni modificación de datos.