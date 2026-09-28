-- 0009_body_metrics_photos.sql
-- Peso y medidas (body_metrics) y fotos de progreso (progress_photos).
-- Las fotos se guardan en el bucket privado progress-photos (ver 0010) bajo {user_id}/…
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- body_metrics: un registro por usuario y día.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  weight_kg numeric(5, 2) check (weight_kg > 0 and weight_kg < 500),
  body_fat_pct numeric(4, 1) check (body_fat_pct >= 0 and body_fat_pct <= 80),
  waist_cm numeric(5, 1) check (waist_cm > 0 and waist_cm < 300),
  hip_cm numeric(5, 1) check (hip_cm > 0 and hip_cm < 300),
  chest_cm numeric(5, 1) check (chest_cm > 0 and chest_cm < 300),
  arm_cm numeric(5, 1) check (arm_cm > 0 and arm_cm < 150),
  thigh_cm numeric(5, 1) check (thigh_cm > 0 and thigh_cm < 200),
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists body_metrics_user_date_idx on public.body_metrics (user_id, date desc);

alter table public.body_metrics enable row level security;
revoke all on public.body_metrics from anon;
grant select, insert, update, delete on public.body_metrics to authenticated;

drop policy if exists "body_metrics_own" on public.body_metrics;
create policy "body_metrics_own" on public.body_metrics
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- progress_photos: nunca se comparten (sin políticas de pareja).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  pose text not null check (pose in ('front', 'side', 'back')),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check (storage_path like user_id::text || '/%')
);

create index if not exists progress_photos_user_date_idx
  on public.progress_photos (user_id, date desc);

alter table public.progress_photos enable row level security;
revoke all on public.progress_photos from anon;
grant select, insert, delete on public.progress_photos to authenticated;
revoke update on public.progress_photos from authenticated;

drop policy if exists "progress_photos_own" on public.progress_photos;
create policy "progress_photos_own" on public.progress_photos
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));
