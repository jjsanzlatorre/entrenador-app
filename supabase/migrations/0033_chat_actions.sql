-- 0033_chat_actions.sql
-- Acciones del chat del entrenador (CLAUDE.md §11.5): además de los cambios de sesiones
-- (respond_ai_change, 0025), el chat puede proponer crear un plan (create_plan) y ajustar el
-- entreno de hoy (adjust_today). Nada se aplica sin que el usuario pulse el botón de la tarjeta.
-- 1. ai_interactions.action_results: resultado real de cada acción del chat («plan», «adjust»),
--    escrito solo por estas funciones; la tarjeta muestra la confirmación a partir de él.
-- 2. link_chat_plan: enlaza la respuesta del chat con el plan generado (plan_generation) a
--    partir de su propuesta. Se genera con el mismo flujo que «Personalizar con IA».
-- 3. accept_chat_plan: crea el plan (create_user_plan, origen «ai») y devuelve lo que ha quedado
--    en la base de datos (sesiones, semanas, sesiones por semana, plan sustituido).
-- 4. apply_chat_adjust: aplica el ajuste del día (apply_daily_adjust) pedido desde el chat.
-- 5. discard_chat_action: descartar la propuesta de plan o de ajuste.
-- Requiere 0024 y 0025. Idempotente.

alter table public.ai_interactions
  add column if not exists action_results jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 2. Enlazar la respuesta del chat con el plan generado
