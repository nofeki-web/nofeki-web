# NOFEKI — advisors y revisión de superficie de rama

**Fecha:** 2026-11-08  
**Proyecto Supabase:** `bxjgodhqseoxrnshqtfr`  
**Rama GitHub:** `recovery/pqr-admin-retry-fix-20261108`  
**Método:** lectura de Security/Performance Advisors y comparación Git; sin cambios de configuración, base de datos ni despliegue.

## 1. Supabase Security Advisor

### INFO — RLS Enabled No Policy (5 tablas)

El advisor informa RLS habilitada sin policies en:
- `public.pqr_events`
- `public.pqr_rate_limits`
- `public.pqr_submissions`
- `public.shortcut_authorizations`
- `public.shortcut_link_codes`

Esto coincide con el inventario anterior. Los grants efectivos revisados no dan CRUD a anon/authenticated sobre esas tablas y el backend usa service_role. El aviso es informativo, no prueba exposición. No añadir policies por defecto: probar el patrón backend-managed en aislamiento.

Remediación/documentación: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

### WARN — Leaked Password Protection Disabled

Auth tiene desactivada la comprobación de contraseñas comprometidas mediante HaveIBeenPwned. Es una mejora de seguridad recomendada. No se activó porque requiere cambiar la configuración de Auth y debe revisarse con el flujo de registro y recuperación, evitando bloquear usuarios legítimos.

Guía: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## 2. Supabase Performance Advisor

Dos índices aparecen como nunca usados:
- `public.shortcut_authorizations_user_active_idx`
- `public.budget_categories_user_budget_idx`

El advisor indica que podrían ser candidatos a revisión, no que deban eliminarse. Antes de cualquier DROP INDEX hay que inspeccionar consultas, FK/constraints, uso en ventanas representativas y planes EXPLAIN; no se eliminó ninguno.

Remediación/documentación: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## 3. Comparación GitHub de la rama de recuperación

Comparación `main...recovery/pqr-admin-retry-fix-20261108`:
- 45 commits ahead, 0 behind.
- 33 paths reportados en la comparación.
- La rama contiene documentos de auditoría/recuperación y también 8 archivos bajo `supabase/functions/` (seis funciones añadidas y dos modificadas en la comparación con main).

**Advertencia de integración:** aunque el objetivo de esta rama es recuperación documental, los ocho archivos de Edge Functions son código fuente real, no documentos. No abrir PR ni fusionar la rama completa como si fuera solo documentación. Antes de integrar, separar los artefactos documentales de las versiones de funciones y revisar cada diff contra producción y contra el baseline deseado. No hubo PR, merge, push de despliegue ni deploy desde esta revisión.

## 4. Acciones recomendadas — sin ejecutar

1. Activar leaked password protection en una ventana controlada y probar signup, login y recuperación.
2. Rastrear concesiones REFERENCES/TRIGGER a anon/authenticated y revocar solo tras confirmar que no hay dependencia.
3. Revisar los dos índices con consultas y planes de ejecución antes de cualquier eliminación.
4. Segmentar la rama antes de integrar: documentación por un lado; Edge Functions por otro, con revisión individual.
5. Mantener pendiente la restauración en instancia aislada hasta autorización explícita del costo.
