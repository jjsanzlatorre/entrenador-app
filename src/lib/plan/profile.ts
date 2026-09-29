// Perfil de entrenamiento (training_profiles, CLAUDE.md §4 y §11.1): lo rellena el onboarding.
// Las columnas jsonb se validan con Zod al leerlas; lo que no valide se ignora (valores por defecto).
import { z } from 'zod'
import type { Json, TrainingLevel, TrainingProfile } from '@/types/database'

export const GOALS = [
  'strength',
  'fat_loss',
  'running_event',
  'hyrox_deka',
  'swimming',
  'health',
] as const
export type Goal = (typeof GOALS)[number]

export const GOAL_LABELS: Record<Goal, { label: string; emoji: string }> = {
  strength: { label: 'Ganar fuerza', emoji: '🏋️' },
  fat_loss: { label: 'Perder grasa', emoji: '🔥' },
  running_event: { label: 'Carrera o evento', emoji: '🏃' },
  hyrox_deka: { label: 'HYROX / DEKA', emoji: '🏁' },
  swimming: { label: 'Nadar mejor', emoji: '🏊' },
  health: { label: 'Salud general', emoji: '💚' },
}

export const LEVEL_LABELS: Record<TrainingLevel, { label: string; hint: string }> = {
  beginner: { label: 'Principiante', hint: 'Menos de 1 año entrenando con regularidad' },
  intermediate: { label: 'Intermedio', hint: '1–3 años, conoces la técnica de los básicos' },
  advanced: { label: 'Avanzado', hint: 'Más de 3 años y marcas consolidadas' },
}

export const TRAINING_PLACES = ['gym', 'home', 'outdoor', 'pool'] as const
export type TrainingPlace = (typeof TRAINING_PLACES)[number]
export const PLACE_LABELS: Record<TrainingPlace, string> = {
  gym: 'Gimnasio',
  home: 'Casa',
  outdoor: 'Al aire libre',
  pool: 'Piscina',
}

// Actividades fijas: se cuentan como carga y el plan las respeta (§9).
export const FIXED_TYPES = ['padel_fronton', 'surf', 'yoga', 'other'] as const
export type FixedType = (typeof FIXED_TYPES)[number]

// 1 = lunes … 7 = domingo.
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const
export const WEEKDAY_LONG = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const

const weekday = z.number().int().min(1).max(7)

const goalsSchema = z.object({
  selected: z.array(z.enum(GOALS)).default([]),
  main: z.enum(GOALS).nullable().default(null),
})

const availabilitySchema = z.object({
  days_per_week: z.number().int().min(1).max(7).nullable().default(null),
  minutes_per_session: z.number().int().min(10).max(300).nullable().default(null),
  preferred_days: z.array(weekday).default([]),
  places: z.array(z.enum(TRAINING_PLACES)).default([]),
})

const fixedActivitySchema = z.object({
  type: z.enum(FIXED_TYPES),
  days: z.array(weekday).min(1),
  minutes: z.number().int().min(5).max(600).nullable().default(null),
  label: z.string().max(40).nullable().default(null),
})

const benchmarksSchema = z.object({
  squat_1rm_kg: z.number().positive().nullable().default(null),
  bench_1rm_kg: z.number().positive().nullable().default(null),
  deadlift_1rm_kg: z.number().positive().nullable().default(null),
  run_5k_s: z.number().int().positive().nullable().default(null),
  swim_100m_s: z.number().int().positive().nullable().default(null),
})

export type Goals = z.infer<typeof goalsSchema>
export type Availability = z.infer<typeof availabilitySchema>
export type FixedActivity = z.infer<typeof fixedActivitySchema>
export type Benchmarks = z.infer<typeof benchmarksSchema>

export type TrainingProfileData = {
  goals: Goals
  level: TrainingLevel | null
  availability: Availability
  equipment: string[]
  limitations: string | null
  fixedActivities: FixedActivity[]
  benchmarks: Benchmarks
}

export function emptyTrainingProfile(): TrainingProfileData {
  return {
    goals: goalsSchema.parse({}),
    level: null,
    availability: availabilitySchema.parse({}),
    equipment: [],
    limitations: null,
    fixedActivities: [],
    benchmarks: benchmarksSchema.parse({}),
  }
}

function safe<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value ?? {})
  return result.success ? result.data : fallback
}

export function fromRow(
  row: Pick<
    TrainingProfile,
    | 'goals'
    | 'level'
    | 'availability'
    | 'equipment'
    | 'limitations'
    | 'fixed_activities'
    | 'benchmarks'
  >,
): TrainingProfileData {
  const empty = emptyTrainingProfile()
  const fixed = Array.isArray(row.fixed_activities)
    ? row.fixed_activities.flatMap((f) => {
        const r = fixedActivitySchema.safeParse(f)
        return r.success ? [r.data] : []
      })
    : []
  return {
    goals: safe(goalsSchema, row.goals, empty.goals),
    level: row.level,
    availability: safe(availabilitySchema, row.availability, empty.availability),
    equipment: row.equipment ?? [],
    limitations: row.limitations,
    fixedActivities: fixed,
    benchmarks: safe(benchmarksSchema, row.benchmarks, empty.benchmarks),
  }
}

export function toRow(data: TrainingProfileData) {
  return {
    goals: data.goals as unknown as Json,
    level: data.level,
    availability: data.availability as unknown as Json,
    equipment: data.equipment,
    limitations: data.limitations?.trim() || null,
    fixed_activities: data.fixedActivities as unknown as Json,
    benchmarks: data.benchmarks as unknown as Json,
  }
}

// Tiempos de marcas en minutos: «25:30» → 1530 s; «28» → 28 min (a diferencia de parseClock
// del registro, donde «90» son segundos).
export function parseMinSec(input: string) {
  const m = /^\s*(\d{1,3})(?::(\d{1,2}))?\s*$/.exec(input)
  if (!m) return null
  const minutes = Number(m[1])
  const seconds = m[2] === undefined ? 0 : Number(m[2])
  if (seconds >= 60) return null
  const total = minutes * 60 + seconds
  return total > 0 ? total : null
}

export function formatClockShort(seconds: number | null) {
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
