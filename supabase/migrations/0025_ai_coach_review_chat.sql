-- 0025_ai_coach_review_chat.sql
-- Fase 6B (CLAUDE.md §11.4–§11.6):
-- 1. ai_interactions.period (semana de la revisión semanal, para no repetirla) y
--    ai_interactions.responses (respuesta del usuario a cada cambio propuesto: índice →
--    'accepted' | 'discarded').
-- 2. begin_ai_interaction con p_period (evita dos revisiones de la misma semana a la vez) y
--    finish_ai_interaction con p_model (modelo que respondió de verdad, p. ej. el de reserva).
-- 3. ai_chat_messages: historial del chat con el entrenador. Solo se escribe por RPC
--    (save_chat_turn), a partir de una consulta de chat válida.
-- 4. respond_ai_change: aceptar o descartar un cambio del plan propuesto por la revisión
--    semanal o por el chat. Se aplica la propuesta guardada, nunca la del cliente.
-- Requiere 0017, 0023 y 0024. Idempotente.

-- ─────────────────────────────────────────────────────────────
-- 1. Columnas nuevas de ai_interactions
-- ─────────────────────────────────────────────────────────────
alter table public.ai_interactions
  add column if not exists period text check (period is null or length(period) <= 20);
alter table public.ai_interactions
  add column if not exists responses jsonb not null default '{}'::jsonb;

