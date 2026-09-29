-- 0031_activity_types.sql
-- Nuevas actividades y actividades personalizadas (CLAUDE.md §6 y §7):
-- - padel_fronton se separa en fronton, padel y tennis (lo existente pasa a fronton).
-- - Clases de gimnasio: functional_class (Functional Training), gap (GAP) y oxfit (Oxfit).
-- - activity_types: tipos de actividad globales (semilla en 0032, datos en
--   supabase/seed/activity_types.json) con su aproximación muscular, y los personalizados de
--   cada usuario (session_type = 'custom' + workout_sessions.activity_type_id).
-- Idempotente. Requiere 0004, 0011, 0017, 0023 y 0027.

-- ─────────────────────────────────────────────────────────────
-- activity_types. Globales: owner_id null, id = session_type. Propios: owner_id = usuario,
-- id 'a_…'. muscles + sets_per_30min: series equivalentes por cada 30 min (aproximado, §6).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.activity_types (
  id text primary key default ('a_' || replace(gen_random_uuid()::text, '-', '')),
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  emoji text not null default '⚡' check (char_length(emoji) between 1 and 16),
  exercise_id text not null default 'other_activity'
    references public.exercises (id) on delete restrict,
  location text not null default 'other'
    check (location in ('gym', 'outdoor', 'pool', 'home', 'other')),
  muscles text[] not null default '{}' check (
    cardinality(muscles) <= 16
    and muscles <@ array[
      'chest', 'lats', 'upper_back', 'lower_back', 'delt_front', 'delt_side', 'delt_rear',
      'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'adductors',
      'calves'
    ]::text[]
  ),
  sets_per_30min numeric(3, 1) not null default 2 check (sets_per_30min between 0 and 4),
  quick boolean not null default true,
  fixed boolean not null default true,
  free_activity boolean not null default true,
  leg_loading boolean not null default false,
  hard_legs boolean not null default false,
  sort_order integer not null default 1000,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  -- Los propios llevan prefijo: una semilla futura nunca choca con un id de usuario.
  constraint activity_types_custom_id check (owner_id is null or id like 'a\_%')
);

create index if not exists activity_types_owner_idx on public.activity_types (owner_id);

alter table public.activity_types enable row level security;

revoke all on public.activity_types from anon, authenticated;
grant select on public.activity_types to authenticated;
grant insert (id, owner_id, name, emoji, muscles) on public.activity_types to authenticated;
grant update (name, emoji, muscles, archived) on public.activity_types to authenticated;

-- Globales para todos; los propios, para su dueño y para quien vea sus entrenos, su mapa
-- muscular o sus logros (nombre, emoji y músculos de sus sesiones personalizadas).
drop policy if exists "activity_types_select" on public.activity_types;
create policy "activity_types_select" on public.activity_types
  for select to authenticated
  using (
    (select public.is_active())
    and (
      owner_id is null
      or owner_id = (select auth.uid())
      or public.shares_with_me(owner_id, 'sessions')
      or public.shares_with_me(owner_id, 'muscles')
      or public.shares_with_me(owner_id, 'achievements')
    )
  );

drop policy if exists "activity_types_insert_own" on public.activity_types;
create policy "activity_types_insert_own" on public.activity_types
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_active()));

