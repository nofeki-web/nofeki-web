-- NOFEKI PQR — ADMIN RPC COMPLETION ADDENDUM
-- CANDIDATE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- Depends on NOFEKI_PQR_ATOMIC_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql.
-- This addendum aligns the admin RPC surface with the Edge Function candidate.

begin;

-- Expand the idempotency operation discriminator for notes and notification retries.
alter table private.pqr_admin_requests
  drop constraint if exists pqr_admin_requests_operation_type_check;
alter table private.pqr_admin_requests
  add constraint pqr_admin_requests_operation_type_check
  check (operation_type in ('status_transition', 'admin_response', 'internal_note', 'notification_retry'));

-- Internal note: audit event only, no state transition and no email.
create or replace function public.pqr_admin_add_note_v2(
  p_request_key uuid,
  p_submission_id uuid,
  p_request_fingerprint text,
  p_note text,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing private.pqr_admin_requests%rowtype;
  v_inserted integer;
  v_note text := pg_catalog.btrim(p_note);
  v_actor text := pg_catalog.lower(pg_catalog.btrim(p_actor_email));
  v_event_id uuid;
  v_result jsonb;
begin
  if p_request_key is null or p_submission_id is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or v_note is null or pg_catalog.length(v_note) < 1 or pg_catalog.length(v_note) > 4000
     or v_actor is null or v_actor = '' or pg_catalog.length(v_actor) > 254 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  insert into private.pqr_admin_requests(request_id,submission_id,operation_type,request_fingerprint)
  values(p_request_key,p_submission_id,'internal_note',p_request_fingerprint)
  on conflict(request_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select r.* into v_existing from private.pqr_admin_requests r
    where r.request_id=p_request_key for update;
    if not found or v_existing.submission_id<>p_submission_id
       or v_existing.operation_type<>'internal_note'
       or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode='PT409';
    end if;
    if v_existing.result is null then
      raise exception 'request_in_progress' using errcode='PT409';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed',true);
  end if;

  perform 1 from public.pqr_submissions s where s.id=p_submission_id for update;
  if not found then raise exception 'submission_not_found' using errcode='P0002'; end if;

  insert into public.pqr_events(submission_id,actor_email,event_type,note)
  values(p_submission_id,v_actor,'internal_note',v_note)
  returning id into v_event_id;

  v_result := pg_catalog.jsonb_build_object('ok',true,'event_id',v_event_id,'submission_id',p_submission_id);
  update private.pqr_admin_requests set result=v_result,completed_at=pg_catalog.now()
  where request_id=p_request_key;
  return v_result;
end;
$$;

-- Queue a fresh applicant confirmation without sending synchronously.
-- The event_key is derived from the idempotency key and remains stable on replay.
create or replace function public.pqr_admin_retry_notification_v2(
  p_request_key uuid,
  p_submission_id uuid,
  p_request_fingerprint text,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing private.pqr_admin_requests%rowtype;
  v_inserted integer;
  v_actor text := pg_catalog.lower(pg_catalog.btrim(p_actor_email));
  v_event_id uuid;
  v_outbox_id uuid;
  v_result jsonb;
begin
  if p_request_key is null or p_submission_id is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or v_actor is null or v_actor = '' or pg_catalog.length(v_actor) > 254 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  insert into private.pqr_admin_requests(request_id,submission_id,operation_type,request_fingerprint)
  values(p_request_key,p_submission_id,'notification_retry',p_request_fingerprint)
  on conflict(request_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select r.* into v_existing from private.pqr_admin_requests r
    where r.request_id=p_request_key for update;
    if not found or v_existing.submission_id<>p_submission_id
       or v_existing.operation_type<>'notification_retry'
       or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode='PT409';
    end if;
    if v_existing.result is null then
      raise exception 'request_in_progress' using errcode='PT409';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed',true);
  end if;

  perform 1 from public.pqr_submissions s where s.id=p_submission_id for update;
  if not found then raise exception 'submission_not_found' using errcode='P0002'; end if;

  insert into public.pqr_events(submission_id,actor_email,event_type,email_status)
  values(p_submission_id,v_actor,'notification_retry',null)
  returning id into v_event_id;

  insert into private.pqr_outbox(submission_id,event_key,event_type)
  values(p_submission_id,'pqr:'||p_submission_id::text||':manual-confirmation:'||p_request_key::text,'applicant_confirmation')
  returning id into v_outbox_id;

  v_result := pg_catalog.jsonb_build_object('ok',true,'event_id',v_event_id,'outbox_id',v_outbox_id,'outbox_status','pending');
  update private.pqr_admin_requests set result=v_result,completed_at=pg_catalog.now()
  where request_id=p_request_key;
  return v_result;
end;
$$;

revoke all on function public.pqr_admin_add_note_v2(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.pqr_admin_retry_notification_v2(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pqr_admin_add_note_v2(uuid,uuid,text,text,text) to service_role;
grant execute on function public.pqr_admin_retry_notification_v2(uuid,uuid,text,text) to service_role;

commit;

-- IMPORTANT FOLLOW-UP:
-- pqr_admin_transition_status and pqr_admin_create_response are defined in the
-- base SQL candidate. The Edge Function must call those exact names/signatures.
-- Before worker deployment, extend worker completion to set
-- pqr_submissions.notification_status/notification_sent_at/notification_error
-- for applicant_confirmation events; the current worker only updates
-- pqr_events.email_status for response_sent source events.

-- Complete notification status projection for worker delivery/retry.
-- This keeps notification status independent from the PQR case status.
create or replace function public.pqr_outbox_finish(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
  v_source_event_id uuid;
  v_submission_id uuid;
  v_event_type text;
begin
  update private.pqr_outbox
  set status = 'delivered',
      provider_message_id = nullif(pg_catalog.left(p_provider_message_id, 200), ''),
      delivered_at = pg_catalog.now(),
      lock_token = null,
      locked_until = null,
      last_error_code = null,
      updated_at = pg_catalog.now()
  where id = p_outbox_id and status = 'processing' and lock_token = p_lease_token
  returning source_event_id, submission_id, event_type
  into v_source_event_id, v_submission_id, v_event_type;

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    if v_source_event_id is not null then
      update public.pqr_events
      set email_status = 'sent'
      where id = v_source_event_id and event_type = 'response_sent';
    end if;
    if v_event_type = 'applicant_confirmation' then
      update public.pqr_submissions
      set notification_status = 'sent',
          notification_sent_at = pg_catalog.now(),
          notification_error = null
      where id = v_submission_id;
    end if;
  end if;
  return v_rows = 1;
end;
$$;

create or replace function public.pqr_outbox_retry(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_delay_seconds integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_source_event_id uuid;
  v_submission_id uuid;
  v_event_type text;
begin
  if p_delay_seconds is null or p_delay_seconds < 1 or p_delay_seconds > 86400 then
    raise exception 'invalid_retry_delay' using errcode = '22023';
  end if;

  update private.pqr_outbox
  set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
      available_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_delay_seconds),
      lock_token = null,
      locked_until = null,
      last_error_code = pg_catalog.left(coalesce(p_error_code, 'provider_error'), 80),
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_outbox_id and status = 'processing' and lock_token = p_lease_token
  returning status, source_event_id, submission_id, event_type
  into v_status, v_source_event_id, v_submission_id, v_event_type;

  if v_status is not null then
    if v_source_event_id is not null then
      update public.pqr_events
      set email_status = 'failed'
      where id = v_source_event_id and event_type = 'response_sent';
    end if;
    if v_event_type = 'applicant_confirmation' then
      update public.pqr_submissions
      set notification_status = 'failed',
          notification_sent_at = null,
          notification_error = 'No fue posible enviar el correo'
      where id = v_submission_id;
    end if;
  end if;
  return coalesce(v_status, 'stale_lease');
end;
$$;

revoke all on function public.pqr_outbox_finish(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pqr_outbox_retry(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pqr_outbox_finish(uuid,uuid,text) to service_role;
grant execute on function public.pqr_outbox_retry(uuid,uuid,text,integer) to service_role;
