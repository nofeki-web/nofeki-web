-- NOFEKI: registro persistente de aceptación de documentos legales
-- Ejecutar una sola vez en Supabase Dashboard > SQL Editor.
-- No guarda IP ni user-agent: no son necesarios para esta primera versión.

create table if not exists public.legal_acceptance_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  privacy_version text not null,
  privacy_authorized_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.legal_acceptance_audit enable row level security;

-- El usuario autenticado puede consultar únicamente su propia evidencia.
drop policy if exists "Users can view own legal acceptance" on public.legal_acceptance_audit;
create policy "Users can view own legal acceptance"
on public.legal_acceptance_audit
for select
to authenticated
using (auth.uid() = user_id);

-- No se conceden permisos de insert/update/delete a usuarios finales.
revoke all on public.legal_acceptance_audit from anon, authenticated;
grant select on public.legal_acceptance_audit to authenticated;

create or replace function public.capture_nofeki_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop trigger if exists nofeki_capture_legal_acceptance on auth.users;
create trigger nofeki_capture_legal_acceptance
after insert on auth.users
for each row
execute function public.capture_nofeki_legal_acceptance();

-- Prueba posterior a ejecutar:
-- select * from public.legal_acceptance_audit order by created_at desc limit 10;
-- Crear una cuenta de prueba NUEVA y comprobar que aparece una fila.
-- Los usuarios existentes no se migran automáticamente.
