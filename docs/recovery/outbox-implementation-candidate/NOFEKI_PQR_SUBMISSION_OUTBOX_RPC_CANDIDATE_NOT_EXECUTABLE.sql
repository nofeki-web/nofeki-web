-- NOFEKI PQR public submission + initial Outbox RPC
-- CANDIDATE ONLY. NOT A MIGRATION. DO NOT EXECUTE IN PRODUCTION.
-- Target: PostgreSQL 17.11; schema mapped from read-only inspection.
-- Requires prior Outbox tables from the separate candidate SQL.
-- This file is deliberately kept under docs/recovery.

create table if not exists private.pqr_request_keys (
  request_key uuid primary key,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  submission_id uuid not null unique
    references public.pqr_submissions(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now()
);

alter table private.pqr_request_keys enable row level security;
revoke all on private.pqr_request_keys from public, anon, authenticated;
grant select, insert on private.pqr_request_keys to service_role;

create or replace function public.pqr_create_submission_v2(
  p_request_key uuid,
  p_fingerprint text,
  p_submission jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing private.pqr_request_keys%rowtype;
  v_inserted integer;
  v_id uuid;
  v_reference text;
  v_attachment text;
  v_request_type text;
  v_full_name text;
  v_email text;
  v_subject text;
  v_message text;
  v_privacy_version text;
  v_source_hash text;
  v_result jsonb;
begin
  if p_request_key is null
     or p_fingerprint is null
     or p_fingerprint !~ '^[0-9a-f]{64}$'
     or p_submission is null
     or pg_catalog.jsonb_typeof(p_submission) <> 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  v_id := nullif(p_submission->>'id', '')::uuid;
  v_reference := nullif(pg_catalog.btrim(p_submission->>'reference_code'), '');
  v_request_type := nullif(pg_catalog.btrim(p_submission->>'request_type'), '');
  v_full_name := nullif(pg_catalog.btrim(p_submission->>'full_name'), '');
  v_email := pg_catalog.lower(nullif(pg_catalog.btrim(p_submission->>'email'), ''));
  v_subject := nullif(pg_catalog.btrim(p_submission->>'subject'), '');
  v_message := nullif(pg_catalog.btrim(p_submission->>'message'), '');
  v_attachment := nullif(pg_catalog.btrim(p_submission->>'attachment_path'), '');
  v_privacy_version := nullif(pg_catalog.btrim(p_submission->>'privacy_version'), '');
  v_source_hash := nullif(pg_catalog.btrim(p_submission->>'source_hash'), '');

  if v_id is null or v_reference is null or
     v_request_type not in ('Petición','Queja','Reclamo','Sugerencia','Protección de datos','Otra solicitud') or
     v_full_name is null or pg_catalog.length(v_full_name) not between 2 and 120 or
     v_email is null or pg_catalog.length(v_email) > 254 or
     v_subject is null or pg_catalog.length(v_subject) not between 3 and 160 or
     v_message is null or pg_catalog.length(v_message) not between 10 and 5000 or
     v_privacy_version is null then
    raise exception 'invalid_submission' using errcode = '22023';
  end if;

  insert into private.pqr_request_keys
    (request_key, request_fingerprint, submission_id)
  values
    (p_request_key, p_fingerprint, v_id)
  on conflict (request_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select k.* into v_existing
    from private.pqr_request_keys as k
    where k.request_key = p_request_key
    for update;

    if not found or v_existing.request_fingerprint <> p_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode = 'PT409';
    end if;

    select s.id, s.reference_code into v_id, v_reference
    from public.pqr_submissions as s
    where s.id = v_existing.submission_id;

    if not found then
      raise exception 'idempotency_record_inconsistent' using errcode = 'P0001';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true, 'submission_id', v_id,
      'reference_code', v_reference, 'replayed', true
    );
  end if;

  insert into public.pqr_submissions (
    id, reference_code, request_type, full_name, email, subject, message,
    attachment_path, privacy_version, source_hash
  ) values (
    v_id, v_reference, v_request_type, v_full_name, v_email, v_subject, v_message,
    v_attachment, v_privacy_version, v_source_hash
  );

  insert into private.pqr_outbox (
    submission_id, event_key, event_type
  ) values
    (v_id, 'pqr:' || v_id::text || ':applicant_confirmation:v1', 'applicant_confirmation'),
    (v_id, 'pqr:' || v_id::text || ':internal_alert:v1', 'internal_alert');

  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'submission_id', v_id,
    'reference_code', v_reference, 'replayed', false
  );
  return v_result;
end;
$$;

revoke all on function public.pqr_create_submission_v2(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.pqr_create_submission_v2(uuid,text,jsonb)
  to service_role;

-- Required before isolated validation:
-- 1) Confirm private schema/table ACL and default privileges.
-- 2) Confirm service_role has INSERT on public.pqr_submissions and usage on
--    all referenced objects; do not broaden client grants.
-- 3) Test unique-key contention, rollback after each insert, and replay.
-- 4) Do not copy to supabase/migrations or execute against production.
