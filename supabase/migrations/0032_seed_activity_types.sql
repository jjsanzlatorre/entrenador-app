-- 0032_seed_activity_types.sql
-- Semilla: actividades nuevas (frontón, pádel, tenis, clases de gimnasio) y tipos de actividad globales con su aproximación muscular (CLAUDE.md §6). Requiere 0026 y 0031.
-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.
-- Idempotente: se puede ejecutar varias veces.

insert into public.exercises (
  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,
  default_rest_s, technique_notes
) values
  ('padel', 'Pádel', array['padel', 'paddle']::text[], 'sport', 'duration_only', '{}'::text[], false, false, 0, null),
  ('tennis', 'Tenis', array['tennis', 'raqueta']::text[], 'sport', 'duration_only', '{}'::text[], false, false, 0, null),
  ('functional_class', 'Functional Training (clase)', array['functional', 'clase de functional', 'entrenamiento funcional']::text[], 'functional', 'duration_only', '{}'::text[], false, false, 0, null),
  ('gap_class', 'GAP (clase)', array['gap', 'glúteos abdominales piernas', 'gluteos abdominales piernas']::text[], 'functional', 'duration_only', '{}'::text[], false, false, 0, null),
  ('oxfit_class', 'Oxfit (clase)', array['oxfit', 'clase de alta intensidad']::text[], 'functional', 'duration_only', '{}'::text[], false, false, 0, null)
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
delete from public.exercise_muscles where exercise_id in ('padel', 'tennis', 'functional_class', 'gap_class', 'oxfit_class');

-- Técnica de los ejercicios nuevos (0026 solo cubre los anteriores).
update public.exercises e set
  technique_steps = v.steps,
  technique_mistakes = v.mistakes
from (values
  ('padel', array['Calienta 5–10 min: movilidad de hombro, muñeca y tobillos, y peloteo suave en la red.', 'Posición de espera con las rodillas flexionadas y la pala delante del pecho.', 'Golpea girando hombros y cadera, con la muñeca firme.', 'Muévete en pareja: subid y bajad juntos de la red.']::text[], array['Jugar con las piernas rectas y llegar tarde a la bola.', 'Golpear solo con el brazo y cargar el codo.', 'Empezar a rematar fuerte sin calentar el hombro.']::text[]),
  ('tennis', array['Calienta 5–10 min: movilidad de hombro, muñeca y cadera, y peloteo suave desde el fondo.', 'Paso de ajuste (split step) cada vez que el rival golpea.', 'Prepara la raqueta pronto y golpea girando tronco y cadera.', 'Vuelve al centro de la pista después de cada golpe.']::text[], array['Golpear solo con el brazo (codo de tenista).', 'Quedarse parado sobre los talones.', 'Sacar fuerte sin calentar el hombro.']::text[]),
  ('functional_class', array['Llega con tiempo para el calentamiento de la clase y avisa al monitor de cualquier molestia.', 'Elige un peso con el que mantengas la técnica en todas las repeticiones.', 'Prioriza la técnica sobre la velocidad en saltos, cargas y movimientos olímpicos.', 'Regula el ritmo: mejor terminar la clase entera que parar a la mitad.']::text[], array['Coger demasiado peso por seguir el ritmo de otros.', 'Perder la postura de la espalda cuando llega el cansancio.', 'Saltarse el calentamiento o la vuelta a la calma.']::text[]),
  ('gap_class', array['Calienta cadera, rodillas y tobillos con el calentamiento de la clase.', 'En sentadillas y zancadas, rodilla alineada con la punta del pie.', 'En los abdominales, zona lumbar controlada y respiración continua.', 'Controla la bajada de cada repetición en lugar de rebotar.']::text[], array['Hundir las rodillas hacia dentro en sentadillas y zancadas.', 'Tirar del cuello en los abdominales.', 'Añadir peso antes de dominar el movimiento.']::text[]),
  ('oxfit_class', array['Haz el calentamiento completo de la clase: la intensidad sube rápido.', 'Escala peso y repeticiones a tu nivel; pide la variante al monitor.', 'Mantén la técnica en los intervalos de trabajo aunque baje la velocidad.', 'Usa los descansos para respirar y recuperar, no para cambiar de ejercicio.']::text[], array['Ir a máxima intensidad desde el primer bloque.', 'Sacrificar la técnica por hacer más repeticiones.', 'Hacer la clase con dolor o molestias sin avisar.']::text[])
) as v (id, steps, mistakes)
where e.id = v.id and e.owner_id is null;

