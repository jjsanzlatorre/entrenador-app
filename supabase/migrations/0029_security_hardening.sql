-- 0029_security_hardening.sql
-- Revisión de seguridad final (fase 7B).
-- Las funciones de trigger SECURITY DEFINER no se pueden llamar fuera de un trigger, pero por
-- higiene nadie debe tener EXECUTE sobre ellas (los triggers se disparan igual: el permiso se
-- comprueba al crear el trigger, no al dispararlo).
-- tests/db/security.test.ts comprueba en cada ejecución que:
-- - todas las tablas de public tienen RLS,
-- - todas las SECURITY DEFINER fijan search_path,
-- - anon no puede ejecutar ninguna SECURITY DEFINER ni leer tablas de usuario.
-- Idempotente.

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.link_planned_session() from public, anon, authenticated;

-- are_linked(a, b) la puede llamar cualquier usuario autenticado: sin esta comprobación, alguien
-- con dos uuid podría averiguar si otras dos personas están vinculadas. Ahora solo responde si
-- quien pregunta es una de las dos (sus únicos usos, en 0027, siempre pasan auth.uid()).
create or replace function public.are_linked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) in (p_a, p_b)
  and exists (
    select 1 from public.partner_links l
    where l.user_id = p_a and l.partner_id = p_b and l.status = 'accepted'
  ) and exists (
    select 1 from public.partner_links l
    where l.user_id = p_b and l.partner_id = p_a and l.status = 'accepted'
  );
$$;

revoke all on function public.are_linked(uuid, uuid) from public, anon;
grant execute on function public.are_linked(uuid, uuid) to authenticated;
