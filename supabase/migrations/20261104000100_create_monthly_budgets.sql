-- NOFEKI Gastos: presupuesto mensual por usuario.
-- Cada mes es independiente; los saldos no se trasladan entre periodos.

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  mode text not null check (mode in ('income', 'manual')),
  income_amount numeric(14,2),
  expense_limit numeric(14,2),
  savings_target numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_period_first_day check (extract(day from period_month) = 1),
  constraint budgets_income_nonnegative check (income_amount is null or income_amount >= 0),
  constraint budgets_expense_limit_nonnegative check (expense_limit is null or expense_limit >= 0),
  constraint budgets_savings_nonnegative check (savings_target >= 0),
  constraint budgets_mode_income_fields check (
    (mode = 'income' and income_amount is not null)
    or (mode = 'manual' and income_amount is null and savings_target = 0)
  ),
  constraint budgets_user_period_unique unique (user_id, period_month),
  constraint budgets_id_user_unique unique (id, user_id)
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  category_name text not null check (length(btrim(category_name)) between 1 and 80),
  planned_amount numeric(14,2) not null check (planned_amount >= 0),
  created_at timestamptz not null default now(),
  constraint budget_categories_budget_owner_fk
    foreign key (budget_id, user_id)
    references public.budgets(id, user_id)
    on delete cascade,
  constraint budget_categories_unique_name unique (budget_id, category_name)
);

create index if not exists budgets_user_period_idx
  on public.budgets (user_id, period_month desc);

create index if not exists budget_categories_user_budget_idx
  on public.budget_categories (user_id, budget_id);

alter table public.budgets enable row level security;
alter table public.budget_categories enable row level security;

drop policy if exists "Users can view their own budgets" on public.budgets;
create policy "Users can view their own budgets"
  on public.budgets for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own budgets" on public.budgets;
create policy "Users can create their own budgets"
  on public.budgets for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own budgets" on public.budgets;
create policy "Users can update their own budgets"
  on public.budgets for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own budgets" on public.budgets;
create policy "Users can delete their own budgets"
  on public.budgets for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own budget categories" on public.budget_categories;
create policy "Users can view their own budget categories"
  on public.budget_categories for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own budget categories" on public.budget_categories;
create policy "Users can create their own budget categories"
  on public.budget_categories for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.budgets b
      where b.id = budget_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their own budget categories" on public.budget_categories;
create policy "Users can update their own budget categories"
  on public.budget_categories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.budgets b
      where b.id = budget_id and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can delete their own budget categories" on public.budget_categories;
create policy "Users can delete their own budget categories"
  on public.budget_categories for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.budget_categories to authenticated;
