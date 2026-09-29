-- 0030_invite_links.sql
-- Invitaciones por enlace (/unirse/{código}) y contraseñas temporales.
-- 1) app_settings: ajustes globales del admin (¿los usuarios pueden invitar?, máximo de
--    invitaciones activas por usuario).
-- 2) invite_codes: códigos legibles (XXXX-XXXX-XXXX, 60 bits aleatorios) con caducidad, usos y
--    anulación. Cada usuario ve y anula los suyos; el admin, todos. Se crean y anulan por RPC.
-- 3) invite_attempts: intentos por IP (hash) en /unirse, para limitar la adivinación de códigos.
--    Solo service role.
-- 4) lookup_invite_code / redeem_invite_code: solo service role (servidor). Canjear marca el
--    código como usado y crea el vínculo ACEPTADO en los dos sentidos (solo cumplimiento) en una
--    transacción. El usuario lo crea antes el servidor con auth.admin.createUser; si el canje
--    falla, el servidor lo borra (el perfil y todo lo demás se borran en cascada).
-- 5) profiles.must_change_password: contraseña temporal generada por el admin; la app obliga a
--    cambiarla al entrar. Solo se cambia desde el servidor (service role).
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- profiles.must_change_password
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- Segunda barrera (además de los GRANT por columna de 0015): role, active y
-- must_change_password solo cambian con service role o desde el SQL Editor.
create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.role is distinct from old.role
          or new.active is distinct from old.active
          or new.must_change_password is distinct from old.must_change_password
          or new.id is distinct from old.id) then
    raise exception 'No puedes cambiar role, active ni id de un perfil'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- app_settings: una sola fila (id = true)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  members_can_invite boolean not null default false,
  max_active_invites_per_user integer not null default 3
    check (max_active_invites_per_user between 1 and 50),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
revoke insert, update, delete on public.app_settings from authenticated;
grant select on public.app_settings to authenticated;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select to authenticated
  using ((select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- invite_codes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 1 check (max_uses between 1 and 50),
  uses integer not null default 0 check (uses >= 0),
  revoked boolean not null default false,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create index if not exists invite_codes_created_by_idx
  on public.invite_codes (created_by, created_at desc);

alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon;
revoke insert, update, delete on public.invite_codes from authenticated;
grant select on public.invite_codes to authenticated;

drop policy if exists "invite_codes_select" on public.invite_codes;
create policy "invite_codes_select" on public.invite_codes
  for select to authenticated
  using (
    (select public.is_active())
    and (created_by = (select auth.uid()) or (select public.is_admin()))
  );

-- ─────────────────────────────────────────────────────────────
-- invite_attempts: sin políticas (solo service role, que salta la RLS)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invite_attempts (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default now()
);

create index if not exists invite_attempts_key_idx on public.invite_attempts (key, created_at);

alter table public.invite_attempts enable row level security;
revoke all on public.invite_attempts from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Helpers de códigos
-- ─────────────────────────────────────────────────────────────
-- Normaliza lo que escribe o pega el usuario: mayúsculas, sin espacios ni guiones, y vuelve a
-- poner los guiones. Si no tiene 12 caracteres, devuelve el texto limpio (no encontrará nada).
create or replace function public.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(c) = 12 then substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4)
    else c
  end
  from (select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) as c) s;
$$;

-- 12 símbolos de un alfabeto de 32 (sin 0/O, 1/I): 60 bits aleatorios de gen_random_uuid()
-- (se salta el byte 6, que lleva la versión; en el 8 solo se usan los 5 bits bajos, aleatorios).
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  b bytea := uuid_send(gen_random_uuid());
  idx integer[] := array[0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12];
  out text := '';
  i integer;
begin
  for i in 1 .. 12 loop
    out := out || substr(alphabet, (get_byte(b, idx[i]) % 32) + 1, 1);
    if i in (4, 8) then
      out := out || '-';
    end if;
  end loop;
  return out;
end;
$$;

