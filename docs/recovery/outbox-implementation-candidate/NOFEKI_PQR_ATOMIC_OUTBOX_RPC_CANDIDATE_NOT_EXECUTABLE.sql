-- NOFEKI PQR — COMPLETE ADMIN RPC + OUTBOX CANDIDATE
-- REFERENCE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- Target schema inspected 2026-11-08; PostgreSQL 17.11.
--
-- Prerequisites verified in the recovery audit:
--   public.pqr_submissions exists with current five status values.
--   public.pqr_events exists with event_type values:
--     status_changed, internal_note, response_sent, notification_retry.
--   pqr_events.response and actor_email exist.
--   service_role has table privileges on the current PQR tables.
--
-- This candidate is additive. It does not modify deployed Edge Functions,
-- HTML, Auth, Storage, secrets, or production data.
--
-- SECURITY:
--   * private tables are not intended for Data API exposure.
--   * RLS enabled; no client grants.
--   * public RPCs are SECURITY INVOKER, empty search_path, qualified names.
--   * only service_role may execute RPCs / access private schema.
--   * Edge Function must authenticate user + verify current allowlist before
--     passing the actor identity. Never call these RPCs from browser code.
--
-- IMPORTANT:
--   * This file requires an isolated PostgreSQL/Supabase test database.
--   * Do not copy into supabase/migrations until tests and review pass.
--   * No SQL in this file has been executed.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.pqr_submissions
  add column if not exists version bigint not null default 1;

create table if not exists private.pqr_admin_requests (
  request_id uuid primary key,
  submission_id uuid not null references public.pqr_submissions(id) on delete restrict,
  operation_type text not null
    check (operation_type in ('status_transition', 'admin_response')),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint pqr_admin_requests_completion_check
    check ((result is null and completed_at is null)
        or (result is not null and completed_at is not null))
);

create index if not exists pqr_admin_requests_submission_created_idx
  on private.pqr_admin_requests (submission_id, created_at desc);

create table if not exists private.pqr_outbox (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  submission_id uuid not null references public.pqr_submissions(id) on delete restrict,
  source_event_id uuid references public.pqr_events(id) on delete restrict,
  event_key text not null unique,
  event_type text not null
    check (event_type in ('applicant_confirmation', 'internal_alert', 'admin_response')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 25),
  available_at timestamptz not null default pg_catalog.now(),
  locked_until timestamptz,
  lock_token uuid,
  provider_message_id text,
  last_error_code text,
  last_error_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint pqr_outbox_processing_lease_check check (
    (status = 'processing' and lock_token is not null and locked_until is not null)
    or
    (status <> 'processing' and lock_token is null and locked_until is null)
  ),
  constraint pqr_outbox_admin_response_source_check check (
    event_type <> 'admin_response' or source_event_id is not null
  )
);

alter table private.pqr_outbox
  add column if not exists source_event_id uuid references public.pqr_events(id) on delete restrict;

alter table private.pqr_outbox
  drop constraint if exists pqr_outbox_admin_response_source_check;
alter table private.pqr_outbox
  add constraint pqr_outbox_admin_response_source_check
  check (event_type <> 'admin_response' or source_event_id is not null);

create index if not exists pqr_outbox_ready_idx
  on private.pqr_outbox (available_at, created_at)
  where status = 'pending';

create index if not exists pqr_outbox_expired_lease_idx
  on private.pqr_outbox (locked_until)
  where status = 'processing';

create index if not exists pqr_outbox_submission_idx
  on private.pqr_outbox (submission_id, created_at desc);

alter table private.pqr_admin_requests enable row level security;
alter table private.pqr_outbox enable row level security;

revoke all on private.pqr_admin_requests, private.pqr_outbox
  from public, anon, authenticated;
grant select, insert, update on private.pqr_admin_requests, private.pqr_outbox
  to service_role;

-- Keep the existing PQR table model; backend-only privileges remain explicit.
revoke all on public.pqr_submissions, public.pqr_events
  from anon, authenticated;
grant select, insert, update on public.pqr_submissions, public.pqr_events
  to service_role;

