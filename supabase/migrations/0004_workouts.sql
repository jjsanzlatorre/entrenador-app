-- 0004_workouts.sql
-- Registro de sesiones: workout_sessions, session_blocks, exercise_sets
-- y la función save_workout_session() que guarda una sesión completa en una transacción.
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- workout_sessions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- FK a planned_sessions se añadirá en la Fase 5, cuando exista la tabla.
  planned_session_id uuid,
  session_type text not null default 'strength' check (
    session_type in (
      'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning',
      'yoga', 'padel_fronton', 'surf', 'other'
    )
  ),
  title text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_min integer check (duration_min between 0 and 1440),
  rpe smallint check (rpe between 1 and 10),
  distance_m numeric(9, 1) check (distance_m >= 0),
  avg_hr smallint check (avg_hr between 20 and 260),
  max_hr smallint check (max_hr between 20 and 260),
  calories integer check (calories >= 0),
  location text check (location in ('gym', 'outdoor', 'pool', 'home', 'other')),
  notes text,
  pair_group_id uuid,
  -- Versión del cliente: evita que una copia antigua (reintento tardío) pise una más nueva.
  client_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);

drop trigger if exists workout_sessions_set_updated_at on public.workout_sessions;
create trigger workout_sessions_set_updated_at
  before update on public.workout_sessions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- session_blocks
-- ─────────────────────────────────────────────────────────────
create table if not exists public.session_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "order" integer not null default 0,
  block_type text not null default 'straight' check (
    block_type in (
      'straight', 'superset', 'circuit', 'emom', 'amrap', 'tabata', 'for_time', 'intervals', 'free'
    )
  ),
  config jsonb not null default '{}'::jsonb,
  result jsonb
);

create index if not exists session_blocks_session_idx on public.session_blocks (session_id);

-- ─────────────────────────────────────────────────────────────
-- exercise_sets
-- ─────────────────────────────────────────────────────────────
create table if not exists public.exercise_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  block_id uuid not null references public.session_blocks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on delete restrict,
  set_index integer not null default 0,
  is_warmup boolean not null default false,
  weight_kg numeric(6, 2) check (weight_kg >= 0 and weight_kg < 1000),
  reps integer check (reps between 0 and 1000),
  rir smallint check (rir between 0 and 5),
  duration_s integer check (duration_s between 0 and 86400),
  distance_m numeric(9, 1) check (distance_m >= 0),
  calories integer check (calories >= 0),
  completed boolean not null default false,
  completed_at timestamptz
);

create index if not exists exercise_sets_session_idx on public.exercise_sets (session_id);
create index if not exists exercise_sets_block_idx on public.exercise_sets (block_id);
create index if not exists exercise_sets_user_exercise_idx
  on public.exercise_sets (user_id, exercise_id, completed_at desc);

-- ─────────────────────────────────────────────────────────────
-- Permisos y RLS: user_id = auth.uid() y usuario activo.
-- Bloques y series, además, solo en sesiones propias.
-- ─────────────────────────────────────────────────────────────
alter table public.workout_sessions enable row level security;
alter table public.session_blocks enable row level security;
alter table public.exercise_sets enable row level security;

revoke all on public.workout_sessions, public.session_blocks, public.exercise_sets from anon;
grant select, insert, update, delete
  on public.workout_sessions, public.session_blocks, public.exercise_sets to authenticated;

drop policy if exists "workout_sessions_own" on public.workout_sessions;
create policy "workout_sessions_own" on public.workout_sessions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

drop policy if exists "session_blocks_own" on public.session_blocks;
create policy "session_blocks_own" on public.session_blocks
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (
    user_id = (select auth.uid())
    and (select public.is_active())
    and exists (
      select 1 from public.workout_sessions ws
      where ws.id = session_id and ws.user_id = (select auth.uid())
    )
  );