create index if not exists ai_interactions_user_kind_period_idx
  on public.ai_interactions (user_id, kind, period, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 2. begin / finish con los parámetros nuevos (se borran las versiones de 0024; las llamadas
--    antiguas siguen valiendo porque los parámetros nuevos tienen valor por defecto).
-- ─────────────────────────────────────────────────────────────
drop function if exists public.begin_ai_interaction(text, jsonb, integer, text, text, text);

create or replace function public.begin_ai_interaction(
  p_kind text,
  p_input_summary jsonb,
  p_daily_limit integer,
  p_tz text default 'Europe/Madrid',
  p_provider text default null,
  p_model text default null,
  p_period text default null
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

  -- Misma consulta de un periodo ya en curso (dos pestañas o dos móviles a la vez).
  if p_period is not null and exists (
    select 1 from public.ai_interactions a
    where a.user_id = uid and a.kind = p_kind and a.period = p_period
      and a.status = 'pending' and a.created_at > now() - interval '2 minutes'
  ) then
    raise exception 'ai_in_progress';
  end if;

  select count(*) into used
  from public.ai_interactions a
  where a.user_id = uid
    and a.status <> 'error'
    and (a.created_at at time zone tz)::date = (now() at time zone tz)::date;

  if used >= greatest(coalesce(p_daily_limit, 0), 0) then
    raise exception 'ai_daily_limit';
  end if;

  insert into public.ai_interactions (user_id, kind, input_summary, provider, model, period)
  values (uid, p_kind, p_input_summary, left(p_provider, 40), left(p_model, 80), left(p_period, 20))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.begin_ai_interaction(text, jsonb, integer, text, text, text, text)
  from public, anon;
grant execute on function public.begin_ai_interaction(text, jsonb, integer, text, text, text, text)
  to authenticated;

drop function if exists public.finish_ai_interaction(uuid, text, jsonb, integer, integer, text);

create or replace function public.finish_ai_interaction(
  p_id uuid,
  p_status text,
  p_output jsonb default null,
  p_tokens_in integer default null,
  p_tokens_out integer default null,
  p_error text default null,
  p_model text default null
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
      model = coalesce(left(p_model, 80), a.model),
      finished_at = now()
  where a.id = p_id and a.user_id = auth.uid() and a.status = 'pending';
end;
$$;

revoke all on function public.finish_ai_interaction(uuid, text, jsonb, integer, integer, text, text)
  from public, anon;
grant execute on function public.finish_ai_interaction(uuid, text, jsonb, integer, integer, text, text)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Chat con el entrenador
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  -- Orden estable (la pregunta y la respuesta se guardan en la misma transacción).
  seq bigint generated always as identity,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 4000),
  -- Consulta que produjo la respuesta (y sus cambios propuestos).
  interaction_id uuid references public.ai_interactions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_messages_user_seq_idx
  on public.ai_chat_messages (user_id, seq desc);

alter table public.ai_chat_messages enable row level security;
revoke all on public.ai_chat_messages from anon;
-- Leer y borrar las propias; escribir solo por save_chat_turn.
revoke insert, update on public.ai_chat_messages from authenticated;
grant select, delete on public.ai_chat_messages to authenticated;

drop policy if exists "ai_chat_messages_own" on public.ai_chat_messages;
create policy "ai_chat_messages_own" on public.ai_chat_messages
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- Guarda la pregunta y la respuesta de una consulta de chat válida (output.reply). Una sola vez
-- por consulta.
create or replace function public.save_chat_turn(p_interaction uuid, p_user_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  reply text;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_user_text is null or length(btrim(p_user_text)) = 0 then
    raise exception 'mensaje vacío';
  end if;
  select a.output ->> 'reply' into reply
  from public.ai_interactions a
  where a.id = p_interaction and a.user_id = uid and a.kind = 'chat' and a.status = 'ok'
  for update;
  if not found or reply is null or length(btrim(reply)) = 0 then
    raise exception 'consulta de chat no encontrada';
  end if;
  if exists (select 1 from public.ai_chat_messages m where m.interaction_id = p_interaction) then
    return;
  end if;
  insert into public.ai_chat_messages (user_id, role, content, interaction_id)
  values (uid, 'user', left(p_user_text, 4000), p_interaction);
  insert into public.ai_chat_messages (user_id, role, content, interaction_id)
  values (uid, 'assistant', left(reply, 4000), p_interaction);
end;
$$;

revoke all on function public.save_chat_turn(uuid, text) from public, anon;
grant execute on function public.save_chat_turn(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Cambios del plan propuestos (revisión semanal y chat)
-- output.changes[i] = { action: modify | move | skip | add, planned_session_id?, date?,
--   title, reason, session?: { session_type?, title, intensity, heavy_legs, duration_min,
--   notes?, blocks } }
-- modify y skip guardan la prescripción original en adjusted_from: «Deshacer» usa
-- revert_daily_adjust (0024).
-- ─────────────────────────────────────────────────────────────
create or replace function public.respond_ai_change(
  p_interaction uuid,
  p_index integer,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  a public.ai_interactions%rowtype;
  c jsonb;
  s jsonb;
  action text;
  reason text;
  new_date date;
  total integer;
  p public.planned_sessions%rowtype;
  plan public.user_plans%rowtype;
  original date;
  answers jsonb;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select * into a from public.ai_interactions ai
  where ai.id = p_interaction and ai.user_id = uid
    and ai.kind in ('weekly_review', 'chat') and ai.status = 'ok'
  for update;
  if not found then
    raise exception 'propuesta no encontrada';
  end if;
  if jsonb_typeof(a.output -> 'changes') <> 'array' then
    raise exception 'la propuesta no trae cambios';
  end if;
  total := jsonb_array_length(a.output -> 'changes');
  if p_index is null or p_index < 0 or p_index >= total then
    raise exception 'cambio no encontrado';
  end if;
  if a.responses ? p_index::text then
    raise exception 'cambio ya respondido';
  end if;

  c := a.output -> 'changes' -> p_index;
  action := c ->> 'action';
  reason := left(coalesce(c ->> 'reason', ''), 300);
  s := c -> 'session';

  if p_accept then
    if action in ('modify', 'move', 'skip') then
      select * into p from public.planned_sessions ps
      where ps.id::text = c ->> 'planned_session_id' and ps.user_id = uid
      for update;
      if not found then
        raise exception 'sesión planificada no encontrada';
      end if;
      if p.status not in ('planned', 'moved') then
        raise exception 'la sesión ya no está pendiente';
      end if;
    end if;

    if action in ('move', 'add') then
      begin
        new_date := (c ->> 'date')::date;
      exception when others then
        raise exception 'fecha no válida';
      end;
      if new_date is null or new_date < current_date - 1 then
        raise exception 'fecha no válida';
      end if;
    end if;

    if action in ('modify', 'add') and (
      s is null or jsonb_typeof(s -> 'blocks') <> 'array' or jsonb_array_length(s -> 'blocks') = 0
    ) then
      raise exception 'la propuesta no trae sesión';
    end if;

    if action = 'modify' then
      update public.planned_sessions ps
      set adjusted_from = coalesce(ps.adjusted_from, jsonb_build_object(
            'title', p.title, 'intensity', p.intensity, 'duration_min', p.duration_min,
            'notes', p.notes, 'blocks', p.blocks, 'heavy_legs', p.heavy_legs, 'status', p.status
          )),
          title = left(coalesce(nullif(s ->> 'title', ''), p.title), 120),
          intensity = case when s ->> 'intensity' in ('easy', 'moderate', 'hard')
            then s ->> 'intensity' else p.intensity end,
          duration_min = coalesce(
            least(greatest((s ->> 'duration_min')::integer, 1), 600)::smallint, p.duration_min),
          heavy_legs = coalesce((s ->> 'heavy_legs')::boolean, p.heavy_legs),
          notes = left(concat_ws(' · ', 'Cambio de la IA: ' || reason, nullif(s ->> 'notes', '')), 1000),
          blocks = s -> 'blocks'
      where ps.id = p.id;
    elsif action = 'skip' then
      update public.planned_sessions ps
      set adjusted_from = coalesce(ps.adjusted_from, jsonb_build_object(
            'title', p.title, 'intensity', p.intensity, 'duration_min', p.duration_min,
            'notes', p.notes, 'blocks', p.blocks, 'heavy_legs', p.heavy_legs, 'status', p.status
          )),
          status = 'skipped',
          notes = left('Descanso (IA): ' || reason, 1000)
      where ps.id = p.id;
    elsif action = 'move' then
      original := coalesce(p.original_date, p.date);
      update public.planned_sessions ps
      set date = new_date,
          original_date = case when original = new_date then null else original end,
          status = case when original = new_date then 'planned' else 'moved' end
      where ps.id = p.id;
    elsif action = 'add' then
      select * into plan from public.user_plans up
      where up.user_id = uid and up.status = 'active'
      limit 1;
      if not found then
        raise exception 'no hay plan activo';
      end if;
      insert into public.planned_sessions (
        user_plan_id, user_id, date, week, session_type, title, intensity, duration_min, notes,
        blocks, heavy_legs
      ) values (
        plan.id,
        uid,
        new_date,
        least(greatest(((new_date - plan.start_date) / 7) + 1, 1), 12)::smallint,
        coalesce(nullif(s ->> 'session_type', ''), 'strength'),
        left(coalesce(nullif(s ->> 'title', ''), 'Sesión extra'), 120),
        case when s ->> 'intensity' in ('easy', 'moderate', 'hard')
          then s ->> 'intensity' else 'moderate' end,
        least(greatest(coalesce((s ->> 'duration_min')::integer, 45), 1), 600)::smallint,
        left(concat_ws(' · ', 'Añadida por la IA: ' || reason, nullif(s ->> 'notes', '')), 1000),
        s -> 'blocks',
        coalesce((s ->> 'heavy_legs')::boolean, false)
      );
    else
      raise exception 'acción no válida';
    end if;
  end if;

  answers := a.responses || jsonb_build_object(
    p_index::text, case when p_accept then 'accepted' else 'discarded' end
  );
  update public.ai_interactions ai
  set responses = answers,
      accepted = case
        when p_accept then true
        when ai.accepted is true then true
        when (select count(*) from jsonb_object_keys(answers)) >= total then false
        else ai.accepted
      end
  where ai.id = a.id;

  return case when p_accept then action else 'discarded' end;
end;
$$;

revoke all on function public.respond_ai_change(uuid, integer, boolean) from public, anon;
grant execute on function public.respond_ai_change(uuid, integer, boolean) to authenticated;
