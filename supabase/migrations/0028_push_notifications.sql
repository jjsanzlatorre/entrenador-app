-- 0028_push_notifications.sql
-- Fase 7B: notificaciones push (Web Push con VAPID).
-- - push_subscriptions: una fila por dispositivo (endpoint del navegador). Un endpoint pertenece
--   a un solo usuario: si en ese móvil entra otra persona, la suscripción pasa a ser suya.
-- - notification_settings: qué avisos quiere cada usuario, hora del recordatorio y zona horaria.
-- - push_log: avisos ya enviados (máx. 1 recordatorio al día, sin repetir invitaciones ni
--   reacciones). Solo lo escribe el servidor con service role.
-- El envío lo hace el servidor (Vercel). Los recordatorios programados los dispara pg_cron +
-- pg_net (ver supabase/snippets/push_cron.sql), no esta migración.
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- 1. Suscripciones
-- ─────────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke insert, update on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;

drop policy if exists "push_subscriptions_own_select" on public.push_subscriptions;
create policy "push_subscriptions_own_select" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()));

drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;
create policy "push_subscriptions_own_delete" on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Guarda la suscripción de este dispositivo para el usuario actual (la quita a quien la tuviera).
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sub uuid;
begin
  if uid is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    failure_count = 0
  returning id into sub;
  return sub;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Preferencias
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notification_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  pair_invites boolean not null default true,
  reactions boolean not null default true,
  plan_reminder boolean not null default false,
  -- Hora local del recordatorio, en tramos de 15 min (pg_cron lo mira cada 15 min).
  reminder_time time not null default '08:00'
    check (extract(second from reminder_time) = 0 and extract(minute from reminder_time)::int % 15 = 0),
  behind_nudge boolean not null default false,
  tz text not null default 'Europe/Madrid' check (length(tz) between 1 and 64),
  updated_at timestamptz not null default now()
);

drop trigger if exists notification_settings_set_updated_at on public.notification_settings;
create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

-- La zona horaria tiene que existir (si no, el servidor no podría calcular la hora local).
create or replace function public.notification_settings_check_tz()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then
    raise exception 'zona horaria no válida: %', new.tz using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists notification_settings_check_tz on public.notification_settings;
create trigger notification_settings_check_tz
  before insert or update of tz on public.notification_settings
  for each row execute function public.notification_settings_check_tz();

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon;
grant select, insert, update on public.notification_settings to authenticated;

drop policy if exists "notification_settings_own" on public.notification_settings;
create policy "notification_settings_own" on public.notification_settings
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- 3. Registro de envíos (solo servidor)
-- key: 'daily:YYYY-MM-DD' | 'pair:<invite id>' | 'reaction:<de>:<tipo>:<objetivo>'
-- ─────────────────────────────────────────────────────────────
create table if not exists public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (length(key) between 1 and 200),
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists push_log_sent_idx on public.push_log (sent_at);

alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
-- Sin políticas: solo service role (que salta la RLS) lee y escribe.
