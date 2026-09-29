-- 0027_partner_sharing.sql
-- Fase 7A: compartir con cada persona vinculada, entreno en pareja y reacciones.
--
-- 1. Permisos por persona (una fila de partner_links por dirección; user_id = quien comparte):
--      can_view_adherence     cumplimiento (por defecto sí al aceptar)
--      can_view_sessions      entrenos: historial, detalle, pesos, récords y gráficas por ejercicio
--      can_view_muscles       mapa muscular y carga (sin pesos: solo nº de series y RPE × min)
--      can_view_achievements  logros: acumulados y equivalencias (y su ciudad de referencia)
--      can_view_metrics       peso y perímetros
--    Las fotos de progreso son SIEMPRE privadas: no hay permiso ni política para compartirlas.
-- 2. Políticas de lectura y RPC (security definer) que aplican exactamente esos permisos.
-- 3. pair_invites: invitación a entrenar juntos (misma estructura, pair_group_id común).
-- 4. reactions: 👏 🔥 💪 sobre la semana de cumplimiento o una sesión compartida.
-- Requiere 0012 y 0013. Idempotente.

-- ─────────────────────────────────────────────────────────────
-- 1. Permisos
-- ─────────────────────────────────────────────────────────────
alter table public.partner_links
  add column if not exists can_view_muscles boolean not null default false,
  add column if not exists can_view_achievements boolean not null default false;

-- Decisión de producto: las fotos no se comparten nunca. Si existiera el permiso, se elimina.
alter table public.partner_links drop column if exists can_view_photos;

grant update (
  can_view_adherence, can_view_sessions, can_view_muscles, can_view_achievements, can_view_metrics
) on public.partner_links to authenticated;

-- shares_with_me(owner, perm): ¿owner me comparte perm?
-- perm: 'adherence' | 'sessions' | 'muscles' | 'achievements' | 'metrics'. Cualquier otro
-- valor (p. ej. 'photos') es siempre false.
create or replace function public.shares_with_me(p_owner uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_links l
    join public.profiles p on p.id = l.partner_id and p.active
    where l.user_id = p_owner
      and l.partner_id = (select auth.uid())
      and l.status = 'accepted'
      and case p_perm
        when 'adherence' then l.can_view_adherence
        when 'sessions' then l.can_view_sessions
        when 'muscles' then l.can_view_muscles
        when 'achievements' then l.can_view_achievements
        when 'metrics' then l.can_view_metrics
        else false
      end
  );
$$;

revoke all on function public.shares_with_me(uuid, text) from public, anon;
grant execute on function public.shares_with_me(uuid, text) to authenticated;

-- ¿Vínculo aceptado en las dos direcciones? (para entrenar juntos)
create or replace function public.are_linked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_links l
    where l.user_id = p_a and l.partner_id = p_b and l.status = 'accepted'
  ) and exists (
    select 1 from public.partner_links l
    where l.user_id = p_b and l.partner_id = p_a and l.status = 'accepted'
  );
$$;

