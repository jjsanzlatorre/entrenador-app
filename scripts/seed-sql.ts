// Genera las migraciones de semilla (SQL idempotente) a partir de supabase/seed/*.json.
// Uso: npm run seed:sql
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

export function buildSeedFiles() {
  const muscles = JSON.parse(
    readFileSync(join(root, 'supabase/seed/muscles.json'), 'utf8'),
  ) as Muscle[]
  const { exercises } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8'),
  ) as { exercises: SeedExercise[] }

  return [
    musclesSql(muscles),
    exercisesSql(
      '0006_seed_exercises_strength.sql',
      'Semilla: ejercicios de fuerza (CLAUDE.md §6). Requiere 0005.',
      exercises.filter((e) => e.category === 'strength'),
    ),
    exercisesSql(
      '0007_seed_exercises_functional_cardio.sql',
      'Semilla: ejercicios functional/Hyrox/Deka, cardio y deportes (CLAUDE.md §6). Requiere 0005.',
      exercises.filter((e) => e.category !== 'strength'),
    ),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { file, sql } of buildSeedFiles()) {
    writeFileSync(join(root, 'supabase/migrations', file), sql)
    console.log(`escrito supabase/migrations/${file} (${sql.length} bytes)`)
  }
}
