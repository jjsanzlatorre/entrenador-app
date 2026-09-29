-- 0024_ai_coach.sql
-- Fase 6A (CLAUDE.md §4 «IA y social», §11 y §12):
-- 1. ai_interactions: registro de cada consulta a la IA (entrada resumida, salida, tokens,
--    aceptada o no). El usuario solo lee las suyas y solo cambia «accepted».
-- 2. begin_ai_interaction / finish_ai_interaction: abren y cierran una consulta. begin comprueba
--    el límite diario por usuario (en su zona horaria) de forma atómica.
-- 3. create_user_plan con p_source ('template' | 'ai') y p_notes.
-- 4. planned_sessions.adjusted_from + apply_daily_adjust / revert_daily_adjust: aplicar (y
--    deshacer) el ajuste del día propuesto por la IA, solo cuando el usuario lo acepta.
-- Requiere 0017 y 0023. Idempotente.

-- ─────────────────────────────────────────────────────────────
-- 1. ai_interactions
-- status: pending (en curso) | ok (salida válida) | invalid (la IA no dio una salida usable)
--         | error (fallo del proveedor; no cuenta para el límite diario).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'plan_generation', 'daily_adjust', 'weekly_review', 'chat', 'exercise_swap'
  )),
  status text not null default 'pending' check (status in ('pending', 'ok', 'invalid', 'error')),
  provider text,
  model text,
  input_summary jsonb,
  output jsonb,
  error text check (error is null or length(error) <= 1000),
  accepted boolean,
  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ai_interactions_user_created_idx
  on public.ai_interactions (user_id, created_at desc);

alter table public.ai_interactions enable row level security;
revoke all on public.ai_interactions from anon;
-- Sin insert ni delete directos (el límite diario se cuenta sobre estas filas).
revoke insert, update, delete on public.ai_interactions from authenticated;
grant select on public.ai_interactions to authenticated;
grant update (accepted) on public.ai_interactions to authenticated;

