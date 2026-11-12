-- NOFEKI PQR — audited reconciliation for uncertain Outbox events
-- CANDIDATE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- Requires the Outbox candidate schema/RPCs to be validated first.
--
-- Security boundary:
--   * Called only by the authenticated pqr-admin Edge Function after it
--     validates the current admin allowlist.
--   * Browser clients never call this RPC directly.
--   * service_role only; actor identity/reason are audit inputs from the
--     trusted Edge Function, not trusted browser fields.
--
-- Actions:
--   confirm_delivered: admin has independently verified provider acceptance
--     and supplies the provider message ID. No email is sent.
--   authorize_retry: admin has independently verified non-acceptance and
--     records the evidence/reason. Rotates event_key and clears the provider
--     window so a single new attempt can be queued. This is NOT safe unless
--     non-acceptance is positively established.
--
-- No automatic retry of uncertain rows. No direct provider call.

begin;

create table if not exists private.pqr_outbox_reconciliation_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  action_id uuid not null unique,
  outbox_id uuid not null references private.pqr_outbox(id) on delete restrict,
  action text not null check (action in ('confirm_delivered', 'authorize_retry')),
  previous_status text not null,
  resulting_status text not null,
  previous_event_key text not null,
  resulting_event_key text not null,
  provider_message_id text,
  actor_email text not null,
  reason text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint pqr_outbox_reconciliation_reason_check
    check (pg_catalog.length(pg_catalog.btrim(reason)) between 10 and 2000),
  constraint pqr_outbox_reconciliation_actor_check
    check (pg_catalog.length(pg_catalog.btrim(actor_email)) between 3 and 320)
);

alter table private.pqr_outbox_reconciliation_audit enable row level security;
revoke all on private.pqr_outbox_reconciliation_audit from public, anon, authenticated;
grant select, insert on private.pqr_outbox_reconciliation_audit to service_role;

create or replace function public.pqr_outbox_reconcile_uncertain(
  p_outbox_id uuid,
  p_action_id uuid,
  p_action text,
  p_actor_email text,
  p_reason text,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row private.pqr_outbox%rowtype;
  v_new_key text;
  v_result jsonb;
begin
  if p_outbox_id is null or p_action_id is null
     or p_action not in ('confirm_delivered', 'authorize_retry')
     or p_action is null
     or p_actor_email is null
     or pg_catalog.length(pg_catalog.btrim(p_actor_email)) not between 3 and 320
     or p_reason is null
     or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 10 and 2000 then
    raise exception 'invalid_reconciliation_request' using errcode = '22023';
  end if;

  if p_action = 'confirm_delivered'
     and (p_provider_message_id is null
          or pg_catalog.length(pg_catalog.btrim(p_provider_message_id)) not between 1 and 200) then
    raise exception 'provider_message_id_required' using errcode = '22023';
  end if;

  if p_action = 'authorize_retry' and p_provider_message_id is not null then
    raise exception 'provider_message_id_not_allowed_for_retry' using errcode = '22023';
  end if;

  -- Idempotent administrative action: same action_id returns the stored
  -- result, and cannot apply a second transition.
  select pg_catalog.jsonb_build_object(
    'outbox_id', a.outbox_id,
    'action', a.action,
    'status', a.resulting_status,
    'event_key', a.resulting_event_key,
    'replayed', true
  )
  into v_result
  from private.pqr_outbox_reconciliation_audit as a
  where a.action_id = p_action_id;

  if v_result is not null then
    if not exists (
      select 1 from private.pqr_outbox_reconciliation_audit as a
      where a.action_id = p_action_id
        and a.outbox_id = p_outbox_id
        and a.action = p_action
        and a.actor_email = p_actor_email
        and a.reason = p_reason
        and a.provider_message_id is not distinct from p_provider_message_id
    ) then
      raise exception 'reconciliation_action_id_conflict' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select * into v_row
  from private.pqr_outbox
  where id = p_outbox_id
  for update;

  if not found or v_row.status <> 'uncertain' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_uncertain');
  end if;

  if p_action = 'confirm_delivered' then
    update private.pqr_outbox
    set status = 'delivered',
        provider_message_id = pg_catalog.left(pg_catalog.btrim(p_provider_message_id), 200),
        delivered_at = coalesce(delivered_at, pg_catalog.now()),
        lock_token = null,
        locked_until = null,
        last_error_code = null,
        updated_at = pg_catalog.now()
    where id = p_outbox_id and status = 'uncertain';

    if v_row.source_event_id is not null then
      update public.pqr_events
      set email_status = 'sent'
      where id = v_row.source_event_id and event_type = 'response_sent';
    end if;

    insert into private.pqr_outbox_reconciliation_audit (
      action_id, outbox_id, action, previous_status, resulting_status,
      previous_event_key, resulting_event_key, provider_message_id,
      actor_email, reason
    ) values (
      p_action_id, p_outbox_id, p_action, 'uncertain', 'delivered',
      v_row.event_key, v_row.event_key,
      pg_catalog.left(pg_catalog.btrim(p_provider_message_id), 200),
      pg_catalog.lower(pg_catalog.btrim(p_actor_email)),
      pg_catalog.btrim(p_reason)
    );

    return pg_catalog.jsonb_build_object(
      'ok', true, 'outbox_id', p_outbox_id,
      'status', 'delivered', 'event_key', v_row.event_key, 'replayed', false
    );
  end if;

  -- A new provider key is permitted only after an administrator has
  -- positively verified that the previous request was NOT accepted.
  -- The audit reason must record the verification source/reference.
  v_new_key := v_row.event_key || ':manual:' || p_action_id::text;

  update private.pqr_outbox
  set status = 'pending',
      event_key = v_new_key,
      attempts = 0,
      first_provider_attempt_at = null,
      available_at = pg_catalog.now(),
      lock_token = null,
      locked_until = null,
      last_error_code = 'admin_authorized_retry',
      last_error_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_outbox_id and status = 'uncertain';

  if v_row.source_event_id is not null then
    update public.pqr_events
    set email_status = 'failed'
    where id = v_row.source_event_id and event_type = 'response_sent';
  end if;

  insert into private.pqr_outbox_reconciliation_audit (
    action_id, outbox_id, action, previous_status, resulting_status,
    previous_event_key, resulting_event_key, provider_message_id,
    actor_email, reason
  ) values (
    p_action_id, p_outbox_id, p_action, 'uncertain', 'pending',
    v_row.event_key, v_new_key, null,
    pg_catalog.lower(pg_catalog.btrim(p_actor_email)),
    pg_catalog.btrim(p_reason)
  );

  return pg_catalog.jsonb_build_object(
    'ok', true, 'outbox_id', p_outbox_id,
    'status', 'pending', 'event_key', v_new_key, 'replayed', false
  );
end;
$$;

revoke all on function public.pqr_outbox_reconcile_uncertain(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.pqr_outbox_reconcile_uncertain(uuid,uuid,text,text,text,text)
  to service_role;

commit;

-- END CANDIDATE. Requires isolated PostgreSQL 17 compile, ACL, concurrency,
-- idempotency, rollback and admin-authorization tests before integration.
