-- 0013_achievements.sql
-- Acumulados y equivalencias motivadoras (CLAUDE.md §10B): catálogos globales de objetos
-- (peso, rutas a nado y tiempo) y destinos, hitos ya mostrados y totales de fuerza por sesión.
-- Las semillas están en 0014 (generado desde supabase/seed/*.json).
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- equivalence_objects (global, solo lectura)
-- value: kg (weight), metros (distance_route) o minutos (time).
-- label/label_plural/article: para escribir «un tractor» o «3,4 tractores».
-- phrase_template: frase con {qty}, p. ej. «Has levantado el peso de {qty}».
-- min_value: a partir de cuánto se puede mostrar como fracción («llevas el 12 % de…»).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.equivalence_objects (
  id text primary key,
  kind text not null check (kind in ('weight', 'distance_route', 'time')),
  label text not null,
  label_plural text not null,
  article text not null default 'un',
  emoji text not null,
  value numeric not null check (value > 0),
  phrase_template text not null,
  min_value numeric not null default 0 check (min_value >= 0)
);

alter table public.equivalence_objects enable row level security;
revoke all on public.equivalence_objects from anon;
revoke insert, update, delete on public.equivalence_objects from authenticated;
grant select on public.equivalence_objects to authenticated;

drop policy if exists "equivalence_objects_select" on public.equivalence_objects;
create policy "equivalence_objects_select" on public.equivalence_objects
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- destinations (global, solo lectura). water_route: válido para equivalencias de natación.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.destinations (
  id text primary key,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  type text not null check (type in ('city', 'island', 'landmark')),
  water_route boolean not null default false
);

alter table public.destinations enable row level security;
revoke all on public.destinations from anon;
revoke insert, update, delete on public.destinations from authenticated;
grant select on public.destinations to authenticated;

drop policy if exists "destinations_select" on public.destinations;
create policy "destinations_select" on public.destinations
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- milestones_shown: hitos ya enseñados (pop-ups y resumen del mes); evita repetirlos.
-- Claves: {métrica}_{periodo}[_{clave del periodo}]_{id del objeto o destino},
-- p. ej. tonnage_month_2026-10_tractor, swim_total_mallorca; month_summary_2026-09.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.milestones_shown (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  milestone_key text not null check (length(milestone_key) between 1 and 200),
  shown_at timestamptz not null default now(),
  primary key (user_id, milestone_key)
);

alter table public.milestones_shown enable row level security;
revoke all on public.milestones_shown from anon;
grant select, insert, delete on public.milestones_shown to authenticated;

drop policy if exists "milestones_shown_own" on public.milestones_shown;
create policy "milestones_shown_own" on public.milestones_shown
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- session_totals: tonelaje y repeticiones de cada sesión terminada del usuario.
-- Tonelaje = Σ peso × reps de series completadas, sin calentamiento y solo de ejercicios
-- con seguimiento peso × reps (el peso corporal no suma en la v1).
-- SECURITY INVOKER: la RLS de las tablas se aplica igual.
-- ─────────────────────────────────────────────────────────────
create or replace function public.session_totals()
returns table (session_id uuid, tonnage_kg numeric, total_reps integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ws.id as session_id,
    coalesce(sum(es.weight_kg * es.reps) filter (
      where e.tracking_type = 'weight_reps' and es.weight_kg > 0 and es.reps > 0
    ), 0)::numeric as tonnage_kg,
    coalesce(sum(es.reps) filter (where es.reps > 0), 0)::integer as total_reps
  from public.workout_sessions ws
  join public.exercise_sets es
    on es.session_id = ws.id and es.completed and not es.is_warmup
  left join public.exercises e on e.id = es.exercise_id
  where ws.user_id = (select auth.uid()) and ws.ended_at is not null
  group by ws.id;
$$;

revoke all on function public.session_totals() from public, anon;
grant execute on function public.session_totals() to authenticated;