drop policy if exists "exercise_sets_own" on public.exercise_sets;
create policy "exercise_sets_own" on public.exercise_sets
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (
    user_id = (select auth.uid())
    and (select public.is_active())
    and exists (
      select 1 from public.workout_sessions ws
      where ws.id = session_id and ws.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- save_workout_session(payload): guarda la sesión completa (upsert + borra lo que ya no está).
-- SECURITY INVOKER: se aplican las políticas RLS de arriba.
-- payload = { session: {...}, blocks: [...], sets: [...] }
-- Devuelve true si se aplicó, false si en el servidor había una versión más nueva.
-- ─────────────────────────────────────────────────────────────
create or replace function public.save_workout_session(payload jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s jsonb := payload -> 'session';
  sid uuid := (payload -> 'session' ->> 'id')::uuid;
  rev bigint := coalesce((payload -> 'session' ->> 'client_rev')::bigint, 0);
  current_rev bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if sid is null then
    raise exception 'session.id is required';
  end if;

  select ws.client_rev into current_rev from public.workout_sessions ws where ws.id = sid;
  if current_rev is not null and current_rev > rev then
    return false;
  end if;

  insert into public.workout_sessions as ws (
    id, user_id, planned_session_id, session_type, title, started_at, ended_at, duration_min,
    rpe, distance_m, avg_hr, max_hr, calories, location, notes, pair_group_id, client_rev
  ) values (
    sid,
    uid,
    (s ->> 'planned_session_id')::uuid,
    coalesce(s ->> 'session_type', 'strength'),
    s ->> 'title',
    coalesce((s ->> 'started_at')::timestamptz, now()),
    (s ->> 'ended_at')::timestamptz,
    (s ->> 'duration_min')::integer,
    (s ->> 'rpe')::smallint,
    (s ->> 'distance_m')::numeric,
    (s ->> 'avg_hr')::smallint,
    (s ->> 'max_hr')::smallint,
    (s ->> 'calories')::integer,
    s ->> 'location',
    s ->> 'notes',
    (s ->> 'pair_group_id')::uuid,
    rev
  )
  on conflict (id) do update set
    planned_session_id = excluded.planned_session_id,
    session_type = excluded.session_type,
    title = excluded.title,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_min = excluded.duration_min,
    rpe = excluded.rpe,
    distance_m = excluded.distance_m,
    avg_hr = excluded.avg_hr,
    max_hr = excluded.max_hr,
    calories = excluded.calories,
    location = excluded.location,
    notes = excluded.notes,
    pair_group_id = excluded.pair_group_id,
    client_rev = excluded.client_rev;

  -- Series y bloques que ya no están en la sesión.
  delete from public.exercise_sets es
  where es.session_id = sid
    and es.id not in (
      select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(payload -> 'sets', '[]')) x
    );
  delete from public.session_blocks sb
  where sb.session_id = sid
    and sb.id not in (
      select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(payload -> 'blocks', '[]')) x
    );

  insert into public.session_blocks as sb (id, session_id, user_id, "order", block_type, config, result)
  select b.id, sid, uid, b."order", b.block_type, coalesce(b.config, '{}'::jsonb), b.result
  from jsonb_to_recordset(coalesce(payload -> 'blocks', '[]')) as b (
    id uuid, "order" integer, block_type text, config jsonb, result jsonb
  )
  on conflict (id) do update set
    session_id = excluded.session_id,
    "order" = excluded."order",
    block_type = excluded.block_type,
    config = excluded.config,
    result = excluded.result;

  insert into public.exercise_sets as es (
    id, session_id, block_id, user_id, exercise_id, set_index, is_warmup, weight_kg, reps, rir,
    duration_s, distance_m, calories, completed, completed_at
  )
  select
    x.id, sid, x.block_id, uid, x.exercise_id, x.set_index, coalesce(x.is_warmup, false),
    x.weight_kg, x.reps, x.rir, x.duration_s, x.distance_m, x.calories,
    coalesce(x.completed, false), x.completed_at
  from jsonb_to_recordset(coalesce(payload -> 'sets', '[]')) as x (
    id uuid, block_id uuid, exercise_id text, set_index integer, is_warmup boolean,
    weight_kg numeric, reps integer, rir smallint, duration_s integer, distance_m numeric,
    calories integer, completed boolean, completed_at timestamptz
  )
  on conflict (id) do update set
    session_id = excluded.session_id,
    block_id = excluded.block_id,
    exercise_id = excluded.exercise_id,
    set_index = excluded.set_index,
    is_warmup = excluded.is_warmup,
    weight_kg = excluded.weight_kg,
    reps = excluded.reps,
    rir = excluded.rir,
    duration_s = excluded.duration_s,
    distance_m = excluded.distance_m,
    calories = excluded.calories,
    completed = excluded.completed,
    completed_at = excluded.completed_at;

  return true;
end;
$$;

revoke all on function public.save_workout_session(jsonb) from public, anon;
grant execute on function public.save_workout_session(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- last_exercise_sets(ids, exclude, before): series completadas de la última sesión terminada
-- en la que se hizo cada ejercicio (para precargar «la última vez» y comparar en el resumen).
-- p_before: solo sesiones terminadas antes de ese momento.
-- ─────────────────────────────────────────────────────────────
create or replace function public.last_exercise_sets(
  p_exercise_ids text[],
  p_exclude_session uuid default null,
  p_before timestamptz default null
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
  with last_session as (
    select distinct on (es.exercise_id) es.exercise_id, es.session_id, ws.ended_at
    from public.exercise_sets es
    join public.workout_sessions ws on ws.id = es.session_id
    where es.user_id = (select auth.uid())
      and es.exercise_id = any (p_exercise_ids)
      and es.completed
      and ws.ended_at is not null
      and (p_exclude_session is null or ws.id <> p_exclude_session)
      and (p_before is null or ws.ended_at < p_before)
    order by es.exercise_id, ws.ended_at desc
  )
  select
    es.exercise_id, es.session_id, ls.ended_at, es.set_index, es.is_warmup, es.weight_kg,
    es.reps, es.rir, es.duration_s, es.distance_m, es.calories
  from last_session ls
  join public.exercise_sets es
    on es.session_id = ls.session_id and es.exercise_id = ls.exercise_id and es.completed
  order by es.exercise_id, es.set_index;
$$;

revoke all on function public.last_exercise_sets(text[], uuid, timestamptz) from public, anon;
grant execute on function public.last_exercise_sets(text[], uuid, timestamptz) to authenticated;
