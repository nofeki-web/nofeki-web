-- NOFEKI PQR — SQL DE REFERENCIA, NO EJECUTAR
-- Fecha: 2026-11-08
-- Destino deliberado: docs/audit/reference-sql/ (NO es una migración).
-- Requiere revisión de esquema, ejecución aislada, pruebas de concurrencia y aprobación.
-- No ejecutar en producción. No copiar a supabase/migrations/ sin aprobación.

begin;

create table public.pqr_email_operations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.pqr_submissions(id) on delete restrict,
  operation_type text not null check (operation_type in (
    'response','initial_confirmation','internal_notification','retry_notification'
  )),
  idempotency_key uuid not null unique,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'reserved' check (status in (
    'reserved','sending','sent','failed','uncertain'
  )),
  parent_operation_id uuid null references public.pqr_email_operations(id) on delete restrict,
  provider_message_id text null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  constraint pqr_email_retry_parent_check check (
    (operation_type = 'retry_notification' and parent_operation_id is not null)
    or (operation_type <> 'retry_notification' and parent_operation_id is null)
  )
);

create index pqr_email_operations_submission_created_idx
  on public.pqr_email_operations(submission_id, created_at desc);
create index pqr_email_operations_status_updated_idx
  on public.pqr_email_operations(status, updated_at);

alter table public.pqr_email_operations enable row level security;
revoke all on public.pqr_email_operations from public, anon, authenticated;
grant select, insert, update on public.pqr_email_operations to service_role;

-- La reserva es atómica: solo el proceso que inserta por primera vez recibe claimed.
-- Una clave repetida nunca autoriza un segundo envío.
create or replace function public.pqr_claim_email_operation(
  p_submission_id uuid,
  p_operation_type text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_created_by text,
  p_parent_operation_id uuid default null
)
returns table (decision text, operation_id uuid, current_status text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_id uuid;
  v_hash text;
  v_status text;
begin
  if p_operation_type not in ('response','initial_confirmation','internal_notification','retry_notification')
     or p_payload_hash !~ '^[0-9a-f]{64}$'
     or coalesce(length(trim(p_created_by)), 0) = 0 then
    raise exception 'invalid_operation_input' using errcode = '22023';
  end if;
  if (p_operation_type = 'retry_notification') <> (p_parent_operation_id is not null) then
    raise exception 'invalid_retry_parent' using errcode = '22023';
  end if;

  insert into public.pqr_email_operations (
    submission_id, operation_type, idempotency_key, payload_hash,
    status, parent_operation_id, created_by
  )
  values (
    p_submission_id, p_operation_type, p_idempotency_key, p_payload_hash,
    'sending', p_parent_operation_id, p_created_by
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    update public.pqr_email_operations e
       set attempt_count = 1, updated_at = now()
     where e.id = v_id;
    return query select 'claimed'::text, v_id, 'sending'::text;
    return;
  end if;

  select e.id, e.payload_hash, e.status
    into v_id, v_hash, v_status
    from public.pqr_email_operations e
   where e.idempotency_key = p_idempotency_key
   for update;

  if not found then
    raise exception 'idempotency_claim_race_retry' using errcode = '40001';
  end if;
  if v_hash <> p_payload_hash then
    return query select 'key_conflict'::text, v_id, v_status;
  elsif v_status = 'sent' then
    return query select 'already_sent'::text, v_id, v_status;
  elsif v_status in ('sending','reserved') then
    return query select 'in_progress'::text, v_id, v_status;
  elsif v_status = 'uncertain' then
    return query select 'uncertain'::text, v_id, v_status;
  else
    return query select 'failed'::text, v_id, v_status;
  end if;
end;
$function$;

-- Solo registra resultados definitivos/ambiguos; nunca reabre una operación.
create or replace function public.pqr_finish_email_operation(
  p_operation_id uuid,
  p_final_status text,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if p_final_status not in ('sent','failed','uncertain') then
    raise exception 'invalid_final_status' using errcode = '22023';
  end if;

  update public.pqr_email_operations e
     set status = p_final_status,
         provider_message_id = case when p_final_status = 'sent' then p_provider_message_id else null end,
         last_error_code = case when p_final_status = 'sent' then null else left(coalesce(p_error_code,''),120) end,
         sent_at = case when p_final_status = 'sent' then now() else null end,
         updated_at = now()
   where e.id = p_operation_id
     and e.status = 'sending';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

-- Actualiza el estado de la PQR y escribe su evento en la misma transacción.
create or replace function public.pqr_set_submission_status_with_event(
  p_submission_id uuid,
  p_new_status text,
  p_actor_email text,
  p_note text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_old_status text;
begin
  if p_new_status not in ('Recibida','En revisión','En gestión','Respondida','Cerrada')
     or coalesce(length(trim(p_actor_email)),0) = 0 then
    raise exception 'invalid_status_event_input' using errcode = '22023';
  end if;

  select s.status into v_old_status
    from public.pqr_submissions s
   where s.id = p_submission_id
   for update;
  if not found then return false; end if;

  update public.pqr_submissions s
     set status = p_new_status,
         updated_at = now(),
         responded_at = case when p_new_status = 'Respondida'
                             then coalesce(s.responded_at, now())
                             else s.responded_at end
   where s.id = p_submission_id;

  insert into public.pqr_events (
    submission_id, actor_email, event_type, old_status, new_status, note
  ) values (
    p_submission_id, p_actor_email, 'status_changed',
    v_old_status, p_new_status, nullif(left(coalesce(p_note,''),2000),'')
  );

  return true;
end;
$function$;

revoke all on function public.pqr_claim_email_operation(uuid,text,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.pqr_finish_email_operation(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.pqr_set_submission_status_with_event(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.pqr_claim_email_operation(uuid,text,uuid,text,text,uuid) to service_role;
grant execute on function public.pqr_finish_email_operation(uuid,text,text,text) to service_role;
grant execute on function public.pqr_set_submission_status_with_event(uuid,text,text,text) to service_role;

comment on table public.pqr_email_operations is
  'Registro interno de idempotencia de correos PQR. No exponer a clientes.';

rollback;

-- Fin del borrador. BEGIN/ROLLBACK solo protegen una ejecución accidental en una
-- sesión SQL; NO convierten este archivo en una migración ni sustituyen revisión.
