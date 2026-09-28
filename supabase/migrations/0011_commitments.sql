-- 0011_commitments.sql
-- Compromiso semanal con historial (CLAUDE.md §10A). Cambiar el compromiso cierra el anterior
-- (valid_to) y crea uno nuevo, así cada semana se mide con lo que se prometió entonces.
-- valid_from siempre es un lunes (lo calcula el cliente con su zona horaria); valid_to es inclusivo.
-- Idempotente.

create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  valid_from date not null,
  valid_to date,
  sessions_per_week integer not null check (sessions_per_week between 1 and 14),
  minutes_per_week integer check (minutes_per_week between 1 and 5000),
  -- Reparto por tipo de sesión, p. ej. {"strength": 2, "swimming": 1}.
  by_type jsonb check (by_type is null or jsonb_typeof(by_type) = 'object'),
  counts_free_activities boolean not null default true,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists commitments_user_from_idx on public.commitments (user_id, valid_from);

alter table public.commitments enable row level security;
revoke all on public.commitments from anon;
grant select, insert, update, delete on public.commitments to authenticated;

drop policy if exists "commitments_own" on public.commitments;
create policy "commitments_own" on public.commitments
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- ─────────────────────────────────────────────────────────────
-- set_commitment: cierra el compromiso vigente el día anterior a p_valid_from y crea el nuevo.
-- Si ya había uno que empezaba esa misma semana (o después), se sustituye.
-- SECURITY INVOKER: aplica la RLS de arriba.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_commitment(
  p_valid_from date,
  p_sessions_per_week integer,
  p_minutes_per_week integer default null,
  p_by_type jsonb default null,
  p_counts_free_activities boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if extract(isodow from p_valid_from) <> 1 then
    raise exception 'valid_from debe ser lunes';
  end if;
  if p_by_type is not null and exists (
    select 1 from jsonb_each(p_by_type) t
    where jsonb_typeof(t.value) <> 'number' or (t.value)::numeric < 0 or (t.value)::numeric > 14
      or t.key not in (
        'strength', 'functional', 'running', 'swimming', 'cycling', 'spinning',
        'yoga', 'padel_fronton', 'surf', 'other'
      )
  ) then
    raise exception 'by_type no válido';
  end if;

  delete from public.commitments c
  where c.user_id = uid and c.valid_from >= p_valid_from;

  update public.commitments c
  set valid_to = p_valid_from - 1
  where c.user_id = uid and (c.valid_to is null or c.valid_to >= p_valid_from);

  insert into public.commitments (
    user_id, valid_from, valid_to, sessions_per_week, minutes_per_week, by_type,
    counts_free_activities
  ) values (
    uid, p_valid_from, null, p_sessions_per_week, p_minutes_per_week,
    nullif(p_by_type, '{}'::jsonb), coalesce(p_counts_free_activities, true)
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.set_commitment(date, integer, integer, jsonb, boolean)
  from public, anon;
grant execute on function public.set_commitment(date, integer, integer, jsonb, boolean)
  to authenticated;