-- Atomic status transition. The unique request_id row serializes duplicate
-- requests. The submission row lock serializes competing admin actions.
create or replace function public.pqr_admin_transition_status(
  p_submission_id uuid,
  p_expected_status text,
  p_expected_version bigint,
  p_target_status text,
  p_request_id uuid,
  p_request_fingerprint text,
  p_actor_email text,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing private.pqr_admin_requests%rowtype;
  v_inserted integer;
  v_submission public.pqr_submissions%rowtype;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_actor text := pg_catalog.lower(pg_catalog.btrim(p_actor_email));
  v_result jsonb;
  v_event_id uuid;
begin
  if p_submission_id is null or p_request_id is null
     or p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_fingerprint' using errcode = '22023';
  end if;
  if v_actor is null or v_actor = '' or pg_catalog.length(v_actor) > 254 then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;
  if p_expected_status is null or p_target_status is null
     or p_expected_status not in ('Recibida','En revisión','En gestión','Respondida','Cerrada')
     or p_target_status not in ('Recibida','En revisión','En gestión','Respondida','Cerrada') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into private.pqr_admin_requests
    (request_id, submission_id, operation_type, request_fingerprint)
  values
    (p_request_id, p_submission_id, 'status_transition', p_request_fingerprint)
  on conflict (request_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select r.* into v_existing
    from private.pqr_admin_requests as r
    where r.request_id = p_request_id
    for update;

    if not found
       or v_existing.submission_id <> p_submission_id
       or v_existing.operation_type <> 'status_transition'
       or v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode = 'PT409';
    end if;
    if v_existing.result is null then
      raise exception 'request_in_progress' using errcode = 'PT409';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select s.* into v_submission
  from public.pqr_submissions as s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if v_submission.status <> p_expected_status
     or v_submission.version <> p_expected_version then
    raise exception 'stale_submission_version' using errcode = 'PT409';
  end if;

  if p_target_status = v_submission.status then
    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'noop', true, 'submission_id', p_submission_id,
      'status', v_submission.status, 'version', v_submission.version
    );
  else
    if not (
      (v_submission.status = 'Recibida' and p_target_status = 'En revisión')
      or (v_submission.status = 'En revisión' and p_target_status = 'En gestión')
      or (v_submission.status = 'En gestión' and p_target_status = 'Respondida')
      or (v_submission.status = 'Respondida' and p_target_status = 'Cerrada')
      or (v_submission.status = 'Respondida' and p_target_status = 'En gestión'
          and v_reason is not null)
    ) then
      raise exception 'transition_not_allowed' using errcode = 'PT422';
    end if;

    -- Respondida may only be set by pqr_admin_create_response, which writes
    -- the formal response event and Outbox row atomically.
    if p_target_status = 'Respondida' then
      raise exception 'use_admin_response_operation' using errcode = 'PT422';
    end if;

    update public.pqr_submissions
    set status = p_target_status,
        version = version + 1,
        updated_at = pg_catalog.now()
    where id = p_submission_id
    returning * into v_submission;

    insert into public.pqr_events
      (submission_id, actor_email, event_type, old_status, new_status, note)
    values
      (p_submission_id, v_actor, 'status_changed',
       p_expected_status, p_target_status, v_reason)
    returning id into v_event_id;

    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'noop', false, 'submission_id', p_submission_id,
      'old_status', p_expected_status, 'new_status', p_target_status,
      'version', v_submission.version, 'event_id', v_event_id
    );
  end if;

  update private.pqr_admin_requests
  set result = v_result, completed_at = pg_catalog.now()
  where request_id = p_request_id;

  return v_result;
end;
$$;

