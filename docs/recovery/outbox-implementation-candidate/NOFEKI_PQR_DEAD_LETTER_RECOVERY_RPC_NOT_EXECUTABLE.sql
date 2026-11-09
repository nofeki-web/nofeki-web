-- NOFEKI PQR — MANUAL DEAD-LETTER RECOVERY RPC
-- CANDIDATE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- Requires base Outbox SQL + admin RPC completion addendum.
-- Resend idempotency retention is 24h. Beyond that, require manual provider reconciliation.
begin;
create or replace function public.pqr_admin_retry_dead_outbox_v1(
  p_request_key uuid, p_outbox_id uuid, p_submission_id uuid, p_request_fingerprint text,
  p_actor_email text, p_confirmed_not_sent boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing private.pqr_admin_requests%rowtype;
  v_inserted integer;
  v_old private.pqr_outbox%rowtype;
  v_actor text := pg_catalog.lower(pg_catalog.btrim(p_actor_email));
  v_audit_event_id uuid;
  v_new_outbox_id uuid;
  v_new_event_key text;
  v_result jsonb;
begin
  if p_request_key is null or p_outbox_id is null or p_submission_id is null or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or v_actor is null or v_actor = '' or pg_catalog.length(v_actor) > 254
     or p_confirmed_not_sent is distinct from true then
    raise exception 'invalid_recovery_confirmation' using errcode = '22023';
  end if;
  select o.* into v_old from private.pqr_outbox o where o.id=p_outbox_id for update;
  if not found or v_old.submission_id <> p_submission_id then
    raise exception 'outbox_not_found' using errcode='P0002';
  end if;
  insert into private.pqr_admin_requests(request_id,submission_id,operation_type,request_fingerprint)
  values(p_request_key,p_submission_id,'notification_retry',p_request_fingerprint)
  on conflict(request_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select r.* into v_existing from private.pqr_admin_requests r
    where r.request_id=p_request_key for update;
    if not found or v_existing.operation_type <> 'notification_retry'
       or v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode='PT409';
    end if;
    if v_existing.result is null then raise exception 'request_in_progress' using errcode='PT409'; end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed',true);
  end if;
  if v_old.status <> 'dead' then raise exception 'outbox_not_dead' using errcode='PT409'; end if;
  if v_old.provider_message_id is not null then raise exception 'provider_already_confirmed_delivery' using errcode='PT409'; end if;
  if v_old.event_type='admin_response' and v_old.source_event_id is null then
    raise exception 'response_source_missing' using errcode='PT409';
  end if;
  insert into public.pqr_events(submission_id,actor_email,event_type,note,email_status)
  values(v_old.submission_id,v_actor,'notification_retry',
    'Reintento manual autorizado tras verificar en Resend que el mensaje no fue enviado. Outbox original: '||v_old.id::text,null)
  returning id into v_audit_event_id;
  v_new_event_key := 'pqr:'||v_old.submission_id::text||':manual-retry:'||p_request_key::text;
  insert into private.pqr_outbox(submission_id,source_event_id,event_key,event_type,max_attempts)
  values(v_old.submission_id,v_old.source_event_id,v_new_event_key,v_old.event_type,5)
  returning id into v_new_outbox_id;
  v_result := pg_catalog.jsonb_build_object('ok',true,'old_outbox_id',v_old.id,
    'outbox_id',v_new_outbox_id,'event_type',v_old.event_type,'outbox_status','pending',
    'audit_event_id',v_audit_event_id,'manual_provider_reconciliation',true);
  update private.pqr_admin_requests set result=v_result,completed_at=pg_catalog.now()
  where request_id=p_request_key;
  return v_result;
end; $$;
revoke all on function public.pqr_admin_retry_dead_outbox_v1(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.pqr_admin_retry_dead_outbox_v1(uuid,uuid,uuid,text,text,boolean) to service_role;
commit;
-- END CANDIDATE. Compile and test in disposable PostgreSQL before integration.