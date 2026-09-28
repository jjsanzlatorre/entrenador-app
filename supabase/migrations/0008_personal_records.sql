-- 0008_personal_records.sql
-- Récords personales (PRs). Se calculan en la base de datos a partir de las series de las
-- sesiones terminadas, así se mantienen correctos al editar o borrar una sesión antigua.
-- Cada fila es un «evento de récord»: la primera marca de un tipo (previous_value null, sirve
-- de referencia) y cada mejora posterior (previous_value = la marca que se ha superado).
-- Idempotente.

create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on delete cascade,
  pr_type text not null check (
    pr_type in (
      'est_1rm', 'max_weight', 'max_reps_at_weight', 'best_time', 'longest_distance', 'best_pace'
    )
  ),
  value numeric not null,
  -- kg | reps | s | m | s/km | s/100m
  unit text not null,
  -- Solo en max_reps_at_weight: el peso con el que se hicieron las reps (0 = peso corporal).
  weight_kg numeric,
  previous_value numeric,
  set_id uuid references public.exercise_sets (id) on delete cascade,
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  achieved_at timestamptz not null
);

create index if not exists personal_records_user_exercise_idx
  on public.personal_records (user_id, exercise_id, pr_type, achieved_at);
create index if not exists personal_records_session_idx on public.personal_records (session_id);

alter table public.personal_records enable row level security;
revoke all on public.personal_records from anon;
revoke insert, update, delete on public.personal_records from authenticated;
grant select on public.personal_records to authenticated;

