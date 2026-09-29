-- push_cron.sql — recordatorios programados (fase 7B). NO es una migración: lleva tu URL y tu
-- secreto. Pégalo en el SQL Editor de Supabase DESPUÉS de 0028_push_notifications.sql.
--
-- Qué hace: cada 15 min, pg_cron llama con pg_net a https://TU-APP.vercel.app/api/push/cron
-- con el secreto CRON_SECRET. Vercel decide a quién toca avisar y manda las notificaciones.
-- (Vercel Cron en el plan Hobby solo permite una ejecución al día con ±59 min de margen: no
-- sirve para recordatorios a la hora que elige cada usuario.)
--
-- Antes de ejecutarlo, cambia las DOS líneas marcadas con «← CAMBIA»:
--   1. La URL de tu app en Vercel.
--   2. El mismo valor que pusiste en la variable CRON_SECRET de Vercel.
-- Se puede ejecutar varias veces (actualiza los secretos y la programación).

-- 1. Extensiones (incluidas en el plan Free). También se pueden activar en
--    Database → Extensions (pg_cron y pg_net).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 2. URL y secreto en Supabase Vault (cifrados; no quedan a la vista en cron.job).
do $$
declare
  v_url text := 'https://TU-APP.vercel.app/api/push/cron';   -- ← CAMBIA
  v_secret text := 'PEGA_AQUI_EL_CRON_SECRET';              -- ← CAMBIA
  v_id uuid;
begin
  if v_url like '%TU-APP%' or v_secret like 'PEGA_AQUI%' then
    raise exception 'Cambia la URL y el secreto antes de ejecutar este script';
  end if;

  select id into v_id from vault.secrets where name = 'push_cron_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'push_cron_url', 'URL de /api/push/cron');
  else
    perform vault.update_secret(v_id, v_url);
  end if;

  v_id := null;
  select id into v_id from vault.secrets where name = 'push_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'push_cron_secret', 'CRON_SECRET de Vercel');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end $$;

-- 3. Trabajo cada 15 min (volver a programarlo con el mismo nombre lo sustituye).
select cron.schedule(
  'push-reminders',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- 4. Limpieza diaria del historial de ejecuciones (si no, cron.job_run_details crece sin fin).
select cron.schedule(
  'cron-history-cleanup',
  '23 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days' $job$
);

-- ─────────────────────────────────────────────────────────────
-- Comprobar (ejecuta estas consultas sueltas cuando quieras):
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details
--     order by start_time desc limit 10;
--   select status_code, content, created from net._http_response order by created desc limit 10;
--   (status_code 200 = bien; 401 = CRON_SECRET distinto en Vercel y aquí; 503 = faltan claves VAPID)
--
-- Desactivar los recordatorios programados:
--   select cron.unschedule('push-reminders');