drop policy if exists "activity_types_update_own" on public.activity_types;
create policy "activity_types_update_own" on public.activity_types
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active()))
  with check (owner_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- workout_sessions: tipos nuevos, frontón en lugar de padel_fronton y actividad personalizada.
-- ─────────────────────────────────────────────────────────────
alter table public.workout_sessions
  add column if not exists activity_type_id text
    references public.activity_types (id) on delete set null;

alter table public.workout_sessions drop constraint if exists workout_sessions_session_type_check;
update public.workout_sessions set session_type = 'fronton' where session_type = 'padel_fronton';
alter table public.workout_sessions add constraint workout_sessions_session_type_check check (
  session_type in (
    'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning', 'yoga',
    'fronton', 'padel', 'tennis', 'functional_class', 'gap', 'oxfit', 'surf', 'other', 'custom'
  )
);

alter table public.workout_sessions drop constraint if exists workout_sessions_activity_type_check;
alter table public.workout_sessions add constraint workout_sessions_activity_type_check
  check (activity_type_id is null or session_type = 'custom');

-- Móviles con la versión anterior en caché (o sesiones en su cola sin subir) siguen mandando
-- padel_fronton: se guarda como frontón. Y una sesión solo puede usar actividades propias.
create or replace function public.normalize_workout_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.session_type = 'padel_fronton' then
    new.session_type := 'fronton';
  end if;
  if new.session_type <> 'custom' then
    new.activity_type_id := null;
  elsif new.activity_type_id is not null and not exists (
    select 1 from public.activity_types a
    where a.id = new.activity_type_id and a.owner_id = new.user_id
  ) then
    raise exception 'actividad no válida';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sessions_normalize on public.workout_sessions;
create trigger workout_sessions_normalize
  before insert or update on public.workout_sessions
  for each row execute function public.normalize_workout_session();

-- ─────────────────────────────────────────────────────────────
-- planned_sessions (planes): mismos tipos, sin 'custom'.
-- ─────────────────────────────────────────────────────────────
alter table public.planned_sessions drop constraint if exists planned_sessions_session_type_check;
update public.planned_sessions set session_type = 'fronton' where session_type = 'padel_fronton';
alter table public.planned_sessions add constraint planned_sessions_session_type_check check (
  session_type in (
    'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning', 'yoga',
    'fronton', 'padel', 'tennis', 'functional_class', 'gap', 'oxfit', 'surf', 'other'
  )
);

-- ─────────────────────────────────────────────────────────────
-- Datos guardados con padel_fronton: actividades fijas, reparto del compromiso e invitaciones
-- a entrenar juntos pendientes.
-- ─────────────────────────────────────────────────────────────
update public.training_profiles tp
set fixed_activities = (
  select jsonb_agg(
    case when x.f ->> 'type' = 'padel_fronton' then jsonb_set(x.f, '{type}', '"fronton"') else x.f end
    order by x.ord
  )
  from jsonb_array_elements(tp.fixed_activities) with ordinality as x (f, ord)
)
where jsonb_typeof(tp.fixed_activities) = 'array'
  and exists (
    select 1 from jsonb_array_elements(tp.fixed_activities) f where f ->> 'type' = 'padel_fronton'
  );

update public.commitments c
set by_type = (c.by_type - 'padel_fronton') || jsonb_build_object(
  'fronton',
  coalesce((c.by_type ->> 'fronton')::numeric, 0) + (c.by_type ->> 'padel_fronton')::numeric
)
where c.by_type ? 'padel_fronton';

update public.pair_invites pi
set payload = jsonb_set(pi.payload, '{session_type}', '"fronton"')
where pi.payload ->> 'session_type' = 'padel_fronton';

-- ─────────────────────────────────────────────────────────────
-- set_commitment (0011) con los tipos nuevos en el reparto.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_commitment(
  p_valid_from date,
  p_sessions_per_week integer,
  p_minutes_per_week integer default null,
  p_by_type jsonb default null,
  p_counts_free_activities boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if extract(isodow from p_valid_from) <> 1 then
    raise exception 'valid_from debe ser lunes';
  end if;
  if p_by_type is not null and exists (
    select 1 from jsonb_each(p_by_type) t
    where jsonb_typeof(t.value) <> 'number' or (t.value)::numeric < 0 or (t.value)::numeric > 14
      or t.key not in (
        'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning', 'yoga',
        'fronton', 'padel', 'tennis', 'functional_class', 'gap', 'oxfit', 'surf', 'other'
      )
  ) then
    raise exception 'by_type no válido';
  end if;

  delete from public.commitments c
  where c.user_id = uid and c.valid_from >= p_valid_from;

  update public.commitments c
  set valid_to = p_valid_from - 1
  where c.user_id = uid and (c.valid_to is null or c.valid_to >= p_valid_from);

  insert into public.commitments (
    user_id, valid_from, valid_to, sessions_per_week, minutes_per_week, by_type,
    counts_free_activities
  ) values (
    uid, p_valid_from, null, p_sessions_per_week, p_minutes_per_week,
    nullif(p_by_type, '{}'::jsonb), coalesce(p_counts_free_activities, true)
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.set_commitment(date, integer, integer, jsonb, boolean)
  from public, anon;
grant execute on function public.set_commitment(date, integer, integer, jsonb, boolean)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- save_workout_session (0004) + activity_type_id.
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
    id, user_id, planned_session_id, session_type, activity_type_id, title, started_at,
    ended_at, duration_min, rpe, distance_m, avg_hr, max_hr, calories, location, notes,
    pair_group_id, client_rev
  ) values (
    sid,
    uid,
    (s ->> 'planned_session_id')::uuid,
    coalesce(s ->> 'session_type', 'strength'),
    s ->> 'activity_type_id',
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
    activity_type_id = excluded.activity_type_id,
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

-- ─────────────────────────────────────────────────────────────
-- partner_sessions(): partner_session_log (0027) + activity_type_id, para ver sus actividades
-- personalizadas en su mapa y sus logros. Otro nombre para que 0027 se pueda volver a
-- ejecutar (cambia el tipo devuelto).
-- ─────────────────────────────────────────────────────────────
create or replace function public.partner_sessions(p_partner uuid)
returns table (
  id uuid,
  session_type text,
  activity_type_id text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_min integer,
  rpe smallint,
  distance_m numeric,
  tonnage_kg numeric,
  total_reps integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id, l.session_type, ws.activity_type_id, l.started_at, l.ended_at, l.duration_min,
    l.rpe, l.distance_m, l.tonnage_kg, l.total_reps
  from public.partner_session_log(p_partner) l
  join public.workout_sessions ws on ws.id = l.id
  order by l.started_at;
$$;

revoke all on function public.partner_sessions(uuid) from public, anon;
grant execute on function public.partner_sessions(uuid) to authenticated;

-- Función de trigger: nadie la llama directamente.
revoke all on function public.normalize_workout_session() from public, anon, authenticated;
