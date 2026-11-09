-- NOFEKI PQR — ADMIN DEAD-LETTER LIST RPC
-- CANDIDATE ONLY. Requires private.pqr_outbox and public.pqr_submissions.
-- Exposes minimal dead-letter metadata to the already-authenticated admin Edge Function.
begin;
create or replace function public.pqr_admin_list_dead_outbox_v1()
returns table (
  outbox_id uuid,
  submission_id uuid,
  reference_code text,
  event_type text,
  created_at timestamptz,
  last_error_code text,
  has_provider_message_id boolean
)
language sql
security invoker
set search_path = ''
as $$
  select o.id, o.submission_id, s.reference_code, o.event_type,
         o.created_at, o.last_error_code,
         (o.provider_message_id is not null)
  from private.pqr_outbox o
  join public.pqr_submissions s on s.id = o.submission_id
  where o.status = 'dead'
  order by o.updated_at desc
  limit 100;
$$;
revoke all on function public.pqr_admin_list_dead_outbox_v1() from public, anon, authenticated;
grant execute on function public.pqr_admin_list_dead_outbox_v1() to service_role;
commit;
-- END CANDIDATE. Compile and verify grants in isolated PostgreSQL before use.
