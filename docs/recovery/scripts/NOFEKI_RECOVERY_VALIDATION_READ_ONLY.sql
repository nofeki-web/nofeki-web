-- NOFEKI Gastos — verificación read-only posterior a restauración
-- Este archivo contiene únicamente consultas SELECT de catálogo.
-- Puede ejecutarse en un entorno de prueba. No ejecuta DDL/DML ni consulta
-- filas de negocio, tokens, PII, adjuntos ni secretos.
-- No es un script de restauración: verifica presencia/configuración después
-- de que el DDL exacto haya sido revisado y aplicado en un entorno aislado.

-- 1) Tablas públicas esperadas y estado RLS.
WITH expected(name) AS (
 VALUES ('budgets'),('budget_categories'),('financial_profiles'),('gastos'),
 ('income_transactions'),('legal_acceptance_audit'),('pqr_events'),
 ('pqr_rate_limits'),('pqr_submissions'),('shortcut_authorizations'),
 ('shortcut_link_codes'),('user_expense_categories')
)
SELECT e.name,
       (c.oid IS NOT NULL) AS exists,
       COALESCE(c.relrowsecurity,false) AS rls_enabled,
       COALESCE(c.relforcerowsecurity,false) AS force_rls
FROM expected e
LEFT JOIN pg_class c ON c.relname=e.name
LEFT JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
WHERE c.oid IS NULL OR n.oid IS NOT NULL
ORDER BY e.name;

-- 2) Policies por tabla (incluye tablas sin policies).
SELECT schemaname, tablename, count(*) AS policy_count,
       string_agg(policyname, ', ' ORDER BY policyname) AS policy_names
FROM pg_policies
WHERE schemaname IN ('public','storage')
GROUP BY schemaname,tablename
ORDER BY schemaname,tablename;

-- 3) Rutinas críticas: firma, owner, SECURITY mode y definición disponible.
SELECT n.nspname AS schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'save_monthly_budget','issue_shortcut_authorization',
    'pqr_consume_rate_limit','capture_nofeki_legal_acceptance',
    'enforce_single_active_shortcut_authorization','rls_auto_enable'
  )
ORDER BY p.proname,identity_arguments;

-- 4) Triggers y event triggers.
SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname,
       t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal
  AND (t.tgname IN ('nofeki_capture_legal_acceptance',
                    'trg_single_active_shortcut_authorization')
       OR c.relname IN ('auth.users','shortcut_authorizations'))
ORDER BY 1,2,3;

SELECT evtname, evtenabled, evtevent,
       pg_get_userbyid(evtowner) AS owner,
       evttags, evtfname::regproc AS function
FROM pg_event_trigger
WHERE evtname='ensure_rls';

-- 5) Índices relevantes y estado.
SELECT schemaname,tablename,indexname,indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND (indexname IN ('budget_categories_budget_user_fk_idx',
                     'shortcut_authorizations_user_active_idx',
                     'budget_categories_user_budget_idx')
       OR tablename IN ('budgets','budget_categories','gastos',
                        'income_transactions','shortcut_authorizations'))
ORDER BY tablename,indexname;

-- 6) Constraints y validación.
SELECT n.nspname AS schema_name,c.relname AS table_name,
       con.conname,con.contype,con.convalidated,
       pg_get_constraintdef(con.oid,true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('budgets','budget_categories','gastos',
                    'financial_profiles','income_transactions',
                    'legal_acceptance_audit','pqr_events','pqr_rate_limits',
                    'pqr_submissions','shortcut_authorizations',
                    'shortcut_link_codes','user_expense_categories')
ORDER BY c.relname,con.conname;

-- 7) Grants efectivos (CRUD + privilegios extendidos).
SELECT n.nspname AS schema_name,c.relname AS object_name,
       r.rolname AS grantee,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
       has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_references,
       has_table_privilege(r.oid,c.oid,'TRIGGER') AS can_trigger
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY c.relname,r.rolname;

-- 8) Bucket PQR: solo metadatos de configuración, nunca objetos/archivos.
SELECT id,name,public,file_size_limit,allowed_mime_types
FROM storage.buckets
WHERE id='pqr-attachments';

-- 9) Extensiones.
SELECT extname,extversion
FROM pg_extension
ORDER BY extname;

-- 10) Secuencias de aplicación: metadatos, sin leer last_value.
SELECT schemaname,sequencename,sequenceowner,data_type,
       start_value,min_value,max_value,increment_by,cycle
FROM pg_sequences
WHERE schemaname='public'
ORDER BY sequencename;

-- 11) ACL de funciones críticas. Revisar que no haya EXECUTE a PUBLIC.
SELECT n.nspname AS schema_name,p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE WHEN a.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type,a.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname='public'
  AND p.proname IN (
    'save_monthly_budget','issue_shortcut_authorization',
    'pqr_consume_rate_limit','capture_nofeki_legal_acceptance',
    'enforce_single_active_shortcut_authorization','rls_auto_enable'
  )
ORDER BY p.proname,identity_arguments,grantee;
