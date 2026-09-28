-- 0005_seed_muscles.sql
-- Semilla: músculos (CLAUDE.md §5).
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.muscles (id, name, view, "group") values
  ('chest', 'Pectoral', 'front', 'upper'),
  ('lats', 'Dorsal', 'back', 'upper'),
  ('upper_back', 'Trapecio / espalda alta', 'back', 'upper'),
  ('lower_back', 'Lumbar', 'back', 'core'),
  ('delt_front', 'Deltoides anterior', 'front', 'upper'),
  ('delt_side', 'Deltoides lateral', 'both', 'upper'),
  ('delt_rear', 'Deltoides posterior', 'back', 'upper'),
  ('biceps', 'Bíceps', 'front', 'upper'),
  ('triceps', 'Tríceps', 'back', 'upper'),
  ('forearms', 'Antebrazo', 'both', 'upper'),
  ('core', 'Core (abdomen y oblicuos)', 'front', 'core'),
  ('glutes', 'Glúteo', 'back', 'lower'),
  ('quads', 'Cuádriceps', 'front', 'lower'),
  ('hamstrings', 'Isquiotibiales', 'back', 'lower'),
  ('adductors', 'Aductores', 'front', 'lower'),
  ('calves', 'Gemelos', 'back', 'lower')
on conflict (id) do update set
  name = excluded.name,
  view = excluded.view,
  "group" = excluded."group";
