-- 0003_catalog.sql
-- Catálogo: músculos, ejercicios (globales y propios) y músculos de cada ejercicio.
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- muscles (global, solo lectura)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.muscles (
  id text primary key,
  name text not null,
  view text not null check (view in ('front', 'back', 'both')),
  "group" text not null check ("group" in ('upper', 'core', 'lower'))
);

alter table public.muscles enable row level security;
revoke all on public.muscles from anon;
revoke insert, update, delete on public.muscles from authenticated;
grant select on public.muscles to authenticated;

drop policy if exists "muscles_select" on public.muscles;
create policy "muscles_select" on public.muscles
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- exercises: owner_id null = global (semilla); si no, ejercicio propio.
-- Los propios usan ids con prefijo "u_" para no chocar nunca con la semilla.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.exercises (
  id text primary key default ('u_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null check (length(trim(name)) between 1 and 80),
  aliases text[] not null default '{}',
  category text not null check (category in ('strength', 'functional', 'cardio', 'mobility', 'sport')),
  tracking_type text not null check (
    tracking_type in ('weight_reps', 'reps', 'time', 'distance_time', 'calories', 'duration_only')
  ),
  equipment text[] not null default '{}',
  is_unilateral boolean not null default false,
  is_compound boolean not null default false,
  default_rest_s integer not null default 90 check (default_rest_s between 0 and 600),
  technique_notes text,
  owner_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists exercises_owner_idx on public.exercises (owner_id);

alter table public.exercises enable row level security;
revoke all on public.exercises from anon;
grant select, insert, update, delete on public.exercises to authenticated;

drop policy if exists "exercises_select" on public.exercises;
create policy "exercises_select" on public.exercises
  for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

drop policy if exists "exercises_insert_own" on public.exercises;
create policy "exercises_insert_own" on public.exercises
  for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and id like 'u\_%' and (select public.is_active())
  );

drop policy if exists "exercises_update_own" on public.exercises;
create policy "exercises_update_own" on public.exercises
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "exercises_delete_own" on public.exercises;
create policy "exercises_delete_own" on public.exercises
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- exercise_muscles
-- ─────────────────────────────────────────────────────────────
create table if not exists public.exercise_muscles (
  exercise_id text not null references public.exercises (id) on delete cascade,
  muscle_id text not null references public.muscles (id),
  role text not null check (role in ('primary', 'secondary')),
  primary key (exercise_id, muscle_id)
);

create index if not exists exercise_muscles_muscle_idx on public.exercise_muscles (muscle_id);

alter table public.exercise_muscles enable row level security;
revoke all on public.exercise_muscles from anon;
grant select, insert, update, delete on public.exercise_muscles to authenticated;

-- Visible si el ejercicio es visible (la subconsulta ya aplica la RLS de exercises).
drop policy if exists "exercise_muscles_select" on public.exercise_muscles;
create policy "exercise_muscles_select" on public.exercise_muscles
  for select to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id));

drop policy if exists "exercise_muscles_write_own" on public.exercise_muscles;
create policy "exercise_muscles_write_own" on public.exercise_muscles
  for all to authenticated
  using (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and e.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and e.owner_id = (select auth.uid())
    )
  );
