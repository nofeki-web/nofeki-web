-- PQR workflow: auditable lifecycle, internal notes and response history.
alter table public.pqr_submissions
  drop constraint if exists pqr_submissions_status_check;

alter table public.pqr_submissions
  add constraint pqr_submissions_status_check
  check (status = any (array['Recibida','En revisión','En gestión','Respondida','Cerrada']::text[]));

alter table public.pqr_submissions
  add column if not exists notification_status text not null default 'pending'
    check (notification_status in ('pending','sent','failed','not_configured')),
  add column if not exists notification_error text,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.pqr_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.pqr_submissions(id) on delete cascade,
  actor_email text not null,
  event_type text not null check (event_type in ('status_changed','internal_note','response_sent','notification_retry')),
  old_status text,
  new_status text,
  note text,
  response text,
  email_status text check (email_status is null or email_status in ('sent','failed','not_configured')),
  created_at timestamptz not null default now()
);

create index if not exists pqr_events_submission_created_idx
  on public.pqr_events(submission_id, created_at desc);

alter table public.pqr_events enable row level security;
revoke all on public.pqr_events from anon, authenticated;
grant all on public.pqr_events to service_role;

revoke all on public.pqr_submissions from anon, authenticated;
grant all on public.pqr_submissions to service_role;

comment on table public.pqr_events is 'Historial de auditoría de cambios, notas internas y respuestas de PQR.';