revoke all on function public.are_linked(uuid, uuid) from public, anon;
grant execute on function public.are_linked(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Políticas de lectura según los permisos
-- ─────────────────────────────────────────────────────────────
-- Cumplimiento (0012): commitments con 'adherence'; los días llegan por partner_adherence_days.
-- Entrenos (0012): workout_sessions, session_blocks y exercise_sets con 'sessions'. Aquí se
-- añaden los récords y los ejercicios propios que aparecen en sus sesiones.
drop policy if exists "personal_records_select_partner" on public.personal_records;
create policy "personal_records_select_partner" on public.personal_records
  for select to authenticated
  using (public.shares_with_me(user_id, 'sessions'));

-- Ejercicios propios de la otra persona (para ver sus nombres y músculos en su historial o en
-- su mapa). Solo nombre y catálogo: nada de sus series. exercise_muscles hereda esta visibilidad.
drop policy if exists "exercises_select_partner" on public.exercises;
create policy "exercises_select_partner" on public.exercises
  for select to authenticated
  using (
    owner_id is not null
    and (public.shares_with_me(owner_id, 'sessions') or public.shares_with_me(owner_id, 'muscles'))
  );

-- Logros: historial de hitos.
drop policy if exists "milestones_shown_select_partner" on public.milestones_shown;
create policy "milestones_shown_select_partner" on public.milestones_shown
  for select to authenticated
  using (public.shares_with_me(user_id, 'achievements'));

-- Medidas (0012): body_metrics con 'metrics'.

-- Fotos: nunca. Se quitan por si alguien hubiera creado a mano políticas de pareja.
drop policy if exists "progress_photos_select_partner" on public.progress_photos;
drop policy if exists "progress_photos_storage_select_partner" on storage.objects;

-- ─────────────────────────────────────────────────────────────
-- RPC de lectura de la otra persona (sin pasar por sus tablas: solo lo que el permiso cubre)
-- ─────────────────────────────────────────────────────────────

-- Sesiones terminadas para el mapa/carga ('muscles') y los logros ('achievements').
-- Cada columna solo sale con su permiso: RPE con 'muscles'; distancia, tonelaje y reps con
-- 'achievements'. Ni títulos, ni notas, ni pesos por serie.
create or replace function public.partner_session_log(p_partner uuid)
returns table (
  id uuid,
  session_type text,
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
  with perms as (
    select
      public.shares_with_me(p_partner, 'muscles') as muscles,
      public.shares_with_me(p_partner, 'achievements') as achievements
  )
  select
    ws.id,
    ws.session_type,
    ws.started_at,
    ws.ended_at,
    ws.duration_min,
    case when perms.muscles then ws.rpe end,
    case when perms.achievements then ws.distance_m end,
    case when perms.achievements then coalesce(t.tonnage_kg, 0) end,
    case when perms.achievements then coalesce(t.total_reps, 0) end
  from public.workout_sessions ws
  cross join perms
  left join lateral (
    select
      sum(es.weight_kg * es.reps) filter (
        where e.tracking_type = 'weight_reps' and es.weight_kg > 0 and es.reps > 0
      )::numeric as tonnage_kg,
      sum(es.reps) filter (where es.reps > 0)::integer as total_reps
    from public.exercise_sets es
    left join public.exercises e on e.id = es.exercise_id
    where es.session_id = ws.id and es.completed and not es.is_warmup
  ) t on perms.achievements
  where ws.user_id = p_partner
    and ws.ended_at is not null
    and (perms.muscles or perms.achievements)
  order by ws.started_at;
$$;

-- Series efectivas por sesión y ejercicio ('muscles'): el mismo cálculo que
-- session_exercise_sets (0016), sin pesos ni reps.
create or replace function public.partner_exercise_sets(
  p_partner uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (session_id uuid, exercise_id text, sets integer)
language sql
stable
security definer
set search_path = ''
as $$
  select ws.id as session_id, es.exercise_id, count(*)::integer as sets
  from public.workout_sessions ws
  join public.exercise_sets es
    on es.session_id = ws.id and es.completed and not es.is_warmup
  where ws.user_id = p_partner
    and public.shares_with_me(p_partner, 'muscles')
    and ws.ended_at is not null
    and ws.started_at >= p_from
    and ws.started_at < p_to
  group by ws.id, es.exercise_id;
$$;

-- Ciudad de referencia ('achievements'), para sus equivalencias de distancia.
create or replace function public.partner_home(p_partner uuid)
returns table (home_city text, home_lat double precision, home_lng double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select p.home_city, p.home_lat, p.home_lng
  from public.profiles p
  where p.id = p_partner and public.shares_with_me(p_partner, 'achievements');
$$;

revoke all on function public.partner_session_log(uuid) from public, anon;
revoke all on function public.partner_exercise_sets(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.partner_home(uuid) from public, anon;
grant execute on function public.partner_session_log(uuid) to authenticated;
grant execute on function public.partner_exercise_sets(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.partner_home(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Vínculos: invitar y aceptar dejan todo lo nuevo desactivado (solo el cumplimiento, activado).
-- ─────────────────────────────────────────────────────────────
create or replace function public.invite_partner(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  select u.id into target
  from auth.users u
  join public.profiles p on p.id = u.id and p.active
  where lower(u.email) = lower(trim(p_email));

  if target is null then
    raise exception 'No hay ningún usuario activo con ese email' using errcode = 'P0002';
  end if;
  if target = uid then
    raise exception 'No puedes vincularte contigo' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.partner_links l
    where l.user_id = target and l.partner_id = uid and l.status = 'pending'
  ) then
    perform public.respond_partner_link(target, true);
    return target;
  end if;

  insert into public.partner_links (
    user_id, partner_id, status, can_view_adherence, can_view_sessions, can_view_muscles,
    can_view_achievements, can_view_metrics
  ) values (uid, target, 'pending', true, false, false, false, false)
  on conflict (user_id, partner_id) do update set
    status = 'pending',
    can_view_adherence = true,
    can_view_sessions = false,
    can_view_muscles = false,
    can_view_achievements = false,
    can_view_metrics = false
  where public.partner_links.status = 'revoked';

  return target;
end;
$$;

create or replace function public.respond_partner_link(p_partner uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;

  update public.partner_links l
  set status = case when p_accept then 'accepted' else 'revoked' end
  where l.user_id = p_partner and l.partner_id = uid and l.status = 'pending';
  if not found then
    raise exception 'No hay ninguna invitación pendiente de esa persona' using errcode = 'P0002';
  end if;

  if p_accept then
    -- Visibilidad recíproca por defecto: se comparte el cumplimiento y nada más.
    insert into public.partner_links (
      user_id, partner_id, status, can_view_adherence, can_view_sessions, can_view_muscles,
      can_view_achievements, can_view_metrics
    ) values (uid, p_partner, 'accepted', true, false, false, false, false)
    on conflict (user_id, partner_id) do update set
      status = 'accepted',
      can_view_adherence = true,
      can_view_sessions = false,
      can_view_muscles = false,
      can_view_achievements = false,
      can_view_metrics = false;
  end if;
end;
$$;

-- list_partners(): sustituye a list_partner_links() (0012) con los permisos nuevos. Tiene otro
-- nombre para que 0012 se pueda volver a ejecutar (no se puede cambiar el tipo que devuelve una
-- función existente); la antigua se borra.
drop function if exists public.list_partner_links();
create or replace function public.list_partners()
returns table (
  partner_id uuid,
  display_name text,
  status text,
  i_share_adherence boolean,
  i_share_sessions boolean,
  i_share_muscles boolean,
  i_share_achievements boolean,
  i_share_metrics boolean,
  they_share_adherence boolean,
  they_share_sessions boolean,
  they_share_muscles boolean,
  they_share_achievements boolean,
  they_share_metrics boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id where public.is_active()),
  mine as (
    select l.* from public.partner_links l join me on l.user_id = me.id
  ),
  theirs as (
    select l.* from public.partner_links l join me on l.partner_id = me.id
  ),
  pairs as (
    select
      coalesce(m.partner_id, t.user_id) as other,
      case
        when m.status = 'accepted' and t.status = 'accepted' then 'accepted'
        when m.status = 'pending' then 'sent'
        when t.status = 'pending' then 'received'
        else 'revoked'
      end as status,
      m.can_view_adherence as ma, m.can_view_sessions as ms, m.can_view_muscles as mu,
      m.can_view_achievements as mc, m.can_view_metrics as mm,
      t.can_view_adherence as ta, t.can_view_sessions as ts, t.can_view_muscles as tu,
      t.can_view_achievements as tc, t.can_view_metrics as tm,
      least(m.created_at, t.created_at) as created_at
    from mine m
    full join theirs t on t.user_id = m.partner_id
  )
  select
    pr.other, p.display_name, pr.status,
    coalesce(pr.ma, false), coalesce(pr.ms, false), coalesce(pr.mu, false),
    coalesce(pr.mc, false), coalesce(pr.mm, false),
    coalesce(pr.ta and pr.status = 'accepted', false),
    coalesce(pr.ts and pr.status = 'accepted', false),
    coalesce(pr.tu and pr.status = 'accepted', false),
    coalesce(pr.tc and pr.status = 'accepted', false),
    coalesce(pr.tm and pr.status = 'accepted', false),
    pr.created_at
  from pairs pr
  left join public.profiles p on p.id = pr.other
  where pr.status <> 'revoked'
  order by pr.created_at;
$$;

revoke all on function public.list_partners() from public, anon;
grant execute on function public.list_partners() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Entreno en pareja
-- Quien invita empieza su sesión con un pair_group_id nuevo y manda la estructura (bloques,
-- ejercicios globales, series y reps objetivo; sin pesos). La otra persona, al unirse, crea su
-- propia sesión en su móvil con esa estructura y el mismo pair_group_id, y registra sus pesos.
-- Solo entre personas con el vínculo aceptado en las dos direcciones.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pair_invites (
  id uuid primary key default gen_random_uuid(),
  pair_group_id uuid not null,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pair_group_id, to_user),
  check (from_user <> to_user),
  check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536)
);

create index if not exists pair_invites_to_idx on public.pair_invites (to_user, status);
create index if not exists pair_invites_group_idx on public.pair_invites (pair_group_id);

drop trigger if exists pair_invites_set_updated_at on public.pair_invites;
create trigger pair_invites_set_updated_at
  before update on public.pair_invites
  for each row execute function public.set_updated_at();

alter table public.pair_invites enable row level security;
revoke all on public.pair_invites from anon;
revoke insert, update, delete on public.pair_invites from authenticated;
grant select on public.pair_invites to authenticated;

drop policy if exists "pair_invites_select" on public.pair_invites;
create policy "pair_invites_select" on public.pair_invites
  for select to authenticated
  using (
    (from_user = (select auth.uid()) or to_user = (select auth.uid()))
    and (select public.is_active())
  );

create or replace function public.create_pair_invite(
  p_partner uuid,
  p_pair_group_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  invite uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_pair_group_id is null or p_payload is null or jsonb_typeof(p_payload -> 'blocks') <> 'array'
  then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  if not public.are_linked(uid, p_partner) then
    raise exception 'No estáis vinculados' using errcode = '42501';
  end if;
  -- Un pair_group_id pertenece a quien lo creó.
  if exists (
    select 1 from public.pair_invites i
    where i.pair_group_id = p_pair_group_id and i.from_user <> uid
  ) then
    raise exception 'pair group in use' using errcode = '23505';
  end if;

  insert into public.pair_invites (pair_group_id, from_user, to_user, payload)
  values (p_pair_group_id, uid, p_partner, p_payload)
  on conflict (pair_group_id, to_user) do update set
    payload = excluded.payload,
    status = 'pending'
  where public.pair_invites.from_user = uid
  returning id into invite;

  return invite;
end;
$$;

-- Actualiza la estructura mientras la otra persona no se haya unido (p. ej. tras añadir ejercicios).
create or replace function public.update_pair_invite(p_invite uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'blocks') <> 'array' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  update public.pair_invites i
  set payload = p_payload
  where i.id = p_invite and i.from_user = uid and i.status = 'pending';
  if not found then
    raise exception 'La invitación ya no está pendiente' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.respond_pair_invite(p_invite uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sender uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  select i.from_user into sender
  from public.pair_invites i
  where i.id = p_invite and i.to_user = uid and i.status = 'pending';
  if sender is null then
    raise exception 'La invitación ya no está pendiente' using errcode = 'P0002';
  end if;
  if p_accept and not public.are_linked(uid, sender) then
    raise exception 'No estáis vinculados' using errcode = '42501';
  end if;
  update public.pair_invites i
  set status = case when p_accept then 'accepted' else 'declined' end
  where i.id = p_invite;
end;
$$;

create or replace function public.cancel_pair_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  update public.pair_invites i
  set status = 'cancelled'
  where i.id = p_invite and i.from_user = uid and i.status = 'pending';
end;
$$;

revoke all on function public.create_pair_invite(uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_pair_invite(uuid, jsonb) from public, anon;
revoke all on function public.respond_pair_invite(uuid, boolean) from public, anon;
revoke all on function public.cancel_pair_invite(uuid) from public, anon;
grant execute on function public.create_pair_invite(uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_pair_invite(uuid, jsonb) to authenticated;
grant execute on function public.respond_pair_invite(uuid, boolean) to authenticated;
grant execute on function public.cancel_pair_invite(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Reacciones 👏 🔥 💪
-- target_kind 'week': target_key = lunes de la semana (YYYY-MM-DD); requiere que el otro me
-- comparta su cumplimiento. 'session': target_key = id de una sesión suya terminada; requiere
-- que me comparta sus entrenos. Una por emoji, persona y objetivo (tocar otra vez la quita).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  target_kind text not null check (target_kind in ('week', 'session')),
  target_key text not null check (length(target_key) between 1 and 64),
  emoji text not null check (emoji in ('clap', 'fire', 'muscle')),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (from_user, to_user, target_kind, target_key, emoji),
  check (from_user <> to_user)
);

create index if not exists reactions_to_idx on public.reactions (to_user, seen_at);

alter table public.reactions enable row level security;
revoke all on public.reactions from anon;
revoke insert, update, delete on public.reactions from authenticated;
grant select on public.reactions to authenticated;

drop policy if exists "reactions_select" on public.reactions;
create policy "reactions_select" on public.reactions
  for select to authenticated
  using (
    (from_user = (select auth.uid()) or to_user = (select auth.uid()))
    and (select public.is_active())
  );

-- Devuelve true si la reacción queda puesta y false si se ha quitado.
create or replace function public.toggle_reaction(
  p_to uuid,
  p_kind text,
  p_key text,
  p_emoji text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_emoji not in ('clap', 'fire', 'muscle') then
    raise exception 'invalid emoji' using errcode = '22023';
  end if;

  if p_kind = 'week' then
    if p_key !~ '^\d{4}-\d{2}-\d{2}$' or extract(isodow from p_key::date) <> 1 then
      raise exception 'invalid week' using errcode = '22023';
    end if;
    if not public.shares_with_me(p_to, 'adherence') then
      raise exception 'No te comparte su cumplimiento' using errcode = '42501';
    end if;
  elsif p_kind = 'session' then
    if p_key !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'invalid session' using errcode = '22023';
    end if;
    if not public.shares_with_me(p_to, 'sessions') or not exists (
      select 1 from public.workout_sessions ws
      where ws.id = p_key::uuid and ws.user_id = p_to and ws.ended_at is not null
    ) then
      raise exception 'No te comparte esa sesión' using errcode = '42501';
    end if;
  else
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  delete from public.reactions r
  where r.from_user = uid and r.to_user = p_to and r.target_kind = p_kind
    and r.target_key = p_key and r.emoji = p_emoji;
  if found then
    return false;
  end if;

  insert into public.reactions (from_user, to_user, target_kind, target_key, emoji)
  values (uid, p_to, p_kind, p_key, p_emoji);
  return true;
end;
$$;

-- Marca como vistas las reacciones recibidas (el aviso de «Hoy» desaparece).
create or replace function public.mark_reactions_seen()
returns integer
language sql
security definer
set search_path = ''
as $$
  with seen as (
    update public.reactions r
    set seen_at = now()
    where r.to_user = auth.uid() and r.seen_at is null and public.is_active()
    returning 1
  )
  select count(*)::integer from seen;
$$;

revoke all on function public.toggle_reaction(uuid, text, text, text) from public, anon;
revoke all on function public.mark_reactions_seen() from public, anon;
grant execute on function public.toggle_reaction(uuid, text, text, text) to authenticated;
grant execute on function public.mark_reactions_seen() to authenticated;