-- ─────────────────────────────────────────────────────────────
create or replace function public.link_chat_plan(p_chat uuid, p_plan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.ai_interactions%rowtype;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select * into c from public.ai_interactions a
  where a.id = p_chat and a.user_id = uid and a.kind = 'chat' and a.status = 'ok'
  for update;
  if not found then
    raise exception 'consulta de chat no encontrada';
  end if;
  if jsonb_typeof(c.output -> 'plan_request') is distinct from 'object' then
    raise exception 'la respuesta no propone un plan';
  end if;
  if c.action_results -> 'plan' ->> 'status' in ('accepted', 'discarded') then
    raise exception 'propuesta ya respondida';
  end if;
  if not exists (
    select 1 from public.ai_interactions p
    where p.id = p_plan and p.user_id = uid and p.kind = 'plan_generation' and p.status = 'ok'
  ) then
    raise exception 'plan no encontrado';
  end if;

  update public.ai_interactions a
  set action_results = a.action_results || jsonb_build_object(
    'plan', jsonb_build_object('status', 'prepared', 'interaction_id', p_plan)
  )
  where a.id = p_chat;
end;
$$;

revoke all on function public.link_chat_plan(uuid, uuid) from public, anon;
grant execute on function public.link_chat_plan(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Crear el plan propuesto desde el chat
-- p_sessions: sesiones con fecha (reparto del programador del móvil, como al aceptar un plan de
-- «Personalizar con IA»). La plantilla base, el nombre por defecto y el resumen salen de la
-- propuesta guardada.
-- ─────────────────────────────────────────────────────────────
create or replace function public.accept_chat_plan(
  p_chat uuid,
  p_name text,
  p_start_date date,
  p_sessions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.ai_interactions%rowtype;
  p public.ai_interactions%rowtype;
  plan_interaction uuid;
  previous text;
  new_plan uuid;
  new_name text;
  total integer;
  week_count integer;
  per_week integer;
  result jsonb;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select * into c from public.ai_interactions a
  where a.id = p_chat and a.user_id = uid and a.kind = 'chat' and a.status = 'ok'
  for update;
  if not found then
    raise exception 'consulta de chat no encontrada';
  end if;
  if c.action_results -> 'plan' ->> 'status' = 'accepted' then
    raise exception 'el plan ya se ha creado';
  end if;
  if c.action_results -> 'plan' ->> 'status' is distinct from 'prepared' then
    raise exception 'no hay ningún plan preparado';
  end if;

  plan_interaction := (c.action_results -> 'plan' ->> 'interaction_id')::uuid;
  select * into p from public.ai_interactions a
  where a.id = plan_interaction and a.user_id = uid and a.kind = 'plan_generation'
    and a.status = 'ok';
  if not found then
    raise exception 'plan no encontrado';
  end if;

  select up.name into previous from public.user_plans up
  where up.user_id = uid and up.status = 'active'
  limit 1;

  new_plan := public.create_user_plan(
    nullif(p.output -> 'proposal' ->> 'baseTemplateId', ''),
    coalesce(nullif(btrim(p_name), ''), p.output -> 'proposal' ->> 'name', 'Plan de la IA'),
    p_start_date,
    p_sessions,
    'ai',
    p.output -> 'proposal' ->> 'summary'
  );

  select up.name into new_name from public.user_plans up where up.id = new_plan;
  select count(*)::integer, count(distinct ps.week)::integer into total, week_count
  from public.planned_sessions ps where ps.user_plan_id = new_plan;
  select coalesce(max(x.n), 0)::integer into per_week
  from (
    select count(*) as n from public.planned_sessions ps
    where ps.user_plan_id = new_plan group by ps.week
  ) x;

  update public.ai_interactions a set accepted = true where a.id = plan_interaction;

  result := jsonb_build_object(
    'status', 'accepted',
    'interaction_id', plan_interaction,
    'plan_id', new_plan,
    'name', new_name,
    'start_date', p_start_date,
    'sessions', total,
    'weeks', week_count,
    'per_week', per_week,
    'replaced', previous
  );
  update public.ai_interactions a
  set action_results = a.action_results || jsonb_build_object('plan', result),
      accepted = true
  where a.id = p_chat;
  return result;
end;
$$;

revoke all on function public.accept_chat_plan(uuid, text, date, jsonb) from public, anon;
grant execute on function public.accept_chat_plan(uuid, text, date, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Ajuste del día pedido desde el chat
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_chat_adjust(p_chat uuid, p_adjust uuid, p_planned uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.ai_interactions%rowtype;
  decision text;
  ps public.planned_sessions%rowtype;
  result jsonb;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select * into c from public.ai_interactions a
  where a.id = p_chat and a.user_id = uid and a.kind = 'chat' and a.status = 'ok'
  for update;
  if not found then
    raise exception 'consulta de chat no encontrada';
  end if;
  if jsonb_typeof(c.output -> 'adjust_today') is distinct from 'object' then
    raise exception 'la respuesta no propone un ajuste';
  end if;
  if c.action_results -> 'adjust' ->> 'status' in ('accepted', 'discarded') then
    raise exception 'propuesta ya respondida';
  end if;

  decision := public.apply_daily_adjust(p_adjust, p_planned);

  select * into ps from public.planned_sessions s where s.id = p_planned and s.user_id = uid;
  result := jsonb_build_object(
    'status', 'accepted',
    'interaction_id', p_adjust,
    'decision', decision,
    'planned_session_id', p_planned,
    'date', ps.date,
    'title', ps.title,
    'session_status', ps.status
  );
  update public.ai_interactions a
  set action_results = a.action_results || jsonb_build_object('adjust', result),
      accepted = true
  where a.id = p_chat;
  return result;
end;
$$;

revoke all on function public.apply_chat_adjust(uuid, uuid, uuid) from public, anon;
grant execute on function public.apply_chat_adjust(uuid, uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Descartar la propuesta de plan o de ajuste del chat
-- ─────────────────────────────────────────────────────────────
create or replace function public.discard_chat_action(p_chat uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.ai_interactions%rowtype;
  prepared uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_key is null or p_key not in ('plan', 'adjust') then
    raise exception 'acción no válida';
  end if;

  select * into c from public.ai_interactions a
  where a.id = p_chat and a.user_id = uid and a.kind = 'chat' and a.status = 'ok'
  for update;
  if not found then
    raise exception 'consulta de chat no encontrada';
  end if;
  if jsonb_typeof(c.output -> (case when p_key = 'plan' then 'plan_request' else 'adjust_today' end))
    is distinct from 'object' then
    raise exception 'la respuesta no trae esa propuesta';
  end if;
  if c.action_results -> p_key ->> 'status' = 'accepted' then
    raise exception 'propuesta ya aceptada';
  end if;

  prepared := nullif(c.action_results -> p_key ->> 'interaction_id', '')::uuid;
  if prepared is not null then
    update public.ai_interactions a set accepted = false
    where a.id = prepared and a.user_id = uid and a.accepted is null;
  end if;

  update public.ai_interactions a
  set action_results = a.action_results || jsonb_build_object(
    p_key, jsonb_build_object('status', 'discarded')
  )
  where a.id = p_chat;
end;
$$;

revoke all on function public.discard_chat_action(uuid, text) from public, anon;
grant execute on function public.discard_chat_action(uuid, text) to authenticated;
