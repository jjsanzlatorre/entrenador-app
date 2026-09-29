// Genera las migraciones de semilla (SQL idempotente) a partir de supabase/seed/*.json.
// Uso: npm run seed:sql
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { PlanTemplate } from '../src/lib/plan/types.ts'
import { buildPlanTemplates } from './plan-templates.ts'

type Muscle = { id: string; name: string; view: string; group: string }
type SeedExercise = {
  id: string
  name: string
  aliases: string[]
  category: string
  tracking_type: string
  equipment: string[]
  is_unilateral: boolean
  is_compound: boolean
  default_rest_s: number
  technique_notes: string | null
  primary: string[]
  secondary: string[]
  // Migración propia para ejercicios añadidos después de 0006/0007.
  migration?: string
}

type SeedObject = {
  id: string
  kind: string
  label: string
  label_plural: string
  article: string
  emoji: string
  value: number
  phrase_template: string
  min_value: number
  source: string
}
type SeedDestination = {
  id: string
  name: string
  lat: number
  lng: number
  type: string
  water_route: boolean
}

type SeedTechnique = { steps: string[]; mistakes: string[] }
type SeedActivityType = {
  id: string
  name: string
  emoji: string
  exercise_id: string
  location: string
  muscles: string[]
  sets_per_30min: number
  quick: boolean
  fixed: boolean
  free_activity: boolean
  leg_loading: boolean
  hard_legs: boolean
  sort_order: number
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function lit(value: string | null) {
  return value === null ? 'null' : `'${value.replace(/'/g, "''")}'`
}

function arr(values: string[]) {
  return values.length === 0 ? `'{}'::text[]` : `array[${values.map(lit).join(', ')}]::text[]`
}

function header(file: string, description: string) {
  return `-- ${file}\n-- ${description}\n-- GENERADO por scripts/seed-sql.ts a partir de supabase/seed/*.json. No editar a mano.\n-- Idempotente: se puede ejecutar varias veces.\n\n`
}

function musclesSql(muscles: Muscle[]) {
  const file = '0005_seed_muscles.sql'
  const rows = muscles
    .map((m) => `  (${lit(m.id)}, ${lit(m.name)}, ${lit(m.view)}, ${lit(m.group)})`)
    .join(',\n')
  return {
    file,
    sql:
      header(file, 'Semilla: músculos (CLAUDE.md §5).') +
      `insert into public.muscles (id, name, view, "group") values\n${rows}\n` +
      `on conflict (id) do update set\n  name = excluded.name,\n  view = excluded.view,\n  "group" = excluded."group";\n`,
  }
}

function exercisesSql(file: string, description: string, exercises: SeedExercise[]) {
  const rows = exercises
    .map(
      (e) =>
        `  (${lit(e.id)}, ${lit(e.name)}, ${arr(e.aliases)}, ${lit(e.category)}, ${lit(e.tracking_type)}, ` +
        `${arr(e.equipment)}, ${e.is_unilateral}, ${e.is_compound}, ${e.default_rest_s}, ${lit(e.technique_notes)})`,
    )
    .join(',\n')
  const ids = exercises.map((e) => lit(e.id)).join(', ')
  const muscleRows = exercises.flatMap((e) => [
    ...e.primary.map((m) => `  (${lit(e.id)}, ${lit(m)}, 'primary')`),
    ...e.secondary.map((m) => `  (${lit(e.id)}, ${lit(m)}, 'secondary')`),
  ])

  let sql =
    header(file, description) +
    `insert into public.exercises (\n  id, name, aliases, category, tracking_type, equipment, is_unilateral, is_compound,\n  default_rest_s, technique_notes\n) values\n${rows}\n` +
    `on conflict (id) do update set\n` +
    `  name = excluded.name,\n  aliases = excluded.aliases,\n  category = excluded.category,\n` +
    `  tracking_type = excluded.tracking_type,\n  equipment = excluded.equipment,\n` +
    `  is_unilateral = excluded.is_unilateral,\n  is_compound = excluded.is_compound,\n` +
    `  default_rest_s = excluded.default_rest_s,\n  technique_notes = excluded.technique_notes\n` +
    `where public.exercises.owner_id is null;\n\n` +
    `-- Músculos: se reescriben para que la semilla sea la fuente de verdad.\n` +
    `delete from public.exercise_muscles where exercise_id in (${ids});\n`
  if (muscleRows.length > 0) {
    sql +=
      `\ninsert into public.exercise_muscles (exercise_id, muscle_id, role) values\n${muscleRows.join(',\n')}\n` +
      `on conflict (exercise_id, muscle_id) do update set role = excluded.role;\n`
  }
  return { file, sql }
}

// Una línea de comentario (la fuente) antes de cada fila.
function comment(text: string) {
  return `  -- ${text.replace(/\s+/g, ' ')}`
}

function equivalencesSql(objects: SeedObject[], destinations: SeedDestination[], source: string) {
  const file = '0014_seed_equivalences.sql'
  const objectRows = objects
    .map(
      (o) =>
        `${comment(`Fuente: ${o.source}`)}\n` +
        `  (${lit(o.id)}, ${lit(o.kind)}, ${lit(o.label)}, ${lit(o.label_plural)}, ${lit(o.article)}, ` +
        `${lit(o.emoji)}, ${o.value}, ${lit(o.phrase_template)}, ${o.min_value})`,
    )
    .join(',\n')
  const destinationRows = destinations
    .map(
      (d) =>
        `  (${lit(d.id)}, ${lit(d.name)}, ${d.lat}, ${d.lng}, ${lit(d.type)}, ${d.water_route})`,
    )
    .join(',\n')
  return {
    file,
    sql:
      header(
        file,
        'Semilla: objetos de equivalencia y destinos (CLAUDE.md §10B). Valores aproximados. Requiere 0013.',
      ) +
      `insert into public.equivalence_objects (\n  id, kind, label, label_plural, article, emoji, value, phrase_template, min_value\n) values\n${objectRows}\n` +
      `on conflict (id) do update set\n` +
      `  kind = excluded.kind,\n  label = excluded.label,\n  label_plural = excluded.label_plural,\n` +
      `  article = excluded.article,\n  emoji = excluded.emoji,\n  value = excluded.value,\n` +
      `  phrase_template = excluded.phrase_template,\n  min_value = excluded.min_value;\n\n` +
      `-- Destinos. Fuente: ${source}\n` +
      `insert into public.destinations (id, name, lat, lng, type, water_route) values\n${destinationRows}\n` +
      `on conflict (id) do update set\n` +
      `  name = excluded.name,\n  lat = excluded.lat,\n  lng = excluded.lng,\n` +
      `  type = excluded.type,\n  water_route = excluded.water_route;\n`,
  }
}

function planTemplatesSql(file: string, description: string, templates: PlanTemplate[]) {
  const rows = templates
    .map(
      (t) =>
        `  (${lit(t.id)}, ${lit(t.family)}, ${lit(t.name)}, ${lit(t.level)}, ${t.weeks}, ` +
        `${t.days_per_week}, ${lit(t.description)},\n   ${lit(JSON.stringify(t.structure))}::jsonb)`,
    )
    .join(',\n')
  return {
    file,
    sql:
      header(file, description) +
      `insert into public.plan_templates (\n  id, family, name, level, weeks, days_per_week, description, structure\n) values\n${rows}\n` +
      `on conflict (id) do update set\n` +
      `  family = excluded.family,\n  name = excluded.name,\n  level = excluded.level,\n` +
      `  weeks = excluded.weeks,\n  days_per_week = excluded.days_per_week,\n` +
      `  description = excluded.description,\n  structure = excluded.structure;\n`,
  }
}

function techniqueRows(technique: Record<string, SeedTechnique>) {
  return Object.entries(technique)
    .map(([id, t]) => `  (${lit(id)}, ${arr(t.steps)}, ${arr(t.mistakes)})`)
    .join(',\n')
}

function techniqueUpdate(technique: Record<string, SeedTechnique>) {
  return (
    `update public.exercises e set\n` +
    `  technique_steps = v.steps,\n  technique_mistakes = v.mistakes\n` +
    `from (values\n${techniqueRows(technique)}\n) as v (id, steps, mistakes)\n` +
    `where e.id = v.id and e.owner_id is null;\n`
  )
}

// Técnica (fase 6C): columnas estructuradas + pasos y errores de cada ejercicio global.
function techniqueSql(technique: Record<string, SeedTechnique>) {
  const file = '0026_exercise_technique.sql'
  return {
    file,
    sql:
      header(
        file,
        'Técnica de ejercicios (fase 6C): pasos clave y errores típicos de los ejercicios globales. Requiere 0003, 0006, 0007 y 0018.',
      ) +
      `alter table public.exercises\n` +
      `  add column if not exists technique_steps text[] not null default '{}',\n` +
      `  add column if not exists technique_mistakes text[] not null default '{}';\n\n` +
      `alter table public.exercises drop constraint if exists exercises_technique_len;\n` +
      `alter table public.exercises add constraint exercises_technique_len check (\n` +
      `  cardinality(technique_steps) <= 8 and cardinality(technique_mistakes) <= 8\n);\n\n` +
      `-- Solo ejercicios globales; los propios del usuario no se tocan.\n` +
      techniqueUpdate(technique),
  }
}

// Actividades (0032): ejercicios de las actividades nuevas (con su técnica) y tipos de
// actividad globales con su aproximación muscular (supabase/seed/activity_types.json).
function activityTypesSql(
  exercises: SeedExercise[],
  technique: Record<string, SeedTechnique>,
  activities: SeedActivityType[],
) {
  const file = '0032_seed_activity_types.sql'
  const base = exercisesSql(
    file,
    'Semilla: actividades nuevas (frontón, pádel, tenis, clases de gimnasio) y tipos de actividad globales con su aproximación muscular (CLAUDE.md §6). Requiere 0026 y 0031.',
    exercises,
  )
  const ownTechnique = Object.fromEntries(
    exercises.flatMap((e) => (technique[e.id] ? [[e.id, technique[e.id]!]] : [])),
  )
  const rows = activities
    .map(
      (a) =>
        `  (${lit(a.id)}, null, ${lit(a.name)}, ${lit(a.emoji)}, ${lit(a.exercise_id)}, ${lit(a.location)}, ` +
        `${arr(a.muscles)}, ${a.sets_per_30min}, ${a.quick}, ${a.fixed}, ${a.free_activity}, ` +
        `${a.leg_loading}, ${a.hard_legs}, ${a.sort_order})`,
    )
    .join(',\n')
  return {
    file,
    sql:
      base.sql +
      `\n-- Técnica de los ejercicios nuevos (0026 solo cubre los anteriores).\n` +
      techniqueUpdate(ownTechnique) +
      `\n-- Tipos de actividad globales. Ajustables: la app lee esta tabla (y usa el JSON sin conexión).\n` +
      `insert into public.activity_types (\n  id, owner_id, name, emoji, exercise_id, location, muscles, sets_per_30min, quick, fixed,\n  free_activity, leg_loading, hard_legs, sort_order\n) values\n${rows}\n` +
      `on conflict (id) do update set\n` +
      `  name = excluded.name,\n  emoji = excluded.emoji,\n  exercise_id = excluded.exercise_id,\n` +
      `  location = excluded.location,\n  muscles = excluded.muscles,\n` +
      `  sets_per_30min = excluded.sets_per_30min,\n  quick = excluded.quick,\n  fixed = excluded.fixed,\n` +
      `  free_activity = excluded.free_activity,\n  leg_loading = excluded.leg_loading,\n` +
      `  hard_legs = excluded.hard_legs,\n  sort_order = excluded.sort_order\n` +
      `where public.activity_types.owner_id is null;\n`,
  }
}

export const PLAN_TEMPLATES_JSON = 'supabase/seed/plan_templates.json'

// JSON de plantillas (generado desde scripts/plan-templates.ts; lo leen los tests y el mock E2E).
export function planTemplatesJson() {
  return (
    JSON.stringify(
      {
        _comment:
          'GENERADO por scripts/plan-templates.ts (npm run seed:sql). No editar a mano. Datos de HYROX y DEKA: src/lib/plan/competition.ts.',
        templates: buildPlanTemplates(),
      },
      null,
      2,
    ) + '\n'
  )
}

export function buildSeedFiles() {
  const muscles = JSON.parse(
    readFileSync(join(root, 'supabase/seed/muscles.json'), 'utf8'),
  ) as Muscle[]
  const { exercises } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8'),
  ) as { exercises: SeedExercise[] }

  const { objects } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/equivalences.json'), 'utf8'),
  ) as { objects: SeedObject[] }
  const places = JSON.parse(
    readFileSync(join(root, 'supabase/seed/destinations.json'), 'utf8'),
  ) as { source: string; destinations: SeedDestination[] }
  const { technique } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/exercise_technique.json'), 'utf8'),
  ) as { technique: Record<string, SeedTechnique> }
  const templates = buildPlanTemplates()
  const { activity_types: activities } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/activity_types.json'), 'utf8'),
  ) as { activity_types: SeedActivityType[] }
  const newIds = new Set(exercises.filter((e) => e.migration === '0032').map((e) => e.id))

  return [
    musclesSql(muscles),
    exercisesSql(
      '0006_seed_exercises_strength.sql',
      'Semilla: ejercicios de fuerza (CLAUDE.md §6). Requiere 0005.',
      exercises.filter((e) => e.category === 'strength' && !e.migration),
    ),
    exercisesSql(
      '0007_seed_exercises_functional_cardio.sql',
      'Semilla: ejercicios functional/Hyrox/Deka, cardio y deportes (CLAUDE.md §6). Requiere 0005.',
      exercises.filter((e) => e.category !== 'strength' && !e.migration),
    ),
    equivalencesSql(objects, places.destinations, places.source),
    exercisesSql(
      '0018_seed_exercises_phase5.sql',
      'Semilla: ejercicios añadidos en la fase 5 (zonas de DEKA). Requiere 0005.',
      exercises.filter((e) => e.migration === '0018'),
    ),
    planTemplatesSql(
      '0019_seed_plan_templates_endurance.sql',
      'Semilla: plantillas de carrera y natación (CLAUDE.md §9). Requiere 0017.',
      templates.filter((t) => t.family === 'running' || t.family === 'swimming'),
    ),
    planTemplatesSql(
      '0020_seed_plan_templates_strength_hybrid.sql',
      'Semilla: plantillas de fuerza e híbrido (CLAUDE.md §9). Requiere 0017.',
      templates.filter((t) => t.family === 'strength' || t.family === 'hybrid'),
    ),
    // 0021 (primera versión de HYROX y DEKA) queda congelada; 0022 actualiza las mismas filas.
    planTemplatesSql(
      '0022_seed_plan_templates_hyrox_deka_verified.sql',
      'Semilla: plantillas de HYROX y DEKA con los datos de competición verificados y pesos por sexo (src/lib/plan/competition.ts). Sustituye a 0021 (on conflict do update). Requiere 0017 y 0018.',
      templates.filter((t) => t.family === 'hyrox' || t.family === 'deka'),
    ),
    // 0026 cubre los ejercicios anteriores a 0032; los de 0032 llevan su técnica en 0032.
    techniqueSql(Object.fromEntries(Object.entries(technique).filter(([id]) => !newIds.has(id)))),
    activityTypesSql(
      exercises.filter((e) => e.migration === '0032'),
      technique,
      activities,
    ),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { file, sql } of buildSeedFiles()) {
    writeFileSync(join(root, 'supabase/migrations', file), sql)
    console.log(`escrito supabase/migrations/${file} (${sql.length} bytes)`)
  }
  writeFileSync(join(root, PLAN_TEMPLATES_JSON), planTemplatesJson())
  console.log(`escrito ${PLAN_TEMPLATES_JSON}`)
}
