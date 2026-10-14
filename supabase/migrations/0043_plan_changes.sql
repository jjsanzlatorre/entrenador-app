-- 0043_plan_changes.sql
-- Mover sesiones y el plan entero (usabilidad 2/3):
-- 1. plan_changes: cada cambio de fechas del plan (mover, intercambiar, desplazar, pausar,
--    repetir semana) con lo necesario para deshacerlo: estado anterior de las sesiones tocadas,
--    sesiones insertadas y fecha de inicio anterior del plan. Solo lectura para el dueño; se
--    escribe por RPC.
-- 2. apply_plan_change: aplica en una transacción la lista de cambios que calcula la app (la
--    misma que enseña en la vista previa): nuevas fechas de sesiones pendientes del plan activo
--    y copias de sesiones del plan (repetir semana). Comprueba que todo es del usuario.
-- 3. undo_plan_change: deshace el último cambio (solo el último sin deshacer del plan) sin tocar
--    lo que ya se ha hecho desde entonces.
-- Requiere 0017 y 0023. Idempotente.

create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_plan_id uuid not null references public.user_plans (id) on delete cascade,
  kind text not null check (kind in ('move', 'swap', 'shift', 'pause', 'repeat')),
  -- Pausa: { from, until }; desplazar: { from, days }; repetir: { week_start }.
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  -- [{ id, date, original_date, status }] de las sesiones movidas, antes del cambio.
  before jsonb not null default '[]'::jsonb check (jsonb_typeof(before) = 'array'),
  inserted uuid[] not null default '{}',
  previous_start date,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz
);

create index if not exists plan_changes_plan_idx
  on public.plan_changes (user_plan_id, created_at desc);
create index if not exists plan_changes_user_idx on public.plan_changes (user_id);

alter table public.plan_changes enable row level security;
revoke all on public.plan_changes from anon;
revoke insert, update, delete on public.plan_changes from authenticated;
grant select on public.plan_changes to authenticated;

drop policy if exists "plan_changes_select_own" on public.plan_changes;
create policy "plan_changes_select_own" on public.plan_changes
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- apply_plan_change
-- p_moves:  [{ id, date }]  sesiones pendientes (planned | moved) del plan y su nueva fecha.
-- p_copies: [{ source_id, date }]  copias (pendientes) de sesiones del plan en otra fecha.
-- p_new_start: nueva fecha de inicio del plan (al desplazar o pausar un plan que aún no ha
--   empezado).
-- Mover e intercambiar marcan la sesión como «movida» y guardan el día original (como mover a
-- mano en la fase 5); desplazar, pausar y repetir solo cambian la fecha.
-- Devuelve { change_id, moved, inserted }.
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_plan_change(
  p_plan uuid,
  p_kind text,
  p_moves jsonb,
  p_copies jsonb default '[]'::jsonb,
  p_new_start date default null,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  plan public.user_plans%rowtype;
  n_moves integer;
  ids uuid[];
  dates date[];
  n_found integer;
  before_rows jsonb;
  new_ids uuid[] := '{}';
  c jsonb;
  src public.planned_sessions%rowtype;
  new_id uuid;
  change_id uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_kind is null or p_kind not in ('move', 'swap', 'shift', 'pause', 'repeat') then
    raise exception 'tipo de cambio no válido';
  end if;
  if jsonb_typeof(coalesce(p_moves, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_copies, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_params, '{}'::jsonb)) <> 'object' then
    raise exception 'cambio no válido';
  end if;
  p_moves := coalesce(p_moves, '[]'::jsonb);
  p_copies := coalesce(p_copies, '[]'::jsonb);
  if jsonb_array_length(p_moves) > 300 or jsonb_array_length(p_copies) > 50 then
    raise exception 'demasiados cambios';
  end if;
  if jsonb_array_length(p_moves) = 0 and jsonb_array_length(p_copies) = 0 then
    raise exception 'no hay nada que cambiar';
  end if;

  select * into plan from public.user_plans up
  where up.id = p_plan and up.user_id = uid and up.status = 'active'
  for update;
  if not found then
    raise exception 'plan no encontrado';
  end if;

  -- Movimientos: ids distintos, fechas válidas y sesiones pendientes de este plan.
  begin
    select coalesce(array_agg((m ->> 'id')::uuid order by o), '{}'),
           coalesce(array_agg((m ->> 'date')::date order by o), '{}')
    into ids, dates
    from jsonb_array_elements(p_moves) with ordinality as x(m, o);
  exception when others then
    raise exception 'cambio no válido';
  end;
  n_moves := cardinality(ids);
  if (select count(distinct i) from unnest(ids) i) <> n_moves then
    raise exception 'sesión repetida';
  end if;
  if exists (
    select 1 from unnest(dates) d
    where d is null or d < current_date - 730 or d > current_date + 730
  ) then
    raise exception 'fecha no válida';
  end if;

  select count(*) into n_found
  from public.planned_sessions p
  where p.id = any(ids) and p.user_plan_id = plan.id and p.user_id = uid
    and p.status in ('planned', 'moved');
  if n_found <> n_moves then
    raise exception 'sesión no válida (solo se mueven sesiones pendientes del plan)';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'date', p.date, 'original_date', p.original_date, 'status', p.status
  )), '[]'::jsonb)
  into before_rows
  from public.planned_sessions p
  where p.id = any(ids);

  if p_kind in ('move', 'swap') then
    update public.planned_sessions p
    set date = m.new_date,
        original_date = case
          when coalesce(p.original_date, p.date) = m.new_date then null
          else coalesce(p.original_date, p.date)
        end,
        status = case
          when coalesce(p.original_date, p.date) = m.new_date then 'planned'
          else 'moved'
        end
    from unnest(ids, dates) as m(id, new_date)
    where p.id = m.id;
  else
    update public.planned_sessions p
    set date = m.new_date
    from unnest(ids, dates) as m(id, new_date)
    where p.id = m.id;
  end if;

  -- Copias (repetir semana): misma prescripción, pendientes.
  for c in select * from jsonb_array_elements(p_copies) loop
    select * into src from public.planned_sessions p
    where p.id = (c ->> 'source_id')::uuid and p.user_plan_id = plan.id and p.user_id = uid;
    if not found or (c ->> 'date') is null then
      raise exception 'sesión no válida';
    end if;
    insert into public.planned_sessions (
      user_plan_id, user_id, date, week, session_type, title, intensity, heavy_legs,
      duration_min, notes, blocks, status
    )
    values (
      plan.id, uid, (c ->> 'date')::date, src.week, src.session_type, src.title, src.intensity,
      src.heavy_legs, src.duration_min, src.notes, src.blocks, 'planned'
    )
    returning id into new_id;
    new_ids := new_ids || new_id;
  end loop;

  if p_new_start is not null and p_new_start <> plan.start_date then
    update public.user_plans up set start_date = p_new_start where up.id = plan.id;
  end if;

  insert into public.plan_changes (user_id, user_plan_id, kind, params, before, inserted,
    previous_start)
  values (
    uid, plan.id, p_kind, coalesce(p_params, '{}'::jsonb), before_rows, new_ids,
    case when p_new_start is not null and p_new_start <> plan.start_date
      then plan.start_date end
  )
  returning id into change_id;

  return jsonb_build_object(
    'change_id', change_id,
    'moved', n_moves,
    'inserted', cardinality(new_ids)
  );
