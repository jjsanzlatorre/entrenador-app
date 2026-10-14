// Biblioteca de ejercicios semilla: supabase/seed/exercises.json (0006/0007/0018/0032, técnica
// en exercise_technique.json) + supabase/seed/exercises/*.json (desde 0036: un archivo por
// migración, con la técnica en cada ejercicio). Lo usan el generador de SQL, los tests y el mock
// de los E2E.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SeedExercise = {
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
  // Migración propia para ejercicios añadidos después de 0006/0007 (solo en exercises.json).
  migration?: string
}

export type SeedTechnique = { steps: string[]; mistakes: string[] }

export type LibraryFile = {
  // Nombre del JSON en supabase/seed/exercises/.
  source: string
  migration: string
  description: string
  exercises: (SeedExercise & { technique: SeedTechnique })[]
}

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadBaseExercises(root = defaultRoot) {
  const { exercises } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8'),
  ) as { exercises: SeedExercise[] }
  const { technique } = JSON.parse(
    readFileSync(join(root, 'supabase/seed/exercise_technique.json'), 'utf8'),
  ) as { technique: Record<string, SeedTechnique> }
  return { exercises, technique }
}

export function loadLibraryFiles(root = defaultRoot): LibraryFile[] {
  const dir = join(root, 'supabase/seed/exercises')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((source) => {
      const data = JSON.parse(readFileSync(join(dir, source), 'utf8')) as Omit<
        LibraryFile,
        'source'
      >
      return { source, ...data }
    })
}

// Todos los ejercicios globales con su técnica.
export function loadAllSeedExercises(root = defaultRoot) {
  const base = loadBaseExercises(root)
  const files = loadLibraryFiles(root)
  const exercises: SeedExercise[] = [
    ...base.exercises,
    ...files.flatMap((f) =>
      f.exercises.map((e) => {
        const { technique, ...exercise } = e
        void technique
        return exercise
      }),
    ),
  ]
  const technique: Record<string, SeedTechnique> = { ...base.technique }
  for (const f of files) for (const e of f.exercises) technique[e.id] = e.technique
  return { exercises, technique }
}
