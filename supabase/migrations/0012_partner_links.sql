-- 0012_partner_links.sql
-- Vínculos entre usuarios (pareja o amigos). Una fila por dirección:
--   (user_id = quien comparte, partner_id = quien ve) con los permisos que user_id concede.
-- Invitar crea (yo → otro, pending). Al aceptar, esa fila pasa a accepted y se crea
-- (otro → yo, accepted). Revocar pone las dos en revoked.
-- Cada usuario solo cambia los permisos de su propia fila (lo que él comparte).
-- Las fotos no se comparten nunca.
-- Idempotente.

create table if not exists public.partner_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  can_view_adherence boolean not null default true,
  can_view_sessions boolean not null default false,
  can_view_metrics boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, partner_id),
  check (user_id <> partner_id)
);

create index if not exists partner_links_partner_idx on public.partner_links (partner_id);

drop trigger if exists partner_links_set_updated_at on public.partner_links;
create trigger partner_links_set_updated_at
  before update on public.partner_links
  for each row execute function public.set_updated_at();

alter table public.partner_links enable row level security;
revoke all on public.partner_links from anon;
revoke insert, update, delete on public.partner_links from authenticated;
grant select on public.partner_links to authenticated;
-- Solo los permisos; el estado cambia con las funciones de abajo.
grant update (can_view_adherence, can_view_sessions, can_view_metrics)
  on public.partner_links to authenticated;

drop policy if exists "partner_links_select" on public.partner_links;
create policy "partner_links_select" on public.partner_links
  for select to authenticated
  using (
    (user_id = (select auth.uid()) or partner_id = (select auth.uid()))
    and (select public.is_active())
  );

drop policy if exists "partner_links_update_own" on public.partner_links;
create policy "partner_links_update_own" on public.partner_links
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- shares_with_me(owner, perm): ¿owner me comparte perm ('adherence' | 'sessions' | 'metrics')?
-- ─────────────────────────────────────────────────────────────
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
        when 'metrics' then l.can_view_metrics
        else false
      end
  );
$$;

revoke all on function public.shares_with_me(uuid, text) from public, anon;
grant execute on function public.shares_with_me(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Políticas de lectura adicionales según los permisos del vínculo.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "commitments_select_partner" on public.commitments;
create policy "commitments_select_partner" on public.commitments
  for select to authenticated
  using (public.shares_with_me(user_id, 'adherence'));

drop policy if exists "workout_sessions_select_partner" on public.workout_sessions;
create policy "workout_sessions_select_partner" on public.workout_sessions
  for select to authenticated
  using (public.shares_with_me(user_id, 'sessions'));

drop policy if exists "session_blocks_select_partner" on public.session_blocks;
create policy "session_blocks_select_partner" on public.session_blocks
  for select to authenticated
  using (public.shares_with_me(user_id, 'sessions'));

drop policy if exists "exercise_sets_select_partner" on public.exercise_sets;
create policy "exercise_sets_select_partner" on public.exercise_sets
  for select to authenticated
  using (public.shares_with_me(user_id, 'sessions'));

drop policy if exists "body_metrics_select_partner" on public.body_metrics;
create policy "body_metrics_select_partner" on public.body_metrics
  for select to authenticated
  using (public.shares_with_me(user_id, 'metrics'));

-- ─────────────────────────────────────────────────────────────
-- invite_partner(email): invita a un usuario ya registrado y activo.
-- Si esa persona ya me había invitado, el vínculo queda aceptado directamente.
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
    user_id, partner_id, status, can_view_adherence, can_view_sessions, can_view_metrics
  ) values (uid, target, 'pending', true, false, false)
  on conflict (user_id, partner_id) do update set
    status = 'pending',
    can_view_adherence = true,
    can_view_sessions = false,
    can_view_metrics = false
  where public.partner_links.status = 'revoked';

  return target;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- respond_partner_link(partner, accept): acepta o rechaza una invitación recibida.
-- ─────────────────────────────────────────────────────────────
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
      user_id, partner_id, status, can_view_adherence, can_view_sessions, can_view_metrics
    ) values (uid, p_partner, 'accepted', true, false, false)
    on conflict (user_id, partner_id) do update set
      status = 'accepted',
      can_view_adherence = true,
      can_view_sessions = false,
      can_view_metrics = false;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- revoke_partner_link(partner): deshace el vínculo en las dos direcciones
-- (también sirve para cancelar una invitación enviada o rechazar una recibida).
-- ─────────────────────────────────────────────────────────────
create or replace function public.revoke_partner_link(p_partner uuid)
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
  set status = 'revoked'
  where (l.user_id = uid and l.partner_id = p_partner)
     or (l.user_id = p_partner and l.partner_id = uid);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- list_partner_links(): mis vínculos con el nombre de la otra persona y los permisos
-- en las dos direcciones. status: sent | received | accepted.
-- ─────────────────────────────────────────────────────────────
create or replace function public.list_partner_links()
returns table (
  partner_id uuid,
  display_name text,
  status text,
  i_share_adherence boolean,
  i_share_sessions boolean,
  i_share_metrics boolean,
  they_share_adherence boolean,
  they_share_sessions boolean,
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
      m.can_view_adherence as ma, m.can_view_sessions as ms, m.can_view_metrics as mm,
      t.can_view_adherence as ta, t.can_view_sessions as ts, t.can_view_metrics as tm,
      least(m.created_at, t.created_at) as created_at
    from mine m
    full join theirs t on t.user_id = m.partner_id
  )
  select
    pr.other, p.display_name, pr.status,
    coalesce(pr.ma, false), coalesce(pr.ms, false), coalesce(pr.mm, false),
    coalesce(pr.ta and pr.status = 'accepted', false),
    coalesce(pr.ts and pr.status = 'accepted', false),
    coalesce(pr.tm and pr.status = 'accepted', false),
    pr.created_at
  from pairs pr
  left join public.profiles p on p.id = pr.other
  where pr.status <> 'revoked'
  order by pr.created_at;
$$;

-- ─────────────────────────────────────────────────────────────
-- partner_adherence_days(partner, from, tz): días y tipos de sesión (≥ 15 min, terminadas)
-- de una persona que me comparte su cumplimiento. Solo eso: ni pesos, ni notas, ni métricas.
-- ─────────────────────────────────────────────────────────────
create or replace function public.partner_adherence_days(
  p_partner uuid,
  p_from date,
  p_tz text default 'Europe/Madrid'
)
returns table (day date, session_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (ws.started_at at time zone p_tz)::date, ws.session_type
  from public.workout_sessions ws
  where ws.user_id = p_partner
    and public.shares_with_me(p_partner, 'adherence')
    and ws.ended_at is not null
    and coalesce(ws.duration_min, extract(epoch from ws.ended_at - ws.started_at) / 60) >= 15
    and (ws.started_at at time zone p_tz)::date >= p_from
  order by 1, 2;
$$;

revoke all on function public.invite_partner(text) from public, anon;
revoke all on function public.respond_partner_link(uuid, boolean) from public, anon;
revoke all on function public.revoke_partner_link(uuid) from public, anon;
revoke all on function public.list_partner_links() from public, anon;
revoke all on function public.partner_adherence_days(uuid, date, text) from public, anon;
grant execute on function public.invite_partner(text) to authenticated;
grant execute on function public.respond_partner_link(uuid, boolean) to authenticated;
grant execute on function public.revoke_partner_link(uuid) to authenticated;
grant execute on function public.list_partner_links() to authenticated;
grant execute on function public.partner_adherence_days(uuid, date, text) to authenticated;
