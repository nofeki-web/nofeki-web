create table if not exists public.income_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  income_date date not null default current_date,
  concept text not null check (char_length(btrim(concept)) between 2 and 120),
  source text check (source is null or char_length(source) <= 80),
  amount numeric(14,2) not null check (amount > 0),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists income_transactions_user_date_idx on public.income_transactions (user_id, income_date desc, id desc);
alter table public.income_transactions enable row level security;
create policy "Users can view own income transactions" on public.income_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own income transactions" on public.income_transactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own income transactions" on public.income_transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own income transactions" on public.income_transactions for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.income_transactions to authenticated;
