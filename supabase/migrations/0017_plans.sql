-- 0017_plans.sql
-- Planes (CLAUDE.md §4 «Planes», §9 y fase 5): plantillas globales, planes del usuario y
-- sesiones planificadas, con el enlace sesión planificada ↔ sesión registrada.
-- Las plantillas se siembran en 0019–0021 (generadas desde supabase/seed/plan_templates.json).
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- plan_templates (global, solo lectura). structure: ver §9.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.plan_templates (
  id text primary key,
  family text not null check (family in ('running', 'swimming', 'strength', 'hyrox', 'deka', 'hybrid')),
  name text not null,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  weeks smallint not null default 4 check (weeks between 1 and 12),
  days_per_week smallint not null check (days_per_week between 1 and 7),
  description text not null default '',
  structure jsonb not null check (jsonb_typeof(structure) = 'object')
);

alter table public.plan_templates enable row level security;
revoke all on public.plan_templates from anon;
revoke insert, update, delete on public.plan_templates from authenticated;
grant select on public.plan_templates to authenticated;

drop policy if exists "plan_templates_select" on public.plan_templates;
create policy "plan_templates_select" on public.plan_templates
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- user_plans: como mucho un plan activo por usuario.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id text references public.plan_templates (id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  start_date date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  source text not null default 'template' check (source in ('template', 'ai')),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists user_plans_one_active_idx
  on public.user_plans (user_id) where status = 'active';

alter table public.user_plans enable row level security;
revoke all on public.user_plans from anon;
grant select, delete on public.user_plans to authenticated;
-- Se crean con create_user_plan; el usuario solo cambia estado, nombre y notas.
revoke insert, update on public.user_plans from authenticated;
grant update (status, name, notes) on public.user_plans to authenticated;

drop policy if exists "user_plans_own" on public.user_plans;
create policy "user_plans_own" on public.user_plans
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- planned_sessions. blocks: prescripción en el formato de las plantillas (§9):
-- [{ block_type, exercises: [{ exercise_id, sets, reps, rir, rest_s, … }], … }].
-- status: planned | done | skipped | moved (moved = pendiente, cambiada de día; original_date
-- guarda el día que le tocaba).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_plan_id uuid not null references public.user_plans (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  original_date date,
  week smallint not null default 1 check (week between 1 and 12),
  session_type text not null check (session_type in (
    'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning',
    'yoga', 'padel_fronton', 'surf', 'other'
  )),
  title text not null check (length(title) between 1 and 120),
  intensity text not null default 'moderate' check (intensity in ('easy', 'moderate', 'hard')),
  duration_min smallint check (duration_min between 1 and 600),
  notes text,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped', 'moved')),
  workout_session_id uuid references public.workout_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists planned_sessions_user_date_idx on public.planned_sessions (user_id, date);
create index if not exists planned_sessions_plan_idx on public.planned_sessions (user_plan_id);
create index if not exists planned_sessions_workout_idx on public.planned_sessions (workout_session_id);

alter table public.planned_sessions enable row level security;
revoke all on public.planned_sessions from anon;
grant select, delete on public.planned_sessions to authenticated;
revoke insert, update on public.planned_sessions from authenticated;
-- Mover y saltar: día y estado. El enlace con una sesión registrada va por RPC o trigger.
grant update (date, original_date, status) on public.planned_sessions to authenticated;

drop policy if exists "planned_sessions_own" on public.planned_sessions;
create policy "planned_sessions_own" on public.planned_sessions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- workout_sessions.planned_session_id existía sin FK desde 0004.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_sessions_planned_session_id_fkey'
  ) then
    update public.workout_sessions ws set planned_session_id = null
    where planned_session_id is not null
      and not exists (select 1 from public.planned_sessions p where p.id = ws.planned_session_id);
    alter table public.workout_sessions
      add constraint workout_sessions_planned_session_id_fkey
      foreign key (planned_session_id) references public.planned_sessions (id) on delete set null;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Enlace automático: al guardar una sesión terminada con planned_session_id, la planificada
-- pasa a «done» y apunta a ella. Si se cambia o quita el enlace, la anterior vuelve a
-- pendiente. Al borrar la sesión registrada, la planificada vuelve a pendiente.
-- SECURITY DEFINER (el usuario no puede escribir workout_session_id directamente); solo toca
-- filas del dueño de la sesión registrada.
-- ─────────────────────────────────────────────────────────────
create or replace function public.link_planned_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.planned_sessions p
    set status = 'planned', workout_session_id = null
    where p.workout_session_id = old.id and p.user_id = old.user_id and p.status = 'done';
    return old;
  end if;

  if tg_op = 'UPDATE' and old.planned_session_id is not null
    and old.planned_session_id is distinct from new.planned_session_id then
    update public.planned_sessions p
    set status = 'planned', workout_session_id = null
    where p.id = old.planned_session_id and p.workout_session_id = new.id
      and p.user_id = new.user_id;
  end if;

  if new.planned_session_id is not null and new.ended_at is not null then
    update public.planned_sessions p
    set status = 'done', workout_session_id = new.id
    where p.id = new.planned_session_id and p.user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sessions_link_planned on public.workout_sessions;
create trigger workout_sessions_link_planned
  after insert or update of planned_session_id, ended_at on public.workout_sessions
  for each row execute function public.link_planned_session();

drop trigger if exists workout_sessions_unlink_planned on public.workout_sessions;
create trigger workout_sessions_unlink_planned
  before delete on public.workout_sessions
  for each row execute function public.link_planned_session();

-- ─────────────────────────────────────────────────────────────
-- create_user_plan: archiva el plan activo (y borra sus sesiones pendientes desde p_start_date)
-- y crea el nuevo con sus sesiones. p_sessions: [{ date, week, session_type, title,
-- intensity, duration_min, notes, blocks }]. El reparto por días lo calcula el cliente.
-- SECURITY DEFINER (insert directo revocado): todo se filtra por auth.uid() y usuario activo.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_user_plan(
  p_template_id text,
  p_name text,
  p_start_date date,
  p_sessions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  plan_id uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_template_id is not null
    and not exists (select 1 from public.plan_templates t where t.id = p_template_id) then
    raise exception 'plantilla no encontrada';
  end if;
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0
    or jsonb_array_length(p_sessions) > 100 then
    raise exception 'p_sessions no válido';
  end if;

  delete from public.planned_sessions ps
  using public.user_plans up
  where ps.user_plan_id = up.id and up.user_id = uid and up.status = 'active'
    and ps.status in ('planned', 'moved') and ps.date >= p_start_date;

  update public.user_plans up set status = 'archived'
  where up.user_id = uid and up.status = 'active';

  insert into public.user_plans (user_id, template_id, name, start_date, status, source)
  values (uid, p_template_id, p_name, p_start_date, 'active', 'template')
  returning id into plan_id;

  insert into public.planned_sessions (
    user_plan_id, user_id, date, week, session_type, title, intensity, duration_min, notes,
    blocks
  )
  select
    plan_id,
    uid,
    (s ->> 'date')::date,
    coalesce((s ->> 'week')::smallint, 1),
    s ->> 'session_type',
    s ->> 'title',
    coalesce(s ->> 'intensity', 'moderate'),
    (s ->> 'duration_min')::smallint,
    s ->> 'notes',
    coalesce(s -> 'blocks', '[]'::jsonb)
  from jsonb_array_elements(p_sessions) s;

  return plan_id;
end;
$$;

revoke all on function public.create_user_plan(text, text, date, jsonb) from public, anon;
grant execute on function public.create_user_plan(text, text, date, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- set_planned_session_done: marca una planificada como hecha (con o sin sesión registrada) o
-- la devuelve a pendiente (p_done = false). Con p_workout, enlaza en los dos sentidos.
-- SECURITY DEFINER: comprueba que las dos sesiones son del usuario.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_planned_session_done(
  p_planned uuid,
  p_done boolean,
  p_workout uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_workout uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  select p.workout_session_id into current_workout
  from public.planned_sessions p where p.id = p_planned and p.user_id = uid;
  if not found then
    raise exception 'sesión planificada no encontrada';
  end if;
  if p_workout is not null and not exists (
    select 1 from public.workout_sessions ws where ws.id = p_workout and ws.user_id = uid
  ) then
    raise exception 'sesión registrada no encontrada';
  end if;

  -- Quita enlaces anteriores (de esta planificada y de la sesión registrada elegida).
  update public.workout_sessions ws set planned_session_id = null
  where ws.user_id = uid and ws.planned_session_id = p_planned
    and (p_workout is null or ws.id <> p_workout or not p_done);
  if p_done and p_workout is not null then
    update public.planned_sessions p set status = 'planned', workout_session_id = null
    where p.user_id = uid and p.workout_session_id = p_workout and p.id <> p_planned;
  end if;

  if p_done then
    update public.planned_sessions p
    set status = 'done', workout_session_id = p_workout
    where p.id = p_planned;
    if p_workout is not null then
      update public.workout_sessions ws set planned_session_id = p_planned
      where ws.id = p_workout and ws.planned_session_id is distinct from p_planned;
    end if;
  else
    update public.planned_sessions p
    set status = 'planned', workout_session_id = null
    where p.id = p_planned;
  end if;
end;
$$;

revoke all on function public.set_planned_session_done(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_planned_session_done(uuid, boolean, uuid) to authenticated;