-- A formal response and its notification intent are committed together.
-- No email is sent from this RPC.
create or replace function public.pqr_admin_create_response(
  p_submission_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_request_fingerprint text,
  p_actor_email text,
  p_response text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing private.pqr_admin_requests%rowtype;
  v_inserted integer;
  v_submission public.pqr_submissions%rowtype;
  v_actor text := pg_catalog.lower(pg_catalog.btrim(p_actor_email));
  v_response text := pg_catalog.btrim(p_response);
  v_event_id uuid;
  v_outbox_id uuid;
  v_event_key text;
  v_result jsonb;
begin
  if p_submission_id is null or p_request_id is null
     or p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_fingerprint' using errcode = '22023';
  end if;
  if v_actor is null or v_actor = '' or pg_catalog.length(v_actor) > 254 then
    raise exception 'invalid_actor' using errcode = '22023';
  end if;
  if v_response is null or pg_catalog.length(v_response) < 5
     or pg_catalog.length(v_response) > 5000 then
    raise exception 'invalid_response' using errcode = '22023';
  end if;

  insert into private.pqr_admin_requests
    (request_id, submission_id, operation_type, request_fingerprint)
  values
    (p_request_id, p_submission_id, 'admin_response', p_request_fingerprint)
  on conflict (request_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select r.* into v_existing
    from private.pqr_admin_requests as r
    where r.request_id = p_request_id
    for update;

    if not found
       or v_existing.submission_id <> p_submission_id
       or v_existing.operation_type <> 'admin_response'
       or v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode = 'PT409';
    end if;
    if v_existing.result is null then
      raise exception 'request_in_progress' using errcode = 'PT409';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select s.* into v_submission
  from public.pqr_submissions as s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if v_submission.status <> 'En gestión'
     or v_submission.version <> p_expected_version then
    raise exception 'stale_submission_version' using errcode = 'PT409';
  end if;

  insert into public.pqr_events
    (submission_id, actor_email, event_type, old_status, new_status, response, email_status)
  values
    (p_submission_id, v_actor, 'response_sent',
     v_submission.status, 'Respondida', v_response, null)
  returning id into v_event_id;

  v_event_key := 'pqr:' || p_submission_id::text || ':response:' || v_event_id::text;

  insert into private.pqr_outbox
    (submission_id, source_event_id, event_key, event_type)
  values
    (p_submission_id, v_event_id, v_event_key, 'admin_response')
  returning id into v_outbox_id;

  update public.pqr_submissions
  set status = 'Respondida',
      responded_at = pg_catalog.now(),
      updated_at = pg_catalog.now(),
      version = version + 1
  where id = p_submission_id
  returning * into v_submission;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'submission_id', p_submission_id,
    'status', 'Respondida', 'version', v_submission.version,
    'event_id', v_event_id, 'outbox_id', v_outbox_id,
    'outbox_status', 'pending'
  );

  update private.pqr_admin_requests
  set result = v_result, completed_at = pg_catalog.now()
  where request_id = p_request_id;

  return v_result;
end;
$$;

-- Claim worker batch with SKIP LOCKED and a fresh fencing token.
create or replace function public.pqr_outbox_claim(
  p_batch_size integer default 10,
  p_lease_seconds integer default 90
)
returns table (
  outbox_id uuid,
  submission_id uuid,
  source_event_id uuid,
  event_key text,
  event_type text,
  lease_token uuid,
  attempt_number integer,
  lease_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 25 then
    raise exception 'invalid_batch_size' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'invalid_lease_seconds' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from private.pqr_outbox as o
    where (o.status = 'pending' and o.available_at <= pg_catalog.now())
       or (o.status = 'processing' and o.locked_until <= pg_catalog.now())
    order by o.available_at, o.created_at
    for update skip locked
    limit p_batch_size
  ),
  claimed as (
    update private.pqr_outbox as o
    set status = 'processing',
        attempts = o.attempts + 1,
        lock_token = pg_catalog.gen_random_uuid(),
        locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.now()
    from candidates as c
    where o.id = c.id
    returning o.id, o.submission_id, o.source_event_id, o.event_key,
              o.event_type, o.lock_token, o.attempts, o.locked_until
  )
  select c.id, c.submission_id, c.source_event_id, c.event_key,
         c.event_type, c.lock_token, c.attempts, c.locked_until
  from claimed as c;
end;
$$;

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
begin
  update private.pqr_outbox
  set status = 'delivered',
      provider_message_id = nullif(pg_catalog.left(p_provider_message_id, 200), ''),
      delivered_at = pg_catalog.now(),
      lock_token = null,
      locked_until = null,
      last_error_code = null,
      updated_at = pg_catalog.now()
  where id = p_outbox_id
    and status = 'processing'
    and lock_token = p_lease_token
  returning source_event_id into v_source_event_id;

  get diagnostics v_rows = row_count;
  if v_rows = 1 and v_source_event_id is not null then
    update public.pqr_events
    set email_status = 'sent'
    where id = v_source_event_id and event_type = 'response_sent';
  end if;
  return v_rows = 1;
end;
$;

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
  where id = p_outbox_id
    and status = 'processing'
    and lock_token = p_lease_token
  returning status, source_event_id into v_status, v_source_event_id;

  if v_status is not null and v_source_event_id is not null then
    update public.pqr_events
    set email_status = 'failed'
    where id = v_source_event_id and event_type = 'response_sent';
  end if;
  return coalesce(v_status, 'stale_lease');
end;
$$;

-- Manual dead-letter retry is deliberately not exposed in this first SQL
-- candidate. It needs a separate admin audit/authorization contract and a
-- policy for events outside the email provider's idempotency retention window.

revoke all on function public.pqr_admin_transition_status(uuid,text,bigint,text,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.pqr_admin_create_response(uuid,bigint,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.pqr_outbox_claim(integer,integer)
  from public, anon, authenticated;
revoke all on function public.pqr_outbox_finish(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.pqr_outbox_retry(uuid,uuid,text,integer)
  from public, anon, authenticated;

grant execute on function public.pqr_admin_transition_status(uuid,text,bigint,text,uuid,text,text,text)
  to service_role;
grant execute on function public.pqr_admin_create_response(uuid,bigint,uuid,text,text,text)
  to service_role;
grant execute on function public.pqr_outbox_claim(integer,integer)
  to service_role;
grant execute on function public.pqr_outbox_finish(uuid,uuid,text)
  to service_role;
grant execute on function public.pqr_outbox_retry(uuid,uuid,text,integer)
  to service_role;

commit;

-- END CANDIDATE. Must pass isolated PostgreSQL compilation, integration,
-- concurrency, rollback, RLS/grant and Supabase Advisor tests before migration.
