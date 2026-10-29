-- 0046_workout_parse.sql
-- «Escribir entreno» (bloques por rondas): cuando el parser de la app no entiende el texto, la
-- IA lo convierte en bloques (modelo normal, 1 consulta). Se registra en ai_interactions como
-- las demás consultas (límite diario incluido), con el tipo nuevo 'workout_parse'.
-- Las rondas, los descansos y «cada lado» van en session_blocks.config (jsonb), sin cambios de
-- esquema: config.settings = { kind: 'circuit', rounds, rest_between_rounds_s,
-- rest_between_exercises_s } y config.exercises[].per_side.
-- Idempotente.

alter table public.ai_interactions drop constraint if exists ai_interactions_kind_check;
alter table public.ai_interactions add constraint ai_interactions_kind_check check (kind in (
  'plan_generation', 'daily_adjust', 'weekly_review', 'chat', 'exercise_swap', 'workout_parse'
));
