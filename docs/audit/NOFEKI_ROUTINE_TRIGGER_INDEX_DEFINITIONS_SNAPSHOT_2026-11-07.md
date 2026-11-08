# NOFEKI — snapshot de definiciones PostgreSQL recuperadas (catálogo live)

**Fecha de consulta:** 2026-11-07  
**Proyecto consultado:** `bxjgodhqseoxrnshqtfr`  
**Alcance:** consultas SELECT de catálogo; no se ejecutó DDL ni se modificó producción.  
**Advertencia:** snapshot textual de definiciones actuales, no un backup completo ni una restauración validada.

## 1. Rutinas: atributos y ACL observadas

| Rutina | Owner | Lenguaje | SECURITY DEFINER | Volatility | search_path | ACL efectiva observada |
|---|---|---|---|---|---|---|
| capture_nofeki_legal_acceptance() | postgres | plpgsql | sí | volatile | vacío | postgres EXECUTE |
| enforce_single_active_shortcut_authorization() | postgres | plpgsql | sí | volatile | public | postgres EXECUTE |
| issue_shortcut_authorization(uuid,text,text,timestamptz) | postgres | plpgsql | no | volatile | vacío | postgres, service_role EXECUTE |
| pqr_consume_rate_limit(text,int,int) | postgres | plpgsql | no | volatile | vacío | postgres, service_role EXECUTE |
| rls_auto_enable() | postgres | plpgsql | sí | volatile | pg_catalog | postgres EXECUTE |
| save_monthly_budget(date,text,numeric,numeric,numeric,jsonb) | postgres | plpgsql | no | volatile | vacío | postgres, authenticated EXECUTE |

No se observó EXECUTE para anon en estas rutinas. Las ACL indicadas son las devueltas por el catálogo; deben volver a compararse en cualquier restauración.

## 2. Definiciones exactas devueltas por pg_get_functiondef

### 2.1 capture_nofeki_legal_acceptance()

```sql
CREATE OR REPLACE FUNCTION public.capture_nofeki_legal_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  metadata jsonb;
begin
  metadata := new.raw_user_meta_data;

  if metadata ? 'nofeki_terms_version'
     and metadata ? 'nofeki_terms_accepted_at'
     and metadata ? 'nofeki_privacy_version'
     and metadata ? 'nofeki_privacy_authorized_at'
     and coalesce(metadata ->> 'nofeki_terms_version', '') <> ''
     and coalesce(metadata ->> 'nofeki_privacy_version', '') <> '' then
    insert into public.legal_acceptance_audit (
      user_id,
      terms_version,
      terms_accepted_at,
      privacy_version,
      privacy_authorized_at
    ) values (
      new.id,
      metadata ->> 'nofeki_terms_version',
      (metadata ->> 'nofeki_terms_accepted_at')::timestamptz,
      metadata ->> 'nofeki_privacy_version',
      (metadata ->> 'nofeki_privacy_authorized_at')::timestamptz
    )
    on conflict do nothing;
  end if;

  return new;
end;
$function$;
```

**Nota de seguridad:** la rutina registra metadatos de aceptación; `raw_user_meta_data` es editable por el usuario y no debe usarse como autoridad de autorización. La rutina observada no toma decisiones de permisos.

### 2.2 enforce_single_active_shortcut_authorization()

```sql
CREATE OR REPLACE FUNCTION public.enforce_single_active_shortcut_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.shortcut_authorizations
     set revoked_at = now()
   where user_id = new.user_id
     and revoked_at is null
     and id <> new.id;
  return new;
end;
$function$;
```

### 2.3 issue_shortcut_authorization(uuid,text,text,timestamptz)

```sql
CREATE OR REPLACE FUNCTION public.issue_shortcut_authorization(p_user_id uuid, p_token_hash text, p_device_name text, p_expires_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_user_id is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= pg_catalog.now()
     or pg_catalog.length(coalesce(p_device_name,'')) > 80 then
    raise exception 'invalid authorization arguments';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  update public.shortcut_authorizations
     set revoked_at = pg_catalog.now()
   where user_id = p_user_id
     and revoked_at is null
     and expires_at <= pg_catalog.now();

  if exists (
    select 1 from public.shortcut_authorizations
     where user_id = p_user_id
       and revoked_at is null
       and expires_at > pg_catalog.now()
  ) then
    return false;
  end if;

  insert into public.shortcut_authorizations
    (user_id, token_hash, device_name, expires_at)
  values
    (p_user_id, p_token_hash, coalesce(nullif(pg_catalog.btrim(p_device_name),''),'iPhone NOFEKI'), p_expires_at);

  return true;
end;
$function$;
```

### 2.4 pqr_consume_rate_limit(text,int,int)

