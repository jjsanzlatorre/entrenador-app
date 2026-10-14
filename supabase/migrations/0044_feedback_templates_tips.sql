-- 0044_feedback_templates_tips.sql
-- Usabilidad 3/3:
-- 1. feedback: comentarios desde la app (fallo / idea / incómodo) con la ruta, la fecha y el
--    dispositivo. Cada usuario crea y ve los suyos; el admin ve todos y cambia su estado
--    (nuevo / hecho / descartado).
-- 2. workout_templates: «Mis plantillas» de entreno (estructura de una sesión sin pesos, que se
--    rellenan con la sugerencia al empezar). Solo del dueño.
-- 3. dismissed_tips: consejos de primera vez que el usuario ya ha cerrado (no vuelven a salir en
--    ningún dispositivo). Solo del dueño.
-- Requiere 0001 (is_admin, is_active) y 0031 (activity_types). Idempotente.

-- ─────────────────────────────────────────────────────────────
-- feedback
-- ─────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'awkward')),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  route text check (route is null or char_length(route) <= 300),
  -- Resumen del dispositivo (sistema, navegador, pantalla, PWA instalada…), texto corto.
  device text check (device is null or char_length(device) <= 500),
  app_version text check (app_version is null or char_length(app_version) <= 60),
  status text not null default 'new' check (status in ('new', 'done', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon;
revoke all on public.feedback from authenticated;
grant select, delete on public.feedback to authenticated;
grant insert (kind, message, route, device, app_version) on public.feedback to authenticated;
grant update (status, updated_at) on public.feedback to authenticated;

drop policy if exists "feedback_select_own_or_admin" on public.feedback;
create policy "feedback_select_own_or_admin" on public.feedback
  for select to authenticated
  using (
    (select public.is_active())
    and (user_id = (select auth.uid()) or (select public.is_admin()))
  );

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'new' and (select public.is_active())
  );

-- Solo el admin cambia el estado.
drop policy if exists "feedback_update_admin" on public.feedback;
create policy "feedback_update_admin" on public.feedback
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- El admin puede borrar cualquiera (limpieza).
drop policy if exists "feedback_delete_admin" on public.feedback;
create policy "feedback_delete_admin" on public.feedback
  for delete to authenticated
  using ((select public.is_admin()));

-- ─────────────────────────────────────────────────────────────
-- workout_templates
-- structure: { v: 1, location, blocks: [{ block_type, settings, exercises: [{ exercise_id,
--   rest_s, target_reps? }], sets: [{ exercise_id, is_warmup, reps, duration_s, distance_m }] }] }
-- (mismo formato que la estructura del entreno en pareja; sin pesos ni notas).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  session_type text not null check (session_type in (
    'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning', 'yoga', 'fronton',
    'padel', 'tennis', 'functional_class', 'gap', 'oxfit', 'surf', 'other', 'custom'
  )),
  activity_type_id text references public.activity_types (id) on delete set null,
  structure jsonb not null check (
    jsonb_typeof(structure) = 'object'
    and jsonb_typeof(structure -> 'blocks') = 'array'
    and jsonb_array_length(structure -> 'blocks') between 1 and 40
    and pg_column_size(structure) <= 200000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists workout_templates_user_idx
  on public.workout_templates (user_id, last_used_at desc nulls last);

-- Como mucho 50 plantillas por usuario.
create or replace function public.limit_workout_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.workout_templates t where t.user_id = new.user_id) >= 50 then
    raise exception 'máximo 50 plantillas';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_workout_templates() from public, anon, authenticated;

drop trigger if exists workout_templates_limit on public.workout_templates;
create trigger workout_templates_limit
  before insert on public.workout_templates
  for each row execute function public.limit_workout_templates();

alter table public.workout_templates enable row level security;
revoke all on public.workout_templates from anon;
revoke all on public.workout_templates from authenticated;
grant select, delete on public.workout_templates to authenticated;
grant insert (id, name, session_type, activity_type_id, structure)
  on public.workout_templates to authenticated;
grant update (name, structure, updated_at, last_used_at)
  on public.workout_templates to authenticated;

drop policy if exists "workout_templates_own" on public.workout_templates;
create policy "workout_templates_own" on public.workout_templates
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- dismissed_tips
-- ─────────────────────────────────────────────────────────────
create table if not exists public.dismissed_tips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tip_id text not null check (tip_id ~ '^[a-z0-9_-]{1,40}$'),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, tip_id)
);

alter table public.dismissed_tips enable row level security;
revoke all on public.dismissed_tips from anon;
revoke all on public.dismissed_tips from authenticated;
grant select, delete on public.dismissed_tips to authenticated;
grant insert (tip_id) on public.dismissed_tips to authenticated;

drop policy if exists "dismissed_tips_own" on public.dismissed_tips;
create policy "dismissed_tips_own" on public.dismissed_tips
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));