drop policy if exists "personal_records_select_own" on public.personal_records;
create policy "personal_records_select_own" on public.personal_records
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- recompute_personal_records(user, exercise): rehace el historial de récords de un ejercicio.
-- Solo cuentan series completadas, que no son de calentamiento, de sesiones terminadas.
--   est_1rm             Epley peso × (1 + reps/30), reps 1–10 (CLAUDE.md §10)
--   max_weight          peso máximo con al menos 1 rep
--   max_reps_at_weight  más reps que nunca con ese peso o más (0 = peso corporal)
--   best_time           tiempo más largo en ejercicios por tiempo (plancha…)
--   longest_distance    distancia más larga en una serie
--   best_pace           mejor ritmo en una serie: s/km (≥ 1 km) o s/100 m en natación (≥ 100 m)
-- ─────────────────────────────────────────────────────────────
create or replace function public.recompute_personal_records(p_user uuid, p_exercise text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.personal_records pr
  where pr.user_id = p_user and pr.exercise_id = p_exercise;

  -- Récords «el mayor valor gana» (o el menor en el ritmo: se ordena por score = ±valor).
  insert into public.personal_records (
    user_id, exercise_id, pr_type, value, unit, weight_kg, previous_value, set_id, session_id,
    achieved_at
  )
  with s as (
    select
      es.id as set_id, es.session_id, ws.ended_at as achieved_at, es.weight_kg, es.reps,
      es.duration_s, es.distance_m, e.tracking_type, (es.exercise_id like 'swim%') as is_swim
    from public.exercise_sets es
    join public.workout_sessions ws on ws.id = es.session_id
    join public.exercises e on e.id = es.exercise_id
    where es.user_id = p_user
      and es.exercise_id = p_exercise
      and es.completed
      and not es.is_warmup
      and ws.ended_at is not null
  ),
  candidates as (
    select 'est_1rm'::text as pr_type, round(weight_kg * (1 + reps / 30.0), 1) as value,
      'kg'::text as unit, set_id, session_id, achieved_at
    from s
    where tracking_type = 'weight_reps' and weight_kg > 0 and reps between 1 and 10
    union all
    select 'max_weight', weight_kg, 'kg', set_id, session_id, achieved_at
    from s
    where weight_kg > 0 and coalesce(reps, 0) >= 1
    union all
    select 'best_time', duration_s, 's', set_id, session_id, achieved_at
    from s
    where tracking_type = 'time' and duration_s > 0
    union all
    select 'longest_distance', distance_m, 'm', set_id, session_id, achieved_at
    from s
    where distance_m > 0
    union all
    select 'best_pace',
      round(duration_s / (distance_m / case when is_swim then 100 else 1000 end), 1),
      case when is_swim then 's/100m' else 's/km' end,
      set_id, session_id, achieved_at
    from s
    where duration_s > 0 and distance_m >= case when is_swim then 100 else 1000 end
  ),
  scored as (
    select c.*, case when c.pr_type = 'best_pace' then -c.value else c.value end as score
    from candidates c
  ),
  per_session as (
    select distinct on (pr_type, session_id) *
    from scored
    order by pr_type, session_id, score desc, set_id
  ),
  ranked as (
    select p.*,
      max(p.score) over (
        partition by p.pr_type order by p.achieved_at, p.session_id
        rows between unbounded preceding and 1 preceding
      ) as prev_score
    from per_session p
  )
  select p_user, p_exercise, r.pr_type, r.value, r.unit, null,
    case when r.prev_score is null then null
         when r.pr_type = 'best_pace' then -r.prev_score
         else r.prev_score end,
    r.set_id, r.session_id, r.achieved_at
  from ranked r
  where r.prev_score is null or r.score > r.prev_score;

  -- Reps con un peso: la serie cuenta si ninguna serie anterior tiene ≥ peso y ≥ reps.
  insert into public.personal_records (
    user_id, exercise_id, pr_type, value, unit, weight_kg, previous_value, set_id, session_id,
    achieved_at
  )
  with s as (
    select distinct on (es.session_id, coalesce(es.weight_kg, 0), es.reps)
      es.id as set_id, es.session_id, ws.ended_at as achieved_at,
      coalesce(es.weight_kg, 0) as w, es.reps as r
    from public.exercise_sets es
    join public.workout_sessions ws on ws.id = es.session_id
    join public.exercises e on e.id = es.exercise_id
    where es.user_id = p_user
      and es.exercise_id = p_exercise
      and es.completed
      and not es.is_warmup
      and ws.ended_at is not null
      and e.tracking_type in ('weight_reps', 'reps')
      and es.reps >= 1
    order by es.session_id, coalesce(es.weight_kg, 0), es.reps, es.id
  ),
  -- Dentro de la sesión, solo las series que no quedan superadas por otra de la misma sesión.
  frontier as (
    select a.*
    from s a
    where not exists (
      select 1 from s b
      where b.session_id = a.session_id
        and b.w >= a.w and b.r >= a.r and (b.w > a.w or b.r > a.r)
    )
  )
  select p_user, p_exercise, 'max_reps_at_weight', f.r, 'reps', f.w,
    (select max(b.r) from s b
      where (b.achieved_at, b.session_id) < (f.achieved_at, f.session_id) and b.w >= f.w),
    f.set_id, f.session_id, f.achieved_at
  from frontier f
  where not exists (
    select 1 from s b
    where (b.achieved_at, b.session_id) < (f.achieved_at, f.session_id)
      and b.w >= f.w and b.r >= f.r
  );
end;
$$;

revoke all on function public.recompute_personal_records(uuid, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Triggers: al guardar, editar o borrar series (también en cascada al borrar una sesión)
-- se rehacen los récords de los ejercicios afectados.
-- ─────────────────────────────────────────────────────────────
create or replace function public.exercise_sets_refresh_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    for r in select distinct user_id, exercise_id from new_rows loop
      perform public.recompute_personal_records(r.user_id, r.exercise_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for r in select distinct user_id, exercise_id from old_rows loop
      perform public.recompute_personal_records(r.user_id, r.exercise_id);
    end loop;
  else
    for r in
      select user_id, exercise_id from new_rows
      union
      select user_id, exercise_id from old_rows
    loop
      perform public.recompute_personal_records(r.user_id, r.exercise_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.exercise_sets_refresh_records() from public, anon, authenticated;

drop trigger if exists exercise_sets_records_insert on public.exercise_sets;
create trigger exercise_sets_records_insert
  after insert on public.exercise_sets
  referencing new table as new_rows
  for each statement execute function public.exercise_sets_refresh_records();

drop trigger if exists exercise_sets_records_update on public.exercise_sets;
create trigger exercise_sets_records_update
  after update on public.exercise_sets
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.exercise_sets_refresh_records();

drop trigger if exists exercise_sets_records_delete on public.exercise_sets;
create trigger exercise_sets_records_delete
  after delete on public.exercise_sets
  referencing old table as old_rows
  for each statement execute function public.exercise_sets_refresh_records();

-- Récords de las sesiones que ya existían antes de esta migración.
select public.recompute_personal_records(x.user_id, x.exercise_id)
from (select distinct user_id, exercise_id from public.exercise_sets) x;
