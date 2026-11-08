# NOFEKI — Captura complementaria de ACL y event triggers

**Fecha:** 2026-11-07  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Método:** consultas de catálogo de solo lectura. No se modificaron permisos ni objetos.

## Event triggers observados

| Nombre | Evento | Estado | Etiquetas | Función |
|---|---|---|---|---|
| ensure_rls | ddl_command_end | habilitado | CREATE TABLE, CREATE TABLE AS, SELECT INTO | public.rls_auto_enable |
| issue_graphql_placeholder | sql_drop | habilitado | DROP EXTENSION | set_graphql_placeholder |
| issue_pg_cron_access | ddl_command_end | habilitado | CREATE EXTENSION | grant_pg_cron_access |
| issue_pg_graphql_access | ddl_command_end | habilitado | CREATE EXTENSION | grant_pg_graphql_access |
| issue_pg_net_access | ddl_command_end | habilitado | CREATE EXTENSION | grant_pg_net_access |
| pgrst_ddl_watch | ddl_command_end | habilitado | todas | pgrst_ddl_watch |
| pgrst_drop_watch | sql_drop | habilitado | todas | pgrst_drop_watch |

**Tratamiento:** estos event triggers incluyen automatismos propios de Supabase/PostgREST/extensiones. No deben copiarse a una reconstrucción de aplicación como si fueran migraciones propias. El trigger `ensure_rls` sí es relevante para documentar el comportamiento de nuevas tablas en `public`, pero su función ya fue capturada en la revisión de funciones.

## Privilegios de tablas: observaciones relevantes

La consulta de `information_schema.role_table_grants` muestra los grants efectivos por tabla y rol. En particular:
- `authenticated` tiene CRUD en tablas de usuario sujetas a RLS.
- `anon` y `authenticated` aparecen con privilegios `REFERENCES` y `TRIGGER` en varias tablas, aunque no aparecen con CRUD anónimo. Estos privilegios no equivalen a lectura/escritura de filas; aun así, conviene revisar su origen y necesidad en una auditoría ACL específica antes de endurecerlos.
- `service_role` tiene privilegios de backend en varias tablas; algunas tablas internas PQR muestran permisos limitados a `service_role` y `postgres`.
- No se deben normalizar los grants con un `GRANT ALL` genérico. Los privilegios deben reconstruirse por tabla y función.

## Privilegios de funciones

La consulta de `information_schema.routine_privileges` confirmó:
- `save_monthly_budget`: EXECUTE para `authenticated` y `postgres`.
- `issue_shortcut_authorization`: EXECUTE para `service_role` y `postgres`.
- `pqr_consume_rate_limit`: EXECUTE para `service_role` y `postgres`.
- Las funciones de trigger y `rls_auto_enable` aparecen ejecutables por `postgres`.
- No apareció un grant EXECUTE para `PUBLIC` en las filas devueltas.

La captura debe complementarse con ACL exactas desde `pg_proc.proacl` y privilegios por columna antes de declarar el snapshot SQL como completo.

## Vistas y comentarios

- No se encontraron vistas en el esquema `public` mediante `pg_views`.
- El comentario de tabla recuperado fue `public.pqr_events`: “Historial de auditoría de cambios, notas internas y respuestas de PQR.”

## Pendientes de captura para baseline SQL integral

1. ACL exactas desde catálogos (`relacl`, `proacl`, `nspacl`) y privilegios por columna.
2. Default privileges por propietario/esquema.
3. Definiciones completas de constraints, índices y políticas ya se consultaron; deben guardarse como snapshot íntegro en la siguiente extracción.
4. Configuración de Storage (buckets/policies) y extensiones: distinguir objetos propios de Supabase.
5. Captura formal con Supabase CLI cuando haya entorno local y respaldo verificado.

## Decisión

No cambiar ahora los grants `REFERENCES`/`TRIGGER` observados. Primero determinar si proceden de grants explícitos, privilegios por defecto o configuración del proveedor. No copiar event triggers de plataforma a una migración de aplicación. Sin DDL ni despliegues en esta inspección.