-- Tipos de actividad globales. Ajustables: la app lee esta tabla (y usa el JSON sin conexión).
insert into public.activity_types (
  id, owner_id, name, emoji, exercise_id, location, muscles, sets_per_30min, quick, fixed,
  free_activity, leg_loading, hard_legs, sort_order
) values
  ('running', null, 'Carrera', '🏃', 'run', 'outdoor', array['quads', 'hamstrings', 'calves', 'glutes']::text[], 2, false, false, false, false, false, 10),
  ('swimming', null, 'Natación', '🏊', 'swim_freestyle', 'pool', array['lats', 'delt_front', 'delt_side', 'triceps', 'core']::text[], 2, false, false, false, false, false, 20),
  ('cycling', null, 'Bici', '🚴', 'bike', 'outdoor', array['quads', 'glutes', 'calves']::text[], 2, false, false, false, false, false, 30),
  ('spinning', null, 'Spinning', '🚴', 'spinning', 'gym', array['quads', 'glutes', 'calves']::text[], 2, false, false, false, false, false, 40),
  ('functional_class', null, 'Functional Training', '🤸', 'functional_class', 'gym', array['quads', 'glutes', 'core', 'chest', 'delt_front', 'lats']::text[], 2, true, true, false, false, false, 50),
  ('gap', null, 'GAP', '🦵', 'gap_class', 'gym', array['glutes', 'core', 'quads', 'hamstrings', 'adductors']::text[], 2, true, true, false, false, true, 60),
  ('oxfit', null, 'Oxfit', '💥', 'oxfit_class', 'gym', array['quads', 'glutes', 'core', 'chest', 'delt_front', 'lats']::text[], 2, true, true, false, false, false, 70),
  ('padel', null, 'Pádel', '🏓', 'padel', 'outdoor', array['delt_front', 'delt_side', 'forearms', 'core', 'quads', 'calves']::text[], 2, true, true, true, true, false, 80),
  ('tennis', null, 'Tenis', '🎾', 'tennis', 'outdoor', array['delt_front', 'delt_side', 'forearms', 'core', 'quads', 'calves']::text[], 2, true, true, true, true, false, 90),
  ('fronton', null, 'Frontón', '🥎', 'fronton', 'outdoor', array['delt_front', 'forearms', 'core', 'quads']::text[], 2, true, true, true, true, false, 100),
  ('surf', null, 'Surf', '🏄', 'surf', 'outdoor', array['lats', 'delt_front', 'core', 'triceps']::text[], 2, true, true, true, true, false, 110),
  ('yoga', null, 'Yoga', '🧘', 'yoga', 'home', array['core', 'glutes', 'hamstrings']::text[], 0.5, true, true, true, false, false, 120),
  ('other', null, 'Otra actividad', '⚡', 'other_activity', 'other', '{}'::text[], 0, true, true, true, false, false, 130)
on conflict (id) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  exercise_id = excluded.exercise_id,
  location = excluded.location,
  muscles = excluded.muscles,
  sets_per_30min = excluded.sets_per_30min,
  quick = excluded.quick,
  fixed = excluded.fixed,
  free_activity = excluded.free_activity,
  leg_loading = excluded.leg_loading,
  hard_legs = excluded.hard_legs,
  sort_order = excluded.sort_order
where public.activity_types.owner_id is null;
