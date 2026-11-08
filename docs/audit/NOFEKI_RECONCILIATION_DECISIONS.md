# NOFEKI — Decisiones de reconciliación
Fecha: 2026-11-07

## Decisiones adoptadas
1. La reconciliación es documental y de solo lectura. No se modifica producción.
2. Las 13 migraciones faltantes quedan clasificadas como originales no recuperados en las ramas actuales; no como irrecuperables.
3. Los tres archivos presentes con timestamps distintos se tratan como equivalencias funcionales provisionales, no como copias exactas del SQL remoto.
4. Seis de ocho Edge Functions desplegadas coinciden carácter por carácter con los snapshots de la rama recovery.
5. `pqr-submit` y `pqr-admin` difieren entre producción y la rama. Las correcciones en rama siguen sin desplegar.
6. No se hará deploy ni PR hasta revisar Vercel auto-deploy, pruebas y plan de reversión.
7. No se cambiarán policies Storage solo por ausencia de policies directas: el flujo observado usa service_role para upload y URL firmada temporal para admin.
8. No se expondrá service_role en cliente y no se confiará en user_metadata para autorización.
9. El SQL reconstruido, si se prepara, será evidencia de referencia no ejecutable fuera de `supabase/migrations/`.

## Riesgos / tareas abiertas
| ID | Tema | Evidencia / riesgo | Acción siguiente |
|---|---|---|---|
| R-01 | Migraciones ausentes | 13 archivos no hallados en ramas actuales | Buscar forks/backups/artefactos |
| R-02 | Presupuestos | Índice adicional `budget_categories_budget_user_fk_idx` | Rastrear origen y uso antes de cambios |
| R-03 | PQR Submit | No comprueba error al persistir notification_status | Probar snapshot en entorno aislado |
| R-04 | PQR Admin retry | Producción no valida update ni event insert | Probar snapshot en entorno aislado |
| R-05 | Storage | Bucket privado, sin policies directas; backend privilegiado | Revisar autorización, upload, cleanup y signed URL |
| R-06 | CORS | Wildcard en dos funciones Shortcuts | Mantener hasta pruebas reales iOS; CORS no autentica |
| R-07 | Leaked password protection | HIBP / protección reportada deshabilitada | Evaluar activación y flujo de recuperación |
| R-08 | Grants heredados | Revisar privilegios efectivos sin asumir que grants equivalen a acceso RLS | Auditar grants/roles por tabla y función |
| R-09 | Event trigger RLS | `ensure_rls` autoactiva RLS en nuevas tablas públicas | Validar que nuevas tablas reciban policies correctas además de RLS |

## Puertas antes de producción
- Diff de código revisado y aprobado.
- Pruebas positivas y negativas en entorno aislado.
- Verificación de deploy automático Vercel y de Supabase.
- Plan de rollback.
- Confirmación explícita del usuario.
