-- 0016_muscle_volume.sql
-- Mapa muscular (CLAUDE.md §5, fase 4): series efectivas por sesión y ejercicio en un rango
-- de fechas. El reparto por músculo (1 principal, 0,5 secundario) y la aproximación de cardio
-- se hacen en el cliente con el catálogo, así también funcionan las sesiones pendientes de subir.
-- Serie efectiva = completada y no de calentamiento. Solo sesiones terminadas del usuario.
-- SECURITY INVOKER: la RLS de las tablas se aplica igual.
-- Idempotente.

create or replace function public.session_exercise_sets(p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, exercise_id text, sets integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select ws.id as session_id, es.exercise_id, count(*)::integer as sets
  from public.workout_sessions ws
  join public.exercise_sets es
    on es.session_id = ws.id and es.completed and not es.is_warmup
  where ws.user_id = (select auth.uid())
    and ws.ended_at is not null
    and ws.started_at >= p_from
    and ws.started_at < p_to
  group by ws.id, es.exercise_id;
$$;

revoke all on function public.session_exercise_sets(timestamptz, timestamptz) from public, anon;
grant execute on function public.session_exercise_sets(timestamptz, timestamptz) to authenticated;
