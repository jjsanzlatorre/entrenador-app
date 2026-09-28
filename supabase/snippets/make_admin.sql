-- make_admin.sql — NO es una migración. Ejecutar una sola vez, a mano, en el SQL Editor.
-- Convierte en admin al usuario con este email (debe existir ya en Authentication → Users).
-- Cambia el email antes de ejecutarlo.

update public.profiles
set role = 'admin', active = true
where id = (select id from auth.users where email = 'TU_EMAIL@ejemplo.com');

-- Comprobación: debe devolver una fila con role = 'admin'.
select p.id, u.email, p.role, p.active
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin';
