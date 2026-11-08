# NOFEKI — Snapshot complementario: ACL exactas y Storage

**Fecha de inspección:** 2026-11-07  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Método:** consultas de catálogo de solo lectura. Sin DDL, cambios de permisos ni despliegues.

## Storage

Se observó un bucket:
- ID/nombre: `pqr-attachments`
- Privado: sí (`public = false`)
- Límite: 5.242.880 bytes (5 MiB)
- MIME permitidos: `application/pdf`, `image/jpeg`, `image/png`

No se encontraron políticas RLS en `storage.objects` ni en las demás tablas del esquema `storage` consultadas mediante `pg_policies`. El acceso debe continuar realizándose desde el backend autorizado (service role) y mediante URLs firmadas si el flujo lo requiere. No volver público el bucket.

## ACL exactas de objetos de aplicación

Se consultaron `pg_class.relacl` para relaciones del esquema `public`. Resumen de ACL explícitas relevantes:

| Tabla | anon | authenticated | service_role |
|---|---|---|---|
| budgets | REFERENCES, TRIGGER | CRUD + REFERENCES + TRIGGER | REFERENCES, TRIGGER, TRUNCATE |
| budget_categories | REFERENCES, TRIGGER | CRUD + REFERENCES + TRIGGER | REFERENCES, TRIGGER, TRUNCATE |
| financial_profiles | sin ACL explícita | SELECT, INSERT, UPDATE | REFERENCES, TRIGGER, TRUNCATE |
| gastos | sin ACL explícita | SELECT, INSERT, UPDATE, DELETE | CRUD + REFERENCES + TRIGGER + TRUNCATE |
| income_transactions | REFERENCES, TRIGGER | CRUD + REFERENCES + TRIGGER | REFERENCES, TRIGGER, TRUNCATE |
| legal_acceptance_audit | sin ACL explícita | SELECT | REFERENCES, TRIGGER, TRUNCATE |
| pqr_events | sin ACL explícita | sin ACL explícita | CRUD + REFERENCES + TRIGGER + TRUNCATE |
| pqr_rate_limits | sin ACL explícita | sin ACL explícita | CRUD + REFERENCES + TRIGGER + TRUNCATE |
| pqr_submissions | sin ACL explícita | sin ACL explícita | CRUD + REFERENCES + TRIGGER + TRUNCATE |
| shortcut_authorizations | sin ACL explícita | sin ACL explícita | CRUD + REFERENCES + TRIGGER + TRUNCATE |
| shortcut_link_codes | sin ACL explícita | sin ACL explícita | INSERT + REFERENCES + SELECT + TRIGGER + UPDATE |
| user_expense_categories | sin ACL explícita | CRUD + REFERENCES + TRIGGER | SELECT + REFERENCES + TRIGGER + TRUNCATE |

**Importante:** los permisos agregados de `information_schema.role_table_grants` pueden incluir privilegios heredados de ACL por defecto del proveedor. No deben confundirse con grants individuales escritos por las migraciones de NOFEKI. La tabla muestra una lectura resumida, no un script de restauración.

## ACL de funciones

Las ACL exactas en `pg_proc.proacl` confirman:
- `save_monthly_budget`: EXECUTE para `authenticated` y `postgres`.
- `issue_shortcut_authorization` y `pqr_consume_rate_limit`: EXECUTE para `service_role` y `postgres`.
- Las funciones de trigger y `rls_auto_enable`: EXECUTE para `postgres`.
- No aparece `PUBLIC` en las ACL explícitas recuperadas.

## ACL por columna

La consulta de `information_schema.column_privileges` muestra que varios privilegios se encuentran concedidos a nivel de columna además de los permisos de tabla. La salida es extensa y se conserva como hallazgo; antes de generar SQL de restauración debe exportarse completa en un archivo de snapshot, para evitar pérdida por truncamiento de resultados.

## Default privileges

Se observaron ACL por defecto asociadas a propietarios/proveedores como `supabase_admin` y `postgres`, para tablas, funciones y secuencias. Son configuraciones del entorno administrado y no deben copiarse de forma indiscriminada a un entorno local. El baseline debe definir explícitamente qué defaults pertenecen a NOFEKI y cuáles son defaults del proveedor.

## Secuencia

`public.legal_acceptance_audit_id_seq` tiene ACL NULL en `pg_class.relacl`; eso indica que utiliza ACL por defecto del propietario, no que la secuencia no tenga permisos efectivos. Verificar privilegios efectivos de secuencia en la exportación final.

## Conclusiones

1. El bucket PQR es privado y acepta PDF/JPEG/PNG con límite de 5 MiB.
2. No hay políticas Storage observadas en el catálogo consultado; no se debe abrir acceso público.
3. Hay una mezcla de ACL explícitas y privilegios por defecto del entorno Supabase.
4. No se deben convertir las ACL observadas en grants globales sin separar proveedor y aplicación.
5. La captura está más completa, pero **todavía no es un dump SQL integral restaurable**: falta exportar las ACL por columna sin truncamiento, políticas completas, todos los objetos/definiciones y contrastar los servicios administrados.

## Próxima acción segura

Obtener un dump de esquema con Supabase CLI desde un equipo local compatible y revisar el resultado antes de usarlo. Mantener producción sin cambios hasta que el baseline se restaure en local y pasen las pruebas de regresión.