-- Estado de un código: active | used | expired | revoked.
create or replace function public.invite_code_state(
  p_revoked boolean, p_expires_at timestamptz, p_uses integer, p_max_uses integer
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_revoked then 'revoked'
    when p_uses >= p_max_uses then 'used'
    when p_expires_at <= now() then 'expired'
    else 'active'
  end;
$$;

revoke all on function public.normalize_invite_code(text) from public, anon;
revoke all on function public.generate_invite_code() from public, anon, authenticated;
revoke all on function public.invite_code_state(boolean, timestamptz, integer, integer)
  from public, anon;
grant execute on function public.normalize_invite_code(text) to authenticated, service_role;
grant execute on function public.invite_code_state(boolean, timestamptz, integer, integer)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- my_invite_status(): ¿puedo invitar? y cuántas invitaciones activas tengo.
-- ─────────────────────────────────────────────────────────────
create or replace function public.my_invite_status()
returns table (can_invite boolean, is_admin boolean, max_active integer, active_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id where public.is_active()),
  s as (select * from public.app_settings where id),
  n as (
    select count(*)::integer as c
    from public.invite_codes ic join me on ic.created_by = me.id
    where public.invite_code_state(ic.revoked, ic.expires_at, ic.uses, ic.max_uses) = 'active'
  )
  select
    public.is_admin() or (coalesce(s.members_can_invite, false)
      and n.c < coalesce(s.max_active_invites_per_user, 3)),
    public.is_admin(),
    case when public.is_admin() then null else coalesce(s.max_active_invites_per_user, 3) end,
    n.c
  from me cross join n left join s on true;
$$;

-- ─────────────────────────────────────────────────────────────
-- create_invite_code: el admin siempre; el resto, si el admin lo permite y sin pasar del máximo
-- de invitaciones activas. Solo el admin elige caducidad (1–30 días) y usos (1–50); el resto,
-- 7 días y 1 uso.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_invite_code(
  p_expires_days integer default 7,
  p_max_uses integer default 1
)
returns public.invite_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_admin boolean;
  s public.app_settings;
  active_count integer;
  v_days integer := 7;
  v_uses integer := 1;
  new_code text;
  result public.invite_codes;
  attempt integer := 0;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_admin := public.is_admin();

  if not v_admin then
    select * into s from public.app_settings where id;
    if not coalesce(s.members_can_invite, false) then
      raise exception 'invite_not_allowed' using errcode = '42501';
    end if;
    -- Bloquea mis códigos para que dos peticiones a la vez no pasen del máximo.
    perform 1 from public.invite_codes ic where ic.created_by = uid for update;
    select count(*) into active_count from public.invite_codes ic
    where ic.created_by = uid
      and public.invite_code_state(ic.revoked, ic.expires_at, ic.uses, ic.max_uses) = 'active';
    if active_count >= coalesce(s.max_active_invites_per_user, 3) then
      raise exception 'invite_limit' using errcode = 'P0001';
    end if;
  else
    v_days := least(greatest(coalesce(p_expires_days, 7), 1), 30);
    v_uses := least(greatest(coalesce(p_max_uses, 1), 1), 50);
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_invite_code();
    begin
      insert into public.invite_codes (code, created_by, expires_at, max_uses)
      values (new_code, uid, now() + make_interval(days => v_days), v_uses)
      returning * into result;
      return result;
    exception when unique_violation then
      if attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

-- revoke_invite_code: anula un código propio (o cualquiera, el admin).
create or replace function public.revoke_invite_code(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.invite_codes ic set revoked = true
  where ic.id = p_id and (ic.created_by = uid or public.is_admin());
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- list_invite_codes(p_all): mis códigos con estado y nombre de quien lo usó; con p_all, el admin
-- ve los de todos (con el nombre de quien lo creó).
create or replace function public.list_invite_codes(p_all boolean default false)
returns table (
  id uuid,
  code text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  uses integer,
  revoked boolean,
  used_by uuid,
  used_by_name text,
  used_at timestamptz,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ic.id, ic.code, ic.created_by, pc.display_name, ic.created_at, ic.expires_at,
    ic.max_uses, ic.uses, ic.revoked, ic.used_by, pu.display_name, ic.used_at,
    public.invite_code_state(ic.revoked, ic.expires_at, ic.uses, ic.max_uses)
  from public.invite_codes ic
  left join public.profiles pc on pc.id = ic.created_by
  left join public.profiles pu on pu.id = ic.used_by
  where public.is_active()
    and (ic.created_by = auth.uid() or (p_all and public.is_admin()))
  order by ic.created_at desc
  limit 100;
$$;

-- set_invite_settings: solo el admin.
create or replace function public.set_invite_settings(
  p_members_can_invite boolean,
  p_max_active integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede hacer esto' using errcode = '42501';
  end if;
  if p_max_active is null or p_max_active < 1 or p_max_active > 50 then
    raise exception 'El máximo debe estar entre 1 y 50' using errcode = '22023';
  end if;
  insert into public.app_settings (id, members_can_invite, max_active_invites_per_user, updated_at)
  values (true, coalesce(p_members_can_invite, false), p_max_active, now())
  on conflict (id) do update set
    members_can_invite = excluded.members_can_invite,
    max_active_invites_per_user = excluded.max_active_invites_per_user,
    updated_at = now();
end;
$$;

revoke all on function public.my_invite_status() from public, anon;
revoke all on function public.create_invite_code(integer, integer) from public, anon;
revoke all on function public.revoke_invite_code(uuid) from public, anon;
revoke all on function public.list_invite_codes(boolean) from public, anon;
revoke all on function public.set_invite_settings(boolean, integer) from public, anon;
grant execute on function public.my_invite_status() to authenticated;
grant execute on function public.create_invite_code(integer, integer) to authenticated;
grant execute on function public.revoke_invite_code(uuid) to authenticated;
grant execute on function public.list_invite_codes(boolean) to authenticated;
grant execute on function public.set_invite_settings(boolean, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Solo servidor (service role): consultar y canjear un código y el límite de intentos.
-- ─────────────────────────────────────────────────────────────
-- lookup_invite_code: estado del código y nombre de quien invita.
-- state: active | used | expired | revoked | not_found | inviter_inactive.
create or replace function public.lookup_invite_code(p_code text)
returns table (state text, code text, inviter_id uuid, inviter_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      case
        when ic.id is null then 'not_found'
        when not coalesce(p.active, false)
          and public.invite_code_state(ic.revoked, ic.expires_at, ic.uses, ic.max_uses) = 'active'
          then 'inviter_inactive'
        else public.invite_code_state(ic.revoked, ic.expires_at, ic.uses, ic.max_uses)
      end,
      'not_found'),
    ic.code,
    ic.created_by,
    p.display_name
  from (select public.normalize_invite_code(p_code) as c) q
  left join public.invite_codes ic on ic.code = q.c
  left join public.profiles p on p.id = ic.created_by;
$$;

-- redeem_invite_code(código, usuario): en una transacción, comprueba el código (bloqueándolo),
-- suma el uso y deja el vínculo aceptado en los dos sentidos con los permisos por defecto (solo
-- cumplimiento). Si ya estaban vinculados, no gasta el código ('already_linked'); un vínculo ya
-- aceptado conserva sus permisos. Errores: invite_not_found | invite_revoked | invite_used |
-- invite_expired | invite_inviter_inactive | invite_own | user_not_found.
create or replace function public.redeem_invite_code(p_code text, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.invite_codes;
  st text;
begin
  select * into c from public.invite_codes ic
  where ic.code = public.normalize_invite_code(p_code)
  for update;
  if c.id is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  st := public.invite_code_state(c.revoked, c.expires_at, c.uses, c.max_uses);
  if st <> 'active' then
    raise exception 'invite_%', st using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = c.created_by and p.active) then
    raise exception 'invite_inviter_inactive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.active) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if c.created_by = p_user then
    raise exception 'invite_own' using errcode = '22023';
  end if;

  if (
    select count(*) from public.partner_links l
    where l.status = 'accepted'
      and ((l.user_id = c.created_by and l.partner_id = p_user)
        or (l.user_id = p_user and l.partner_id = c.created_by))
  ) = 2 then
    return 'already_linked';
  end if;

  update public.invite_codes ic
  set uses = ic.uses + 1, used_by = p_user, used_at = now()
  where ic.id = c.id;

  insert into public.partner_links (
    user_id, partner_id, status, can_view_adherence, can_view_sessions, can_view_muscles,
    can_view_achievements, can_view_metrics
  ) values
    (c.created_by, p_user, 'accepted', true, false, false, false, false),
    (p_user, c.created_by, 'accepted', true, false, false, false, false)
  on conflict (user_id, partner_id) do update set
    status = 'accepted',
    can_view_adherence = true,
    can_view_sessions = false,
    can_view_muscles = false,
    can_view_achievements = false,
    can_view_metrics = false
  where public.partner_links.status <> 'accepted';

  return 'linked';
end;
$$;

-- Límite de intentos: cuántos lleva una clave (hash de la IP) en la ventana; borra lo antiguo.
create or replace function public.invite_attempts_count(p_key text, p_window_s integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.invite_attempts a where a.created_at < now() - interval '1 day';
  select count(*) into n from public.invite_attempts a
  where a.key = p_key and a.created_at > now() - make_interval(secs => p_window_s);
  return n;
end;
$$;

create or replace function public.record_invite_attempt(p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.invite_attempts (key) values (p_key);
$$;

revoke all on function public.lookup_invite_code(text) from public, anon, authenticated;
revoke all on function public.redeem_invite_code(text, uuid) from public, anon, authenticated;
revoke all on function public.invite_attempts_count(text, integer)
  from public, anon, authenticated;
revoke all on function public.record_invite_attempt(text) from public, anon, authenticated;
grant execute on function public.lookup_invite_code(text) to service_role;
grant execute on function public.redeem_invite_code(text, uuid) to service_role;
grant execute on function public.invite_attempts_count(text, integer) to service_role;
grant execute on function public.record_invite_attempt(text) to service_role;
