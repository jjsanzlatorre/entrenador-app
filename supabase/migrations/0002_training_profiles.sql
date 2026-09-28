-- 0002_training_profiles.sql
-- Perfil de entrenamiento (lo rellenará el onboarding de la Fase 5).
-- Idempotente.

create table if not exists public.training_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  goals jsonb not null default '{}'::jsonb,
  level text check (level in ('beginner', 'intermediate', 'advanced')),
  availability jsonb not null default '{}'::jsonb,
  equipment text[] not null default '{}',
  limitations text,
  fixed_activities jsonb not null default '[]'::jsonb,
  benchmarks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.training_profiles enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists training_profiles_set_updated_at on public.training_profiles;
create trigger training_profiles_set_updated_at
  before update on public.training_profiles
  for each row execute function public.set_updated_at();

revoke all on public.training_profiles from anon;
grant select, insert, update, delete on public.training_profiles to authenticated;

-- Regla general de tablas de usuario: user_id = auth.uid() y usuario activo.
drop policy if exists "training_profiles_own" on public.training_profiles;
create policy "training_profiles_own" on public.training_profiles
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));
