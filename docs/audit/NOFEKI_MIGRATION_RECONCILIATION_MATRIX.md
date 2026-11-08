# NOFEKI — Matriz de reconciliación de migraciones

**Fecha de inspección:** 2026-11-07  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Método:** consultas SQL SELECT al catálogo de producción + inspección GitHub.  
**Alcance:** evidencia técnica; no se ejecutó DDL, DML, migraciones ni despliegues.

## Resumen ejecutivo

- Historial remoto: **16 migraciones**.
- Archivos de migración encontrados en las ramas actuales: **3 equivalentes**; no se encontraron los archivos fuente de las otras 13.
- Las 13 migraciones faltantes se clasifican por ahora como **D — original no recuperado** (no significa que su efecto esté ausente de producción).
- Las tres migraciones restantes presentan divergencia de timestamp/nombre entre historial remoto y repositorio.
- Producción tiene 12 tablas en `public`, todas con RLS habilitado.
- Se inspeccionaron columnas, constraints, índices, políticas, funciones públicas, triggers de tabla, grants, storage y versiones de Edge Functions.
- No se modificó producción.

## Inventario individual

| Versión remota | Nombre remoto | Estado de archivo |
|---|---|---|
| 20261018201105 | tighten_gastos_and_function_privileges | D — no localizado en ramas actuales |
| 20261018201138 | optimize_legal_audit_rls_policy | D — no localizado en ramas actuales |
| 20261019020006 | create_financial_profiles_for_onboarding | D — no localizado en ramas actuales |
| 20261019021147 | user_expense_categories | D — no localizado en ramas actuales |
| 20261019021929 | grant_user_expense_categories_access | D — no localizado en ramas actuales |
| 20261022024849 | add_shortcut_authorization_expiration | D — no localizado en ramas actuales |
| 20261022040313 | enforce_single_active_shortcut_authorization | D — no localizado en ramas actuales |
| 20261024194051 | grant_service_role_select_user_expense_categories | D — no localizado en ramas actuales |
| 20261024220845 | shortcut_link_codes | D — no localizado en ramas actuales |
| 20261025152720 | revoke_unneeded_table_privileges | D — no localizado en ramas actuales |
| 20261105033443 | atomic_monthly_budget_save | D — no localizado en ramas actuales |
| 20261107160355 | create_secure_pqr_intake | D — no localizado en ramas actuales |
| 20261107171359 | pqr_atomic_rate_limiting | D — no localizado en ramas actuales |
| 20261105033355 | create_monthly_budgets | B — archivo equivalente en repo: `20261104000100_create_monthly_budgets.sql` |
| 20261105033850 | create_income_transactions | B — archivo equivalente en repo: `20261105000100_create_income_transactions.sql` |
| 20261107161429 | pqr_management_workflow | B — archivo equivalente en repo: `20261107120000_pqr_management_workflow.sql` |

**Criterio B:** el nombre/objeto funcional coincide como candidato equivalente, pero la diferencia de timestamp significa que no se debe asumir equivalencia byte a byte ni ejecutar el archivo como migración nueva. Requiere comparar SQL y estado final.

## Evidencia GitHub

Se enumeraron las 21 ramas actuales y se inspeccionaron sus árboles recursivos. Ninguna contiene los 13 archivos ausentes. La búsqueda de commits por los nombres exactos tampoco devolvió coincidencias. Esto no excluye objetos Git eliminados, commits no indexados, forks, copias locales o artefactos externos.

## Diferencias y decisiones

1. No reconstruir ni crear archivos dentro de `supabase/migrations/` para las 13 faltantes.
2. Recuperar SQL original desde backups, PRs, archivos locales o exportaciones de auditoría si aparecen.
3. Documentar el estado actual del catálogo por separado del SQL histórico.
4. Los SQL que se reconstruyan desde catálogo deben ir en `docs/audit/reference-sql/`, rotulados **RECONSTRUIDO / NO EJECUTABLE**.
5. Antes de consolidar un historial, comparar cada archivo equivalente con el estado de producción y diseñar una estrategia que no reejecute cambios existentes.
6. Las 13 migraciones faltantes no implican por sí mismas un defecto funcional: el catálogo confirma que buena parte de los objetos asociados sí existen en producción.

## Pendientes de reconciliación

- Obtener definiciones completas de todas las políticas y grants para tablas internas.
- Verificar privilegios efectivos de funciones y triggers de Auth/event triggers.
- Comparar las tres migraciones equivalentes contra los archivos del repo.
- Obtener fuente desplegada de cada Edge Function y comparar hash/contenido con snapshots del repositorio.
- Revisar Storage: bucket privado y RLS de `storage.objects` habilitado, sin políticas; aunque existen grants generales, RLS sin políticas impide acceso directo ordinario. Confirmar que las rutas previstas usan Edge Functions/service role y que no hay acceso público accidental.
- Revisar advisors y leaked-password protection en una fase separada, sin cambiar configuración.
