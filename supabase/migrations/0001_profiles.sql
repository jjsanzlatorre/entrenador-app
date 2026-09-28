-- 0001_profiles.sql
-- Perfiles de usuario, helpers de rol/estado y alta automática al crear un usuario en auth.
-- Idempotente: se puede ejecutar varias veces en el SQL Editor sin errores.

-- ─────────────────────────────────────────────────────────────
-- Tabla profiles
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  sex text check (sex in ('male', 'female', 'other')),
  birth_year integer check (birth_year between 1900 and 2100),
  height_cm numeric(5, 1) check (height_cm > 0 and height_cm < 300),
  home_city text,
  home_lat double precision check (home_lat between -90 and 90),
  home_lng double precision check (home_lng between -180 and 180),
  show_equivalence_popups boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Helpers (security definer para poder usarlos dentro de políticas RLS sin recursión)
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.active
  );
$$;

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Alta automática de profile al crear el usuario (invitación)
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Crea el profile de usuarios que ya existían antes de esta migración.
insert into public.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Permisos y RLS
-- ─────────────────────────────────────────────────────────────
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
-- El usuario solo puede editar sus campos personales; role y active solo desde servidor (service role).
grant update (
  display_name, sex, birth_year, height_cm,
  home_city, home_lat, home_lng, show_equivalence_popups
) on public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active()))
  with check (id = (select auth.uid()));
