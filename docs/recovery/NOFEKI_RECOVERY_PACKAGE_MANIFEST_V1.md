# NOFEKI — Paquete de recuperación por objeto v1

**Estado:** inventario de recuperación documental, no ejecutable.  
**Rama:** `recovery/pqr-admin-retry-fix-20261108`.  
**Regla:** no copiar SQL a `supabase/migrations/`; no ejecutar scripts de reconstrucción en producción.

## Principios
1. Cada objeto se recupera de una fuente identificada: catálogo de producción, código desplegado, archivo de repo o historial Git.
2. Registrar fuente, versión/hash, dependencias, permisos, políticas y nivel de confianza.
3. Separar definición de esquema, seguridad, funciones, triggers, índices y Storage.
4. Si la fuente original no está recuperada, marcar como reconstrucción parcial; no inventar DDL.
5. Restauración futura primero en proyecto aislado y con respaldo; nunca en producción sin plan, revisión y autorización explícita.

## Inventario por objeto

| Grupo | Objetos | Fuente de verdad recuperada | Estado |
|---|---|---|---|
| Datos personales | gastos, financial_profiles, user_expense_categories | catálogo de producción + frontend + Edge Function | Alta confianza estructural |
| Presupuestos | budgets, budget_categories | catálogo + función save_monthly_budget + frontend | Alta confianza estructural; migración original no exacta |
| Ingresos | income_transactions | catálogo + frontend + migración equivalente en repo | Alta confianza estructural |
| PQR | pqr_submissions, pqr_events, pqr_rate_limits | catálogo + pqr-submit v6 + pqr-admin v9 + Storage | Parcial; migraciones originales incompletas |
| Atajos | shortcut_authorizations, shortcut_link_codes | catálogo + 6 Edge Functions + frontend | Alta confianza estructural; RPC/trigger vinculados |
| Auditoría legal | legal_acceptance_audit | catálogo + trigger function | Parcial; revisar trigger Auth y metadatos |
| Storage | bucket pqr-attachments | catálogo Storage + código upload/signed URL | Configuración recuperada; no prueba funcional |
| Seguridad | grants, RLS, policies, function ACL | catálogo PostgreSQL | Snapshot recuperado; revisar default privileges por separado |
| Índices | índices 12 tablas | pg_indexes + constraints | Inventario; procedencia de índice extra pendiente |
| Funciones | 6 funciones públicas | pg_get_functiondef + ACL | Definiciones recuperadas del catálogo |
| Triggers | trigger de autorización atajo y trigger de captura legal; event trigger RLS | catálogo | Estructura parcialmente recuperada; completar definitions y dependencias |

## Archivos fuente de código
Los siguientes archivos están en esta rama y contienen snapshots, no constituyen despliegue:
- `supabase/functions/registrar-gasto-atajo/index.ts`
- `supabase/functions/crear-token-atajo/index.ts`
- `supabase/functions/gestionar-atajos/index.ts`
- `supabase/functions/categorias-atajo/index.ts`
- `supabase/functions/crear-codigo-vinculacion-atajo/index.ts`
- `supabase/functions/canjear-codigo-vinculacion-atajo/index.ts`
- `supabase/functions/pqr-submit/index.ts`
- `supabase/functions/pqr-admin/index.ts`

Hashes Git blob de páginas inspeccionadas:
- gastos.html: `3edf4cba7000d53f6bd0b449f6ab1763e0cb4b35`
- pqr-admin.html: `9ec41f9c6403842d92534e600069f2d531358f48`
- pqr.html: `e95232045f2dbad4bc8435ea3c0cab9db7150ef9`
- vincular-atajo.html: `638ebf5c9992ec5751d6c1cb2d4f45525523a32e`

## SQL por objeto — orden recomendado para reconstrucción aislada
1. Schemas/extensions/roles prerequisitos (no recrear roles administrados por Supabase).
2. Tablas base y constraints: auth.users FKs, claves primarias, unique/check/FK.
3. Índices no implícitos por constraints, conservando nombres/orden/expresiones.
4. RLS enablement y policies por tabla.
5. Grants y default privileges, comprobando rol por rol.
6. Funciones con lenguaje, argumentos, security mode, search_path y ACL.
7. Triggers de tabla y event triggers; validar owner y eventos.
8. Storage bucket, límites y políticas (no abrir bucket privado).
9. Edge Functions y secretos como etapa separada, nunca exportar valores secretos al repo.
10. Pruebas y verificación de integridad.

## Objetos no recuperados completamente
- 13 migraciones remotas sin fuente original en ramas inspeccionadas.
- DDL exacto de todos los objetos no puede inferirse solo del estado final.
- Default privileges, dependencias de extensiones y owners deben completar el paquete.
- Procedencia de `budget_categories_budget_user_fk_idx` desconocida.

## Criterio de liberación
No considerar el paquete restaurable hasta que cada objeto tenga definición, origen, hash, dependencias, ACL/RLS y prueba de restauración en proyecto aislado.