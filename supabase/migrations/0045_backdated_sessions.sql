-- 0045_backdated_sessions.sql
-- Entrenos con fecha pasada (registrar a posteriori y cambiar la fecha de una sesión).
-- Casi todo se recalcula solo: los récords se rehacen con la fecha real (ended_at) al guardar
-- las series (0008), la planificada se enlaza al guardar (0017) y el cumplimiento, la carga, el
-- mapa y los logros se calculan a partir de las sesiones. Lo que falta: saber que una revisión
-- semanal ya generada se ha quedado desactualizada porque cambian los entrenos de su semana.
--   ai_interactions.stale_at: cuándo se registró, cambió o borró un entreno de la semana
--   revisada después de generarla (null = al día). Regenerar crea otra fila, al día.
-- Idempotente.

alter table public.ai_interactions add column if not exists stale_at timestamptz;

-- Semana (lunes) de un instante en la zona horaria del usuario (la de sus notificaciones; si no
-- la tiene, Europe/Madrid, la de la app).
create or replace function public.user_week_start(p_user uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc(
    'week',
    p_at at time zone public.safe_timezone(
      coalesce(
        (select n.tz from public.notification_settings n where n.user_id = p_user),
        'Europe/Madrid'
      )
    )
  )::date;
$$;

revoke all on function public.user_week_start(uuid, timestamptz) from public, anon, authenticated;

-- Marca como desactualizadas las revisiones semanales de las semanas afectadas por un cambio en
-- una sesión terminada (nueva, borrada o con otra fecha, duración, RPE, tipo o distancia).
create or replace function public.mark_weekly_reviews_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  weeks date[] := '{}';
  uid uuid;
begin
  if tg_op = 'UPDATE'
    and old.started_at is not distinct from new.started_at
    and old.ended_at is not distinct from new.ended_at
    and old.duration_min is not distinct from new.duration_min
    and old.rpe is not distinct from new.rpe
    and old.session_type is not distinct from new.session_type
    and old.activity_type_id is not distinct from new.activity_type_id
    and old.distance_m is not distinct from new.distance_m
    and old.planned_session_id is not distinct from new.planned_session_id then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.ended_at is not null then
    uid := old.user_id;
    weeks := weeks || public.user_week_start(old.user_id, old.started_at);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.ended_at is not null then
    uid := new.user_id;
    weeks := weeks || public.user_week_start(new.user_id, new.started_at);
  end if;
  if uid is null or cardinality(weeks) = 0 then
    return null;
  end if;

  update public.ai_interactions a
  set stale_at = now()
  where a.user_id = uid
    and a.kind = 'weekly_review'
    and a.status = 'ok'
    and a.stale_at is null
    and a.period = any (weeks::text[]);
  return null;
end;
$$;

revoke all on function public.mark_weekly_reviews_stale() from public, anon, authenticated;

drop trigger if exists workout_sessions_stale_reviews on public.workout_sessions;
create trigger workout_sessions_stale_reviews
  after insert or update or delete on public.workout_sessions
  for each row execute function public.mark_weekly_reviews_stale();
