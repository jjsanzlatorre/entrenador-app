-- 0018_seed_exercises_phase5.sql
-- Semilla: ejercicios añadidos en la fase 5 (zonas de DEKA). Requiere 0005.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.exercises (
  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,
  default_rest_s, technique_notes
) values
  ('ram_reverse_lunge', 'Zancada inversa con RAM', array['ram lunge', 'reverse lunge', 'zancada atrás', 'deka lunge']::text[], 'functional', 'weight_reps', array['ram', 'sandbag']::text[], true, true, 90, 'RAM (o saco) sobre los hombros, paso atrás largo, rodilla trasera casi al suelo y tronco erguido; alternar piernas.'),
  ('tank_push_pull', 'Tank push/pull', array['tank', 'deka tank', 'empuje y arrastre']::text[], 'functional', 'distance_time', array['tank', 'sled']::text[], false, true, 120, 'Empujar con el cuerpo inclinado y brazos firmes; al arrastrar, caminar hacia atrás con la cadera baja y tirar con la espalda, no solo con los brazos.'),
  ('ram_burpee', 'Burpee con RAM', array['ram burpee', 'deka burpee', 'burpee con saco']::text[], 'functional', 'reps', array['ram', 'sandbag']::text[], false, true, 90, 'Pecho al suelo con las manos sobre el RAM, saltar los pies adelante y levantar el RAM por encima de la cabeza al subir.')
on conflict (id) do update set
  name = excluded.name,
  aliases = excluded.aliases,
  category = excluded.category,
  tracking_type = excluded.tracking_type,
  equipment = excluded.equipment,
  is_unilateral = excluded.is_unilateral,
  is_compound = excluded.is_compound,
  default_rest_s = excluded.default_rest_s,
  technique_notes = excluded.technique_notes
where public.exercises.owner_id is null;

-- Músculos: se reescriben para que la semilla sea la fuente de verdad.
delete from public.exercise_muscles where exercise_id in ('ram_reverse_lunge', 'tank_push_pull', 'ram_burpee');

insert into public.exercise_muscles (exercise_id, muscle_id, role) values
  ('ram_reverse_lunge', 'quads', 'primary'),
  ('ram_reverse_lunge', 'glutes', 'primary'),
  ('ram_reverse_lunge', 'adductors', 'secondary'),
  ('ram_reverse_lunge', 'core', 'secondary'),
  ('ram_reverse_lunge', 'hamstrings', 'secondary'),
  ('tank_push_pull', 'quads', 'primary'),
  ('tank_push_pull', 'glutes', 'primary'),
  ('tank_push_pull', 'upper_back', 'primary'),
  ('tank_push_pull', 'calves', 'secondary'),
  ('tank_push_pull', 'core', 'secondary'),
  ('tank_push_pull', 'lats', 'secondary'),
  ('tank_push_pull', 'hamstrings', 'secondary'),
  ('ram_burpee', 'chest', 'primary'),
  ('ram_burpee', 'quads', 'primary'),
  ('ram_burpee', 'core', 'secondary'),
  ('ram_burpee', 'triceps', 'secondary'),
  ('ram_burpee', 'delt_front', 'secondary'),
  ('ram_burpee', 'glutes', 'secondary')
on conflict (exercise_id, muscle_id) do update set role = excluded.role;