drop policy if exists "ai_interactions_own" on public.ai_interactions;
create policy "ai_interactions_own" on public.ai_interactions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- Zona horaria válida o Europe/Madrid.
create or replace function public.safe_timezone(p_tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
      then p_tz
    else 'Europe/Madrid'
  end;
$$;

-- Consultas que cuentan para el límite (todas menos los fallos del proveedor) hechas hoy.
create or replace function public.ai_calls_today(p_tz text default 'Europe/Madrid')
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
  from public.ai_interactions a
  where a.user_id = (select auth.uid())
    and a.status <> 'error'
    and (a.created_at at time zone public.safe_timezone(p_tz))::date
      = (now() at time zone public.safe_timezone(p_tz))::date;
$$;

revoke all on function public.ai_calls_today(text) from public, anon;
grant execute on function public.ai_calls_today(text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. begin_ai_interaction: crea la fila «pending» si no se ha llegado al límite; si se ha
--    llegado, error 'ai_daily_limit'. El bloqueo por usuario evita que dos consultas a la vez
--    se salten el límite. SECURITY DEFINER (insert directo revocado).
-- ─────────────────────────────────────────────────────────────
create or replace function public.begin_ai_interaction(
  p_kind text,
  p_input_summary jsonb,
  p_daily_limit integer,
  p_tz text default 'Europe/Madrid',
  p_provider text default null,
  p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tz text := public.safe_timezone(p_tz);
  used integer;
  new_id uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_interactions:' || uid::text, 0));

  select count(*) into used
  from public.ai_interactions a
  where a.user_id = uid
    and a.status <> 'error'
    and (a.created_at at time zone tz)::date = (now() at time zone tz)::date;

  if used >= greatest(coalesce(p_daily_limit, 0), 0) then
    raise exception 'ai_daily_limit';
  end if;

  insert into public.ai_interactions (user_id, kind, input_summary, provider, model)
  values (uid, p_kind, p_input_summary, left(p_provider, 40), left(p_model, 80))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.begin_ai_interaction(text, jsonb, integer, text, text, text)
  from public, anon;
grant execute on function public.begin_ai_interaction(text, jsonb, integer, text, text, text)
  to authenticated;

-- finish_ai_interaction: cierra una consulta propia que sigue «pending».
create or replace function public.finish_ai_interaction(
  p_id uuid,
  p_status text,
  p_output jsonb default null,
  p_tokens_in integer default null,
  p_tokens_out integer default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_status not in ('ok', 'invalid', 'error') then
    raise exception 'estado no válido';
  end if;
  update public.ai_interactions a
  set status = p_status,
      output = p_output,
      tokens_in = p_tokens_in,
      tokens_out = p_tokens_out,
      error = left(p_error, 1000),
      finished_at = now()
  where a.id = p_id and a.user_id = auth.uid() and a.status = 'pending';
end;
$$;

revoke all on function public.finish_ai_interaction(uuid, text, jsonb, integer, integer, text)
  from public, anon;
grant execute on function public.finish_ai_interaction(uuid, text, jsonb, integer, integer, text)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. create_user_plan con origen y notas. Se borra la versión de 4 argumentos (0017/0023) para
--    que no haya dos sobrecargas; las llamadas con 4 argumentos siguen funcionando (defaults).
-- ─────────────────────────────────────────────────────────────
drop function if exists public.create_user_plan(text, text, date, jsonb);

create or replace function public.create_user_plan(
  p_template_id text,
  p_name text,
  p_start_date date,
  p_sessions jsonb,
  p_source text default 'template',
  p_notes text default null
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
  if coalesce(p_source, 'template') not in ('template', 'ai') then
    raise exception 'origen no válido';
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

  insert into public.user_plans (user_id, template_id, name, start_date, status, source, notes)
  values (
    uid, p_template_id, left(p_name, 120), p_start_date, 'active', coalesce(p_source, 'template'),
    left(p_notes, 2000)
  )
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

revoke all on function public.create_user_plan(text, text, date, jsonb, text, text)
  from public, anon;
grant execute on function public.create_user_plan(text, text, date, jsonb, text, text)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Ajuste del día. adjusted_from guarda la prescripción original (para deshacer).
-- ─────────────────────────────────────────────────────────────
alter table public.planned_sessions
  add column if not exists adjusted_from jsonb;

-- Aplica la propuesta guardada en ai_interactions (output = { proposal: { plannedSessionId,
-- adjust: { decision, reason, session? } } }) a la sesión planificada para la que se pidió. Solo si la consulta es del usuario, de tipo daily_adjust, válida y aún sin
-- responder, y la planificada es suya y sigue pendiente.
create or replace function public.apply_daily_adjust(p_interaction uuid, p_planned uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  proposal jsonb;
  decision text;
  reason text;
  s jsonb;
  p public.planned_sessions%rowtype;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select a.output -> 'proposal' -> 'adjust' into proposal
  from public.ai_interactions a
  where a.id = p_interaction and a.user_id = uid and a.kind = 'daily_adjust'
    and a.status = 'ok' and a.accepted is null
    and a.output -> 'proposal' ->> 'plannedSessionId' = p_planned::text
  for update;
  if not found or proposal is null then
    raise exception 'propuesta no encontrada o ya respondida';
  end if;

  select * into p from public.planned_sessions ps
  where ps.id = p_planned and ps.user_id = uid
  for update;
  if not found then
    raise exception 'sesión planificada no encontrada';
  end if;
  if p.status not in ('planned', 'moved') then
    raise exception 'la sesión ya no está pendiente';
  end if;

  decision := proposal ->> 'decision';
  reason := left(coalesce(proposal ->> 'reason', ''), 300);
  s := proposal -> 'session';

  if decision in ('reduce', 'change', 'rest') then
    update public.planned_sessions ps
    set adjusted_from = coalesce(ps.adjusted_from, jsonb_build_object(
      'title', p.title, 'intensity', p.intensity, 'duration_min', p.duration_min,
      'notes', p.notes, 'blocks', p.blocks, 'heavy_legs', p.heavy_legs, 'status', p.status
    ))
    where ps.id = p.id;
  end if;

  if decision = 'rest' then
    update public.planned_sessions ps
    set status = 'skipped', notes = left('Descanso (IA): ' || reason, 1000)
    where ps.id = p.id;
  elsif decision in ('reduce', 'change') then
    if s is null or jsonb_typeof(s -> 'blocks') <> 'array'
      or jsonb_array_length(s -> 'blocks') = 0 then
      raise exception 'la propuesta no trae sesión';
    end if;
    update public.planned_sessions ps
    set title = left(coalesce(nullif(s ->> 'title', ''), p.title), 120),
        intensity = case when s ->> 'intensity' in ('easy', 'moderate', 'hard')
          then s ->> 'intensity' else p.intensity end,
        duration_min = coalesce(
          least(greatest((s ->> 'duration_min')::integer, 1), 600)::smallint, p.duration_min),
        heavy_legs = coalesce((s ->> 'heavy_legs')::boolean, p.heavy_legs),
        notes = left(concat_ws(' · ', 'Ajustada por la IA: ' || reason, nullif(s ->> 'notes', '')), 1000),
        blocks = s -> 'blocks'
    where ps.id = p.id;
  elsif decision <> 'keep' then
    raise exception 'decisión no válida';
  end if;

  update public.ai_interactions a set accepted = true where a.id = p_interaction;
  return decision;
end;
$$;

revoke all on function public.apply_daily_adjust(uuid, uuid) from public, anon;
grant execute on function public.apply_daily_adjust(uuid, uuid) to authenticated;

-- Deshace un ajuste aplicado: la sesión vuelve a su prescripción y a pendiente.
create or replace function public.revert_daily_adjust(p_planned uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p public.planned_sessions%rowtype;
  o jsonb;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  select * into p from public.planned_sessions ps
  where ps.id = p_planned and ps.user_id = uid
  for update;
  if not found or p.adjusted_from is null then
    raise exception 'no hay ajuste que deshacer';
  end if;
  if p.status = 'done' then
    raise exception 'la sesión ya está hecha';
  end if;
  o := p.adjusted_from;
  update public.planned_sessions ps
  set title = coalesce(o ->> 'title', ps.title),
      intensity = coalesce(o ->> 'intensity', ps.intensity),
      duration_min = (o ->> 'duration_min')::smallint,
      notes = o ->> 'notes',
      blocks = coalesce(o -> 'blocks', ps.blocks),
      heavy_legs = coalesce((o ->> 'heavy_legs')::boolean, ps.heavy_legs),
      status = case when ps.original_date is not null then 'moved' else 'planned' end,
      adjusted_from = null
  where ps.id = p.id;
end;
$$;

revoke all on function public.revert_daily_adjust(uuid) from public, anon;
grant execute on function public.revert_daily_adjust(uuid) to authenticated;
