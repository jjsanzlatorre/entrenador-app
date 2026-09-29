-- 0023_phase5b.sql
-- Fase 5B (CLAUDE.md §4, §9, §10 y §12):
-- 1. planned_sessions.heavy_legs (para avisar al mover una sesión a mano) y create_user_plan
--    que lo guarda; se rellena en los planes ya creados a partir de su plantilla.
-- 2. Las sesiones pendientes de planes HYROX/DEKA ya creados toman la prescripción nueva de la
--    plantilla (datos de competición verificados en 0022).
-- 3. daily_checkins (check-in diario) con RLS propia.
-- 4. RPC recent_exercise_sets: últimas N sesiones de cada ejercicio (sugerencia de peso).
-- Requiere 0017 y 0022. Idempotente.

-- ─────────────────────────────────────────────────────────────
-- 1. heavy_legs
-- ─────────────────────────────────────────────────────────────
alter table public.planned_sessions
  add column if not exists heavy_legs boolean not null default false;

-- Relleno desde la plantilla del plan (misma semana y mismo título).
update public.planned_sessions ps
set heavy_legs = coalesce((s ->> 'heavy_legs')::boolean, false)
from public.user_plans up
join public.plan_templates t on t.id = up.template_id
cross join lateral jsonb_array_elements(t.structure -> 'weeks') w
cross join lateral jsonb_array_elements(w -> 'sessions') s
where up.id = ps.user_plan_id
  and (w ->> 'week')::int = ps.week
  and s ->> 'title' = ps.title
  and ps.heavy_legs is distinct from coalesce((s ->> 'heavy_legs')::boolean, false);

-- create_user_plan: igual que en 0017, más heavy_legs.
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
    blocks, heavy_legs
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
    coalesce(s -> 'blocks', '[]'::jsonb),
    coalesce((s ->> 'heavy_legs')::boolean, false)
  from jsonb_array_elements(p_sessions) s;

  return plan_id;
end;
$$;

revoke all on function public.create_user_plan(text, text, date, jsonb) from public, anon;
grant execute on function public.create_user_plan(text, text, date, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Planes HYROX/DEKA ya creados: las sesiones pendientes toman los bloques de la plantilla
--    (pesos por sexo en «standard» en vez de la nota «pendiente de verificar»).
-- ─────────────────────────────────────────────────────────────
update public.planned_sessions ps
set blocks = s -> 'blocks'
from public.user_plans up
join public.plan_templates t on t.id = up.template_id
cross join lateral jsonb_array_elements(t.structure -> 'weeks') w
cross join lateral jsonb_array_elements(w -> 'sessions') s
where up.id = ps.user_plan_id
  and t.family in ('hyrox', 'deka')
  and ps.status in ('planned', 'moved')
  and (w ->> 'week')::int = ps.week
  and s ->> 'title' = ps.title
  and ps.blocks is distinct from s -> 'blocks';

-- ─────────────────────────────────────────────────────────────
-- 3. daily_checkins: sueño, energía, agujetas y estrés (1–5), un registro por día.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.daily_checkins (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  sleep smallint check (sleep between 1 and 5),
  energy smallint check (energy between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  stress smallint check (stress between 1 and 5),
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.daily_checkins enable row level security;
revoke all on public.daily_checkins from anon;
grant select, insert, update, delete on public.daily_checkins to authenticated;

drop policy if exists "daily_checkins_own" on public.daily_checkins;
create policy "daily_checkins_own" on public.daily_checkins
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

drop trigger if exists daily_checkins_set_updated_at on public.daily_checkins;
create trigger daily_checkins_set_updated_at
  before update on public.daily_checkins
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. recent_exercise_sets(ids, sessions, exclude): series completadas de las últimas
--    p_sessions sesiones terminadas (1–10, por defecto 2) de cada ejercicio, de la más reciente
--    a la más antigua. Security invoker: la RLS y el filtro por auth.uid() dejan solo las propias.
-- ─────────────────────────────────────────────────────────────
create or replace function public.recent_exercise_sets(
  p_exercise_ids text[],
  p_sessions integer default 2,
  p_exclude_session uuid default null
)
returns table (
  exercise_id text,
  session_id uuid,
  ended_at timestamptz,
  set_index integer,
  is_warmup boolean,
  weight_kg numeric,
  reps integer,
  rir smallint,
  duration_s integer,
  distance_m numeric,
  calories integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with per_session as (
    select es.exercise_id, es.session_id, ws.ended_at
    from public.exercise_sets es
    join public.workout_sessions ws on ws.id = es.session_id
    where es.user_id = (select auth.uid())
      and ws.user_id = (select auth.uid())
      and es.exercise_id = any (p_exercise_ids)
      and es.completed
      and ws.ended_at is not null
      and (p_exclude_session is null or ws.id <> p_exclude_session)
    group by es.exercise_id, es.session_id, ws.ended_at
  ),
  ranked as (
    select ps.exercise_id, ps.session_id, ps.ended_at,
      row_number() over (partition by ps.exercise_id order by ps.ended_at desc, ps.session_id) as rn
    from per_session ps
  )
  select
    es.exercise_id, es.session_id, r.ended_at, es.set_index, es.is_warmup, es.weight_kg,
    es.reps, es.rir, es.duration_s, es.distance_m, es.calories
  from ranked r
  join public.exercise_sets es
    on es.session_id = r.session_id and es.exercise_id = r.exercise_id and es.completed
  where r.rn <= least(greatest(coalesce(p_sessions, 2), 1), 10)
  order by es.exercise_id, r.ended_at desc, es.set_index;
$$;

revoke all on function public.recent_exercise_sets(text[], integer, uuid) from public, anon;
grant execute on function public.recent_exercise_sets(text[], integer, uuid) to authenticated;
