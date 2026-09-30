-- 0034_chat_ranges.sql
-- Bloque de varios días propuesto desde el chat (add_sessions_range, CLAUDE.md §11.5): una
-- tarjeta con varias sesiones (p. ej. de hoy al domingo) que se añaden al plan activo a la vez.
-- 1. respond_chat_range: aceptar (los días marcados, todos en una transacción) o descartar el
--    bloque `p_index` de ai_interactions.output.ranges. Se aplica la propuesta guardada, nunca la
--    del cliente; el cliente solo elige qué días. Si algún día elegido ya tiene una sesión
--    planificada pendiente, falla con «conflicto» salvo que se confirme (p_allow_conflicts): la
--    tarjeta avisa antes de aplicar.
-- El resultado se guarda en ai_interactions.action_results.ranges.{índice}.
-- Requiere 0017, 0025 y 0033. Idempotente.

create or replace function public.respond_chat_range(
  p_chat uuid,
  p_index integer,
  p_accept boolean,
  p_dates date[] default null,
  p_allow_conflicts boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.ai_interactions%rowtype;
  r jsonb;
  d jsonb;
  s jsonb;
  day date;
  plan public.user_plans%rowtype;
  chosen date[] := '{}';
  clashes date[];
  created integer := 0;
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
  if jsonb_typeof(c.output -> 'ranges') is distinct from 'array'
    or p_index is null or p_index < 0 or p_index >= jsonb_array_length(c.output -> 'ranges') then
    raise exception 'bloque no encontrado';
  end if;
  if c.action_results -> 'ranges' ? p_index::text then
    raise exception 'propuesta ya respondida';
  end if;
  r := c.output -> 'ranges' -> p_index;

  if not p_accept then
    result := jsonb_build_object('status', 'discarded');
  else
    select * into plan from public.user_plans up
    where up.user_id = uid and up.status = 'active'
    limit 1;
    if not found then
      raise exception 'no hay plan activo';
    end if;

    -- Días elegidos (todos si p_dates es null), en el orden de la propuesta.
    for d in select * from jsonb_array_elements(coalesce(r -> 'days', '[]'::jsonb)) loop
      begin
        day := (d ->> 'date')::date;
      exception when others then
        raise exception 'fecha no válida';
      end;
      if p_dates is null or day = any(p_dates) then
        if day is null or day < current_date - 1 then
          raise exception 'fecha no válida';
        end if;
        chosen := chosen || day;
      end if;
    end loop;
    if cardinality(chosen) = 0 then
      raise exception 'elige al menos un día';
    end if;

    select coalesce(array_agg(distinct ps.date order by ps.date), '{}') into clashes
    from public.planned_sessions ps
    where ps.user_id = uid and ps.user_plan_id = plan.id
      and ps.status in ('planned', 'moved') and ps.date = any(chosen);
    if cardinality(clashes) > 0 and not coalesce(p_allow_conflicts, false) then
      raise exception 'conflicto: ya tienes sesiones planificadas el %', array_to_string(clashes, ', ');
    end if;

    for d in select * from jsonb_array_elements(r -> 'days') loop
      day := (d ->> 'date')::date;
      continue when not (day = any(chosen));
      s := d -> 'session';
      if s is null or jsonb_typeof(s -> 'blocks') is distinct from 'array'
        or jsonb_array_length(s -> 'blocks') = 0 then
        raise exception 'la propuesta no trae sesión para el %', day;
      end if;
      insert into public.planned_sessions (
        user_plan_id, user_id, date, week, session_type, title, intensity, duration_min, notes,
        blocks, heavy_legs
      ) values (
        plan.id,
        uid,
        day,
        least(greatest(((day - plan.start_date) / 7) + 1, 1), 12)::smallint,
        coalesce(nullif(s ->> 'session_type', ''), 'other'),
        left(coalesce(nullif(s ->> 'title', ''), 'Sesión extra'), 120),
        case when s ->> 'intensity' in ('easy', 'moderate', 'hard')
          then s ->> 'intensity' else 'easy' end,
        least(greatest(coalesce((s ->> 'duration_min')::integer, 30), 1), 600)::smallint,
        left(concat_ws(' · ',
          'Añadida por la IA: ' || left(coalesce(r ->> 'reason', ''), 300),
          nullif(s ->> 'notes', '')), 1000),
        s -> 'blocks',
        coalesce((s ->> 'heavy_legs')::boolean, false)
      );
      created := created + 1;
    end loop;

    result := jsonb_build_object(
      'status', 'accepted',
      'created', created,
      'dates', to_jsonb(chosen),
      'conflicts', to_jsonb(clashes)
    );
  end if;

  update public.ai_interactions a
  set action_results = a.action_results || jsonb_build_object(
        'ranges',
        coalesce(a.action_results -> 'ranges', '{}'::jsonb)
          || jsonb_build_object(p_index::text, result)
      ),
      accepted = case when p_accept then true else a.accepted end
  where a.id = c.id;
  return result;
end;
$$;

revoke all on function public.respond_chat_range(uuid, integer, boolean, date[], boolean)
  from public, anon;
grant execute on function public.respond_chat_range(uuid, integer, boolean, date[], boolean)
  to authenticated;