end;
$$;

revoke all on function public.apply_plan_change(uuid, text, jsonb, jsonb, date, jsonb)
  from public, anon;
grant execute on function public.apply_plan_change(uuid, text, jsonb, jsonb, date, jsonb)
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- undo_plan_change: solo el último cambio sin deshacer del plan activo. Las sesiones que ya no
-- están pendientes (hechas o saltadas después) no se tocan; las copias que siguen pendientes y
-- sin sesión registrada se borran. Devuelve { restored, removed }.
-- ─────────────────────────────────────────────────────────────
create or replace function public.undo_plan_change(p_change uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ch public.plan_changes%rowtype;
  n_restored integer := 0;
  n_removed integer := 0;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select * into ch from public.plan_changes pc
  where pc.id = p_change and pc.user_id = uid
  for update;
  if not found then
    raise exception 'cambio no encontrado';
  end if;
  if ch.undone_at is not null then
    raise exception 'el cambio ya está deshecho';
  end if;
  if not exists (
    select 1 from public.user_plans up
    where up.id = ch.user_plan_id and up.user_id = uid and up.status = 'active'
  ) then
    raise exception 'el plan ya no está activo';
  end if;
  if exists (
    select 1 from public.plan_changes pc
    where pc.user_plan_id = ch.user_plan_id and pc.undone_at is null
      and pc.created_at > ch.created_at
  ) then
    raise exception 'deshaz antes el último cambio';
  end if;

  update public.planned_sessions p
  set date = b.date, original_date = b.original_date, status = b.status
  from jsonb_to_recordset(ch.before) as b(id uuid, date date, original_date date, status text)
  where p.id = b.id and p.user_id = uid and p.user_plan_id = ch.user_plan_id
    and p.status in ('planned', 'moved')
    and b.status in ('planned', 'moved');
  get diagnostics n_restored = row_count;

  delete from public.planned_sessions p
  where p.id = any(ch.inserted) and p.user_id = uid
    and p.status in ('planned', 'moved') and p.workout_session_id is null;
  get diagnostics n_removed = row_count;

  if ch.previous_start is not null then
    update public.user_plans up set start_date = ch.previous_start
    where up.id = ch.user_plan_id and up.user_id = uid;
  end if;

  update public.plan_changes pc set undone_at = now() where pc.id = ch.id;

  return jsonb_build_object('restored', n_restored, 'removed', n_removed);
end;
$$;

revoke all on function public.undo_plan_change(uuid) from public, anon;
grant execute on function public.undo_plan_change(uuid) to authenticated;
