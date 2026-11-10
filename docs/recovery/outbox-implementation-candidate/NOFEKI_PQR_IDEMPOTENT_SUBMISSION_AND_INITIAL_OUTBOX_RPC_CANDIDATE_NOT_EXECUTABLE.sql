-- NOFEKI PQR — IDEMPOTENT PUBLIC SUBMISSION + INITIAL OUTBOX
-- REFERENCE CANDIDATE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- PostgreSQL 17 / Supabase. Requires isolated compile, ACL, RLS and concurrency tests.
--
-- Existing dependencies inspected:
--   public.pqr_submissions and public.pqr_events
--   public.pqr_consume_rate_limit(text, integer, integer), SECURITY INVOKER,
--   EXECUTE granted to service_role.
--   private.pqr_outbox from NOFEKI_PQR_ATOMIC_OUTBOX_RPC_CANDIDATE_NOT_EXECUTABLE.sql
--
-- Important: run only after the admin/outbox candidate has been validated in
-- an isolated database. Edge Function must verify Turnstile and calculate all
-- hashes/metadata; it must call these RPCs with service_role server-side only.

begin;

create table if not exists private.pqr_submission_requests (
  idempotency_key uuid primary key,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  source_hash text not null
    check (source_hash ~ '^[0-9a-f]{64}$'),
  state text not null
    check (state in ('reserved','uploaded','completed','failed','uncertain')),
  claim_token uuid,
  lease_until timestamptz,
  submission_id uuid references public.pqr_submissions(id) on delete restrict,
  storage_object_path text,
  attachment_sha256 text
    check (attachment_sha256 is null or attachment_sha256 ~ '^[0-9a-f]{64}$'),
  attachment_bytes bigint
    check (attachment_bytes is null or attachment_bytes between 1 and 5242880),
  attachment_mime text
    check (attachment_mime is null or attachment_mime in ('application/pdf','image/jpeg','image/png')),
  safe_error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint pqr_submission_request_lease_check check (
    (state in ('reserved','uploaded') and claim_token is not null and lease_until is not null)
    or (state not in ('reserved','uploaded') and claim_token is null and lease_until is null)
  ),
  constraint pqr_submission_request_attachment_check check (
    (storage_object_path is null and attachment_sha256 is null
      and attachment_bytes is null and attachment_mime is null)
    or (storage_object_path is not null and attachment_sha256 is not null
      and attachment_bytes is not null and attachment_mime is not null)
  ),
  constraint pqr_submission_request_completed_check check (
    (state = 'completed' and submission_id is not null and completed_at is not null)
    or (state <> 'completed' and completed_at is null)
  )
);

create index if not exists pqr_submission_requests_state_lease_idx
  on private.pqr_submission_requests (lease_until)
  where state in ('reserved','uploaded');

alter table private.pqr_submission_requests enable row level security;
revoke all on private.pqr_submission_requests from public, anon, authenticated;
grant select, insert, update on private.pqr_submission_requests to service_role;

-- A new idempotency key consumes quota once. Replays and resumed claims do not.
-- Lock order is always key first, source second. Hash collisions only serialize
-- unrelated requests; they do not bypass uniqueness or the rate-limit function.
create or replace function public.pqr_submit_reserve(
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_source_hash text,
  p_limit integer default 5,
  p_window_seconds integer default 3600,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request private.pqr_submission_requests%rowtype;
  v_token uuid;
  v_allowed boolean;
  v_ref text;
begin
  if p_idempotency_key is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or p_source_hash is null
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_limit > 20
     or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid_reservation_request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pqr-submit-key:' || p_idempotency_key::text, 0)
  );

  select r.* into v_request
  from private.pqr_submission_requests as r
  where r.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.request_fingerprint <> p_request_fingerprint then
      return pg_catalog.jsonb_build_object('result','key_conflict');
    end if;

    if v_request.state = 'completed' then
      select s.reference_code into v_ref
      from public.pqr_submissions as s
      where s.id = v_request.submission_id;
      return pg_catalog.jsonb_build_object(
        'result','replay','submission_id',v_request.submission_id,
        'reference',v_ref,'replayed',true
      );
    end if;

    if v_request.state = 'uncertain' then
      return pg_catalog.jsonb_build_object('result','uncertain');
    end if;

    if v_request.state in ('reserved','uploaded')
       and v_request.lease_until > pg_catalog.now() then
      return pg_catalog.jsonb_build_object('result','in_progress');
    end if;

    -- Failed or expired lease: resume the same durable intent, never charge
    -- the rate limit again. Uploaded object metadata remains bound to the row.
    v_token := pg_catalog.gen_random_uuid();
    update private.pqr_submission_requests
    set state = case when storage_object_path is null then 'reserved' else 'uploaded' end,
        claim_token = v_token,
        lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
        safe_error_code = null,
        updated_at = pg_catalog.now()
    where idempotency_key = p_idempotency_key
    returning * into v_request;

    return pg_catalog.jsonb_build_object(
      'result','claimed','claim_token',v_token,
      'state',v_request.state,'storage_object_path',v_request.storage_object_path,
      'attachment_sha256',v_request.attachment_sha256,
      'attachment_bytes',v_request.attachment_bytes,
      'attachment_mime',v_request.attachment_mime
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pqr-submit-source:' || p_source_hash, 0)
  );

  -- This existing function performs the atomic counter upsert. Since this RPC
  -- is SECURITY INVOKER and service_role is the caller, the dependency executes
  -- with the same service_role privileges. Confirm this ACL in isolated tests.
  v_allowed := public.pqr_consume_rate_limit(
    p_source_hash, p_limit, p_window_seconds
  );
  if v_allowed is distinct from true then
    return pg_catalog.jsonb_build_object('result','rate_limited');
  end if;

  v_token := pg_catalog.gen_random_uuid();
  insert into private.pqr_submission_requests (
    idempotency_key, request_fingerprint, source_hash, state,
    claim_token, lease_until
  ) values (
    p_idempotency_key, p_request_fingerprint, p_source_hash, 'reserved',
    v_token, pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
  );

  return pg_catalog.jsonb_build_object(
    'result','claimed','claim_token',v_token,'state','reserved'
  );
