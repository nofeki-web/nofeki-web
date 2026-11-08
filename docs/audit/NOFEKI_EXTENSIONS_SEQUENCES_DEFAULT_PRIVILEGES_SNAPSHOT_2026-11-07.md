# NOFEKI — snapshot de extensiones, secuencias y default privileges

**Fecha:** 2026-11-07  
**Origen:** catálogo PostgreSQL de producción; consultas SELECT solamente.  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**No contiene datos de negocio ni secretos.**

## 1. Extensiones instaladas

| Extensión | Versión |
|---|---:|
| pg_stat_statements | 1.11 |
| pgcrypto | 1.3 |
| plpgsql | 1.0 |
| supabase_vault | 0.3.1 |
| uuid-ossp | 1.1 |

Antes de restaurar, comprobar disponibilidad/compatibilidad en la instancia aislada. No asumir que las extensiones Supabase gestionadas pueden instalarse en cualquier PostgreSQL externo.

## 2. Secuencias visibles en schemas revisados

| Secuencia | Owner |
|---|---|
| auth.refresh_tokens_id_seq | supabase_auth_admin |
| public.legal_acceptance_audit_id_seq | postgres |

Este inventario es solo de schemas auth/public/storage consultados y no reemplaza la captura de dependencias/default ownership de cada secuencia. No se capturó ni se requiere copiar el valor actual de secuencias de Auth para recuperar estructura.

## 3. Default privileges observados

El catálogo devolvió ACL por owner, schema y tipo de objeto. Tipos: `r` tablas, `S` secuencias, `f` funciones. Se conserva el detalle en la siguiente tabla en formato de ACL PostgreSQL.

| Schema | Owner | Tipo | ACL devuelta |
|---|---|---|---|
| auth | supabase_auth_admin | r | postgres=arwdDxtm; dashboard_user=arwdDxtm |
| auth | supabase_auth_admin | f | postgres=X; dashboard_user=X |
| auth | supabase_auth_admin | S | postgres=rwU; dashboard_user=rwU |
| extensions | supabase_admin | r | postgres=a*r*w*d*D*x*t*m* |
| extensions | supabase_admin | S | postgres=r*w*U* |
| extensions | supabase_admin | f | postgres=X* |
| graphql | supabase_admin | r | postgres=arwdDxtm; anon=arwdDxtm; authenticated=arwdDxtm; service_role=arwdDxtm |
| graphql | supabase_admin | S | postgres=rwU; anon=rwU; authenticated=rwU; service_role=rwU |
| graphql | supabase_admin | f | postgres=X; anon=X; authenticated=X; service_role=X |
| graphql_public | supabase_admin | r | postgres=arwdDxtm; anon=arwdDxtm; authenticated=arwdDxtm; service_role=arwdDxtm |
| graphql_public | supabase_admin | S | postgres=rwU; anon=rwU; authenticated=rwU; service_role=rwU |
| graphql_public | supabase_admin | f | postgres=X; anon=X; authenticated=X; service_role=X |
| public | postgres | r | postgres=arwdDxtm; anon=Dxtm; authenticated=Dxtm; service_role=Dxtm |
| public | postgres | S | postgres=rwU |
| public | postgres | f | postgres=X |
| public | supabase_admin | r | postgres=arwdDxtm; anon=arwdDxtm; authenticated=arwdDxtm; service_role=arwdDxtm |
| public | supabase_admin | S | postgres=rwU; anon=rwU; authenticated=rwU; service_role=rwU |
| public | supabase_admin | f | postgres=X; anon=X; authenticated=X; service_role=X |
| realtime | supabase_admin | r | postgres=a*r*wdDxtm; dashboard_user=arwdDxtm |
| realtime | supabase_admin | S | postgres=rwU; dashboard_user=rwU |
| realtime | supabase_admin | f | postgres=X; dashboard_user=X |
| storage | postgres | r | postgres=arwdDxtm; anon=arwdDxtm; authenticated=arwdDxtm; service_role=arwdDxtm |
| storage | postgres | S | postgres=rwU; anon=rwU; authenticated=rwU; service_role=rwU |
| storage | postgres | f | postgres=X; anon=X; authenticated=X; service_role=X |

**Importante:** son privilegios por defecto para objetos futuros, no un listado de permisos efectivos de cada tabla/función existente. Los ACL efectivos por objeto y las políticas RLS deben evaluarse por separado. No copiar estas ACL sin comparar el baseline Supabase de destino: varios schemas son gestionados por la plataforma.

## 4. Hallazgos y precauciones

1. El owner `supabase_admin` tiene default privileges en schemas gestionados (extensions, graphql, graphql_public, realtime y public). No recrear roles gestionados ni aplicar manualmente estos defaults en un proyecto distinto.
2. En `public`, los defaults de `postgres` conceden a anon/authenticated/service_role privilegios de tabla limitados (Dxtm según ACL devuelta), no el conjunto completo CRUD. Los grants explícitos de migraciones pueden modificar el resultado final.
3. La restauración debe preservar el orden: crear objetos, aplicar owner y grants, revisar RLS/policies y luego validar los permisos efectivos.
4. Las secuencias de Auth pertenecen a infraestructura Supabase. No restaurarlas manualmente desde una base PostgreSQL externa.

## 5. Pendientes

- Extraer ACL efectivas de todas las secuencias y owners/dependencias.
- Comparar default privileges con el baseline de un proyecto Supabase aislado de la misma generación.
- Confirmar grants de schemas y extensiones.
- Verificar con `has_table_privilege`, `has_sequence_privilege` y `has_function_privilege` por rol en entorno de prueba.
