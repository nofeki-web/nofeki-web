# NOFEKI — Registro de migraciones sin archivo original recuperado
Fecha: 2026-11-07
Alcance: comparación del historial remoto de Supabase con los archivos presentes en las ramas GitHub inspeccionadas.

## Clasificación
**D — Original no recuperado en las ramas actuales.** Esto no significa irrecuperable definitivamente. Pueden existir forks, clones locales, commits eliminados, backups o artefactos externos.

| Versión remota | Nombre del historial |
|---|---|
| 20261018201105 | tighten_gastos_and_function_privileges |
| 20261018201138 | optimize_legal_audit_rls_policy |
| 20261019020006 | create_financial_profiles_for_onboarding |
| 20261019021147 | user_expense_categories |
| 20261019021929 | grant_user_expense_categories_access |
| 20261022024849 | add_shortcut_authorization_expiration |
| 20261022040313 | enforce_single_active_shortcut_authorization |
| 20261024194051 | grant_service_role_select_user_expense_categories |
| 20261024220845 | shortcut_link_codes |
| 20261025152720 | revoke_unneeded_table_privileges |
| 20261105033443 | atomic_monthly_budget_save |
| 20261107160355 | create_secure_pqr_intake |
| 20261107171359 | pqr_atomic_rate_limiting |

## Equivalencias con timestamp distinto
| Historial remoto | Archivo presente en main |
|---|---|
| 20261105033355 create_monthly_budgets | 20261104000100_create_monthly_budgets.sql |
| 20261105033850 create_income_transactions | 20261105000100_create_income_transactions.sql |
| 20261107161429 pqr_management_workflow | 20261107120000_pqr_management_workflow.sql |

Las equivalencias son por nombre/intención y comparación estructural. No deben considerarse identidad byte a byte del SQL histórico.

## Reglas de recuperación
1. No editar ni borrar historial remoto.
2. No fabricar archivos originales.
3. No insertar SQL reconstruido en `supabase/migrations/`.
4. Buscar copias en forks, repositorios alternos, respaldos y clones locales cuando estén disponibles.
5. Si se necesita una referencia reconstruida, ubicarla fuera del directorio de migraciones, marcarla como RECONSTRUCTED / NOT EXECUTABLE y documentar evidencia y objetos no recuperables.