end;
$$;

-- Persist Storage metadata only after Edge Function has uploaded the object
-- and verified the bytes/hash. The deterministic path is bound to the key.
create or replace function public.pqr_submit_mark_uploaded(
  p_idempotency_key uuid,
  p_claim_token uuid,
  p_storage_object_path text,
  p_attachment_sha256 text,
  p_attachment_bytes bigint,
  p_attachment_mime text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_idempotency_key is null or p_claim_token is null
     or p_attachment_mime is null
     or p_storage_object_path is null
     or p_storage_object_path <> (p_idempotency_key::text || '/soporte.' ||
       case p_attachment_mime
         when 'application/pdf' then 'pdf'
         when 'image/jpeg' then 'jpg'
         when 'image/png' then 'png'
         else ''
       end)
     or p_attachment_sha256 is null
     or p_attachment_sha256 !~ '^[0-9a-f]{64}$'
     or p_attachment_bytes is null
     or p_attachment_bytes < 1 or p_attachment_bytes > 5242880
     or p_attachment_mime not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'invalid_attachment_metadata' using errcode = '22023';
  end if;

  update private.pqr_submission_requests
  set state = 'uploaded',
      storage_object_path = p_storage_object_path,
      attachment_sha256 = p_attachment_sha256,
      attachment_bytes = p_attachment_bytes,
      attachment_mime = p_attachment_mime,
      updated_at = pg_catalog.now()
  where idempotency_key = p_idempotency_key
    and state in ('reserved','uploaded')
    and claim_token = p_claim_token
    and lease_until > pg_catalog.now()
    and (storage_object_path is null
      or (storage_object_path = p_storage_object_path
        and attachment_sha256 = p_attachment_sha256
        and attachment_bytes = p_attachment_bytes
        and attachment_mime = p_attachment_mime));

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- The PQR row, initial history, two independent notification intents and
-- completed idempotency result are one PostgreSQL transaction. No email here.
create or replace function public.pqr_submit_finalize(
  p_idempotency_key uuid,
  p_claim_token uuid,
  p_request_fingerprint text,
  p_request_type text,
  p_full_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_privacy_version text,
  p_attachment_required boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request private.pqr_submission_requests%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_reference text;
  v_event_id uuid;
  v_outbox_applicant uuid;
  v_outbox_internal uuid;
  v_year text := pg_catalog.to_char(pg_catalog.now(), 'YYYY');
begin
  if p_idempotency_key is null or p_claim_token is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or p_request_type is null
     or p_request_type not in ('Petición','Queja','Reclamo','Sugerencia','Protección de datos','Otra solicitud')
     or p_attachment_required is null
     or p_full_name is null or pg_catalog.length(pg_catalog.btrim(p_full_name)) not between 2 and 120
     or p_email is null or pg_catalog.length(p_email) > 254
     or p_subject is null or pg_catalog.length(pg_catalog.btrim(p_subject)) not between 3 and 160
     or p_message is null or pg_catalog.length(pg_catalog.btrim(p_message)) not between 10 and 5000
     or p_privacy_version is null or pg_catalog.length(p_privacy_version) > 32 then
    raise exception 'invalid_submission_fields' using errcode = '22023';
  end if;

  select r.* into v_request
  from private.pqr_submission_requests as r
  where r.idempotency_key = p_idempotency_key
  for update;

  if not found
     or v_request.request_fingerprint <> p_request_fingerprint
     or v_request.state not in ('reserved','uploaded')
     or v_request.claim_token <> p_claim_token
     or v_request.lease_until <= pg_catalog.now() then
    raise exception 'reservation_not_owned_or_expired' using errcode = 'PT409';
  end if;

  if p_attachment_required and v_request.state <> 'uploaded' then
    raise exception 'attachment_not_confirmed' using errcode = 'PT422';
  end if;
  if not p_attachment_required and v_request.storage_object_path is not null then
    raise exception 'unexpected_attachment_metadata' using errcode = 'PT422';
  end if;

  -- Preserve existing public reference format. UUID collision probability for
  -- the eight-character suffix is low but the unique constraint must be tested;
  -- any collision aborts the whole transaction and may be retried with same key.
  v_reference := 'NFK-' || v_year || '-' ||
    pg_catalog.upper(pg_catalog.substr(replace(v_id::text,'-',''),1,8));

  insert into public.pqr_submissions (
    id, reference_code, request_type, full_name, email, subject, message,
    attachment_path, privacy_version, consented_at, source_hash,
    status
  ) values (
    v_id, v_reference, p_request_type, pg_catalog.btrim(p_full_name),
    pg_catalog.lower(pg_catalog.btrim(p_email)), pg_catalog.btrim(p_subject),
    pg_catalog.btrim(p_message), v_request.storage_object_path,
    p_privacy_version, pg_catalog.now(), v_request.source_hash,
    'Recibida'
  );

  insert into public.pqr_events (
    submission_id, actor_email, event_type, old_status, new_status, note
  ) values (
    v_id, 'system@nofeki.com', 'status_changed', null, 'Recibida',
    'Radicación inicial'
  ) returning id into v_event_id;

  insert into private.pqr_outbox (
    submission_id, source_event_id, event_key, event_type
  ) values (
    v_id, v_event_id, 'pqr:' || v_id::text || ':applicant_confirmation:v1',
    'applicant_confirmation'
  ) returning id into v_outbox_applicant;

  insert into private.pqr_outbox (
    submission_id, source_event_id, event_key, event_type
  ) values (
    v_id, v_event_id, 'pqr:' || v_id::text || ':internal_alert:v1',
    'internal_alert'
  ) returning id into v_outbox_internal;

  update private.pqr_submission_requests
  set state = 'completed',
      submission_id = v_id,
      claim_token = null,
      lease_until = null,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now(),
      safe_error_code = null
  where idempotency_key = p_idempotency_key;

  return pg_catalog.jsonb_build_object(
    'result','completed','submission_id',v_id,'reference',v_reference,
    'notification_status','queued',
    'outbox_ids',pg_catalog.jsonb_build_array(v_outbox_applicant,v_outbox_internal)
  );
end;
$$;

-- Public clients must never invoke privileged submission RPCs or inspect
-- request/outbox state. Edge Function invokes as service_role only.
revoke all on function public.pqr_submit_reserve(uuid,text,text,integer,integer,integer)
  from public, anon, authenticated;
revoke all on function public.pqr_submit_mark_uploaded(uuid,uuid,text,text,bigint,text)
  from public, anon, authenticated;
revoke all on function public.pqr_submit_finalize(uuid,uuid,text,text,text,text,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.pqr_submit_reserve(uuid,text,text,integer,integer,integer)
  to service_role;
grant execute on function public.pqr_submit_mark_uploaded(uuid,uuid,text,text,bigint,text)
  to service_role;
grant execute on function public.pqr_submit_finalize(uuid,uuid,text,text,text,text,text,text,text,boolean)
  to service_role;

commit;

-- END CANDIDATE. Before adoption:
-- 1) verify actual pqr_submissions constraints/defaults/triggers and pqr_events
--    actor_email/event_type constraints, including whether system@nofeki.com is valid;
-- 2) verify pqr_outbox source_event_id and event_type constraints;
-- 3) compile/execute against isolated PostgreSQL 17 and test rollback/concurrency;
-- 4) add safe reconciliation/abandonment operations and retention policy;
-- 5) add and test explicit failure/uncertain transition RPCs and Storage reconciliation.
-- 6) coordinate frontend + Edge Function rollout. This file is not executable
-- in production.