```sql
CREATE OR REPLACE FUNCTION public.pqr_consume_rate_limit(p_source_hash text, p_limit integer DEFAULT 5, p_window_seconds integer DEFAULT 3600)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_limit > 100
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.pqr_rate_limits(source_hash, window_started_at, request_count, updated_at)
  values (p_source_hash, pg_catalog.now(), 1, pg_catalog.now())
  on conflict (source_hash) do update
    set window_started_at = case
          when public.pqr_rate_limits.window_started_at <= pg_catalog.now() - (p_window_seconds * interval '1 second')
          then pg_catalog.now()
          else public.pqr_rate_limits.window_started_at
        end,
        request_count = case
          when public.pqr_rate_limits.window_started_at <= pg_catalog.now() - (p_window_seconds * interval '1 second')
          then 1
          else public.pqr_rate_limits.request_count + 1
        end,
        updated_at = pg_catalog.now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$function$;
```

### 2.5 rls_auto_enable()

```sql
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
```

### 2.6 save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)

```sql
CREATE OR REPLACE FUNCTION public.save_monthly_budget(p_period_month date, p_mode text, p_income_amount numeric, p_expense_limit numeric, p_savings_target numeric, p_categories jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_budget_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;
  if p_period_month is null or extract(day from p_period_month) <> 1 then
    raise exception 'invalid_budget_period';
  end if;
  if p_mode not in ('income', 'manual') then
    raise exception 'invalid_budget_mode';
  end if;
  if p_expense_limit is null or p_expense_limit < 0
     or coalesce(p_savings_target, 0) < 0
     or (p_mode = 'income' and (p_income_amount is null or p_income_amount < 0))
     or (p_mode = 'manual' and (p_income_amount is not null or coalesce(p_savings_target,0) <> 0)) then
    raise exception 'invalid_budget_amounts';
  end if;
  if p_categories is null or jsonb_typeof(p_categories) <> 'array'
     or jsonb_array_length(p_categories) = 0 then
    raise exception 'budget_categories_required';
  end if;

  insert into public.budgets (
    user_id, period_month, mode, income_amount, expense_limit, savings_target, updated_at
  )
  values (
    v_user_id, p_period_month, p_mode, p_income_amount, p_expense_limit,
    coalesce(p_savings_target, 0), now()
  )
  on conflict (user_id, period_month)
  do update set
    mode = excluded.mode,
    income_amount = excluded.income_amount,
    expense_limit = excluded.expense_limit,
    savings_target = excluded.savings_target,
    updated_at = now()
  returning id into v_budget_id;

  delete from public.budget_categories
  where budget_id = v_budget_id and user_id = v_user_id;

  insert into public.budget_categories (budget_id, user_id, category_name, planned_amount)
  select
    v_budget_id,
    v_user_id,
    x.category_name,
    x.planned_amount
  from jsonb_to_recordset(p_categories) as x(category_name text, planned_amount numeric);

  return v_budget_id;
end;
$function$;
```

## 3. Triggers, event trigger e índice capturados

### Trigger legal

- Nombre: `nofeki_capture_legal_acceptance`
- Tabla: `auth.users`
- Evento: AFTER INSERT, FOR EACH ROW
- Función: `capture_nofeki_legal_acceptance()`
- Owner de tabla: `supabase_auth_admin`
- Estado: enabled (`O`)

Definición devuelta:

```sql
CREATE TRIGGER nofeki_capture_legal_acceptance AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION capture_nofeki_legal_acceptance();
```

### Trigger de autorización única

- Nombre: `trg_single_active_shortcut_authorization`
- Tabla: `public.shortcut_authorizations`
- Evento: AFTER INSERT, FOR EACH ROW
- Función: `enforce_single_active_shortcut_authorization()`
- Estado: enabled (`O`)

Definición devuelta:

```sql
CREATE TRIGGER trg_single_active_shortcut_authorization AFTER INSERT ON shortcut_authorizations FOR EACH ROW EXECUTE FUNCTION enforce_single_active_shortcut_authorization();
```

### Event trigger ensure_rls

- Nombre: `ensure_rls`
- Evento: `ddl_command_end`
- Tags: `CREATE TABLE, CREATE TABLE AS, SELECT INTO`
- Función: `rls_auto_enable()`
- Owner: postgres
- Estado: enabled (`O`)

El catálogo consultado no ofrece `pg_get_event_triggerdef(oid)` en esta versión. Se capturaron los campos de `pg_event_trigger` directamente; la restauración debe reconstruir el comando con esos atributos y verificarlo aislada.

### Índice adicional de categorías

```sql
CREATE INDEX budget_categories_budget_user_fk_idx ON public.budget_categories USING btree (budget_id, user_id);
```

## 4. Pendientes para cerrar el snapshot

- Obtener el catálogo completo de extensiones, sequences y default privileges.
- Capturar la lista completa de policies y ACL por objeto con sus comandos exactos.
- Confirmar todas las FK/constraints e índices (no solo los conocidos en reconciliación).
- Obtener checksums de definiciones normalizadas y asociarlos al commit.
- Validar estas definiciones en una instancia aislada antes de convertirlas en scripts de restauración.

## 5. Limitaciones

Este archivo conserva la salida del catálogo para las rutinas consultadas y los triggers/index identificados. No incluye datos de negocio, usuarios, tokens, códigos, secretos ni adjuntos. No debe ejecutarse directamente como un script de recuperación: owner, dependencias, grants, tablas y políticas deben existir y coincidir primero.
