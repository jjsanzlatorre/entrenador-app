-- 0015_profile_settings_commitment_end.sql
-- 1) Perfil: el usuario puede editar sus campos personales y de preferencias (nombre, datos
--    personales, ciudad de referencia y pop-ups de logros), pero nunca role ni active.
--    Se rehacen los permisos de columna y la política de 0001 (por si la base de producción
--    quedó con otros) y se añade un trigger como segunda barrera para role/active.
-- 2) Compromiso: end_commitment (quitar el compromiso vigente conservando el historial).
--    Borrar una entrada del historial se hace con DELETE directo (política commitments_own).
-- Idempotente.

-- ─────────────────────────────────────────────────────────────
-- profiles: permisos de columna
-- ─────────────────────────────────────────────────────────────
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (
  display_name, sex, birth_year, height_cm,
  home_city, home_lat, home_lng, show_equivalence_popups
) on public.profiles to authenticated;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active()))
  with check (id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- profiles: role y active solo cambian desde el servidor (service role) o el SQL Editor.
-- SECURITY INVOKER: current_user es el rol de quien hace el UPDATE.
-- ─────────────────────────────────────────────────────────────
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
          or new.id is distinct from old.id) then
    raise exception 'No puedes cambiar role, active ni id de un perfil'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_admin_fields on public.profiles;
create trigger profiles_protect_admin_fields
  before update on public.profiles
  for each row execute function public.protect_profile_admin_fields();

-- ─────────────────────────────────────────────────────────────
-- end_commitment: cierra el compromiso vigente con valid_to = p_today (fecha local del
-- cliente) y deja al usuario sin compromiso. Los que empezasen después de p_today se borran.
-- Devuelve cuántos compromisos se han cerrado o borrado. SECURITY INVOKER: aplica la RLS.
-- ─────────────────────────────────────────────────────────────
create or replace function public.end_commitment(p_today date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  removed integer;
  closed integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.commitments c
  where c.user_id = uid and c.valid_from > p_today;
  get diagnostics removed = row_count;

  update public.commitments c
  set valid_to = p_today
  where c.user_id = uid and (c.valid_to is null or c.valid_to > p_today);
  get diagnostics closed = row_count;

  return removed + closed;
end;
$$;

revoke all on function public.end_commitment(date) from public, anon;
grant execute on function public.end_commitment(date) to authenticated;
