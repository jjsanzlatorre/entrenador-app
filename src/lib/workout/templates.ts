// «Repetir entreno» y «Mis plantillas» (usabilidad 3/3): la estructura de una sesión (bloques,
// ejercicios, series con reps/tiempo/distancia y ajustes de los temporizadores, sin pesos ni
// notas) y cómo se convierte en una sesión nueva con los pesos sugeridos (§10). Lógica pura.
//
// La estructura usa el mismo formato que el entreno en pareja (pairTemplateSchema.blocks), pero
// incluye los ejercicios propios (la plantilla es del mismo usuario).
import { z } from 'zod'
import { pairTemplateSchema } from '@/lib/partners/pair'
import type { SessionLocation, SessionType } from '@/types/database'
import { toCamel, toSnake } from './payload'
import { createSession, type IdFn } from './session-ops'
import { suggestionFor, type WeightSuggestion } from './suggestion'
import { addTimedBlock, isTimedBlock } from './timed-blocks'
import type { TimerConfig } from './timer'
import type {
  BlockSettings,
  CircuitConfig,
  Exercise,
  LastPerformance,
  LocalBlock,
  LocalSession,
  SetEntry,
} from './types'

const LOCATIONS = ['gym', 'outdoor', 'pool', 'home', 'other'] as const

export const workoutStructureSchema = z.object({
  v: z.literal(1),
  location: z.enum(LOCATIONS).nullable(),
  blocks: pairTemplateSchema.shape.blocks.min(1),
})

export type WorkoutStructure = z.infer<typeof workoutStructureSchema>
type StructureBlock = WorkoutStructure['blocks'][number]

export type WorkoutTemplate = {
  id: string
  name: string
  sessionType: SessionType
  activityTypeId: string | null
  structure: WorkoutStructure
  lastUsedAt: string | null
  updatedAt: string
}

export function parseStructure(value: unknown): WorkoutStructure | null {
  const parsed = workoutStructureSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// ¿Tiene algo que repetir? (al menos un ejercicio; las actividades rápidas no tienen bloques).
export function isRepeatable(session: Pick<LocalSession, 'blocks'>) {
  return session.blocks.some((b) => b.exercises.length > 0)
}

// Estructura de una sesión (en curso o terminada). En los bloques de series se repite lo que se
// hizo: las series completadas de cada ejercicio (si no se completó ninguna, todas). En los
// bloques con temporizador, sus ajustes y ejercicios (las series se generan al empezar).
export function structureFromSession(
  session: Pick<LocalSession, 'location' | 'blocks'>,
): WorkoutStructure | null {
  const blocks: StructureBlock[] = session.blocks.flatMap((b) => {
    if (b.exercises.length === 0) return []
    const timed = isTimedBlock(b)
    const sets = timed
      ? b.sets
      : b.exercises.flatMap((e) => {
          const own = b.sets.filter((s) => s.exerciseId === e.exerciseId)
          const done = own.filter((s) => s.completed)
          return done.length > 0 ? done : own
        })
    return [
      {
        block_type: b.blockType,
        settings: b.settings ? (toSnake(b.settings) as Record<string, unknown>) : null,
        exercises: b.exercises.slice(0, 20).map((e) => ({
          exercise_id: e.exerciseId,
          rest_s: Math.min(3600, Math.max(0, Math.round(e.restS))),
          ...(e.targetReps !== undefined ? { target_reps: e.targetReps } : {}),
          ...(e.perSide ? { per_side: true } : {}),
        })),
        sets: sets.slice(0, 200).map((s) => ({
          exercise_id: s.exerciseId,
          is_warmup: s.isWarmup,
          reps: s.reps,
          duration_s: s.durationS,
          distance_m: s.distanceM,
        })),
      },
    ]
  })
  if (blocks.length === 0) return null
  return { v: 1, location: session.location, blocks: blocks.slice(0, 40) }
}

// Ejercicios distintos de la estructura (para resúmenes y para pedir la última vez).
export function structureExerciseIds(structure: WorkoutStructure) {
  return [...new Set(structure.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id)))]
}

// «Press banca, Remo con barra y 3 más».
export function structureSummary(structure: WorkoutStructure, nameOf: (id: string) => string) {
  const names = structureExerciseIds(structure).map(nameOf)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`
}

type Catalog = Map<
  string,
  Pick<Exercise, 'id' | 'defaultRestS' | 'trackingType'> &
    Partial<Pick<Exercise, 'isCompound' | 'muscles'>>
>

function lastWorkWeight(last: LastPerformance | undefined) {
  const work = last?.sets.filter((s) => !s.isWarmup && s.weightKg) ?? []
  return work.at(-1)?.weightKg ?? null
}

function suggestion(
  exerciseId: string,
  catalog: Catalog,
  history: LastPerformance[] | undefined,
): WeightSuggestion | null {
  const ex = catalog.get(exerciseId)
  if (!ex) return null
  return suggestionFor(
    { ...ex, isCompound: ex.isCompound ?? true, muscles: ex.muscles ?? [] },
    exerciseId,
    history,
  )
}

// Sesión nueva a partir de una estructura. Pesos: la sugerencia (§10) en las series de trabajo
// de cada ejercicio con peso; si no hay sugerencia, los de la última vez. Ejercicios que ya no
// existen (borrados de la biblioteca) se quitan.
export function sessionFromStructure(
  structure: WorkoutStructure,
  opts: {
    userId: string
    title: string
    sessionType: SessionType
    activityTypeId?: string | null
    catalog: Catalog
    last?: Map<string, LastPerformance>
    history?: Map<string, LastPerformance[]>
    now?: number
    newId?: IdFn
  },
): LocalSession {
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const now = opts.now ?? Date.now()
  const last = opts.last ?? new Map<string, LastPerformance>()
  const history = opts.history ?? new Map<string, LastPerformance[]>()
  let session: LocalSession = createSession(
    opts.userId,
    now,
    newId,
    opts.title,
    opts.sessionType,
    (structure.location as SessionLocation | null) ?? 'gym',
  )
  if (opts.sessionType === 'custom' && opts.activityTypeId) {
    session = { ...session, activityTypeId: opts.activityTypeId }
  }
  const ref = (id: string) => opts.catalog.get(id) ?? { id, defaultRestS: 90 }

  for (const b of structure.blocks) {
    const exercises = b.exercises.filter((e) => opts.catalog.has(e.exercise_id))
    if (exercises.length === 0) continue
    const settings = b.settings ? (toCamel(b.settings) as BlockSettings) : null

    if (settings && isTimedBlock({ settings })) {
      session = addTimedBlock(
        session,
        settings as TimerConfig,
        exercises.map((e) => ({
          exercise: ref(e.exercise_id),
          targetReps: e.target_reps ?? null,
          weightKg: lastWorkWeight(last.get(e.exercise_id)),
        })),
        now,
        newId,
      )
      continue
    }

    // Series normales, superserie o circuito (por rondas: las series de la estructura).
    const keep = new Set(exercises.map((e) => e.exercise_id))
    const suggestions = new Map<string, WeightSuggestion>()
    for (const e of exercises) {
      const s = suggestion(e.exercise_id, opts.catalog, history.get(e.exercise_id))
      if (s) suggestions.set(e.exercise_id, s)
    }
    const counters = new Map<string, number>()
    const sets: SetEntry[] = b.sets
      .filter((s) => keep.has(s.exercise_id))
      .map((s) => {
        const index = counters.get(s.exercise_id) ?? 0
        counters.set(s.exercise_id, index + 1)
        const tracking = opts.catalog.get(s.exercise_id)?.trackingType
        const prev = last.get(s.exercise_id)?.sets
        const previous = prev?.[index] ?? prev?.at(-1)
        const suggested = suggestions.get(s.exercise_id)
        const weight =
          tracking === 'weight_reps' || tracking === 'time'
            ? !s.is_warmup && suggested
              ? suggested.weightKg
              : (previous?.weightKg ?? null)
            : null
        return {
          id: newId(),
          exerciseId: s.exercise_id,
          setIndex: index,
          isWarmup: s.is_warmup,
          weightKg: weight,
          reps: s.reps ?? null,
          rir: null,
          durationS: s.duration_s ?? null,
          distanceM: s.distance_m ?? null,
          calories: null,
          completed: false,
          completedAt: null,
        }
      })
    // Un ejercicio sin series en la estructura empieza con una.
    for (const e of exercises) {
      if (counters.has(e.exercise_id)) continue
      sets.push({
        id: newId(),
        exerciseId: e.exercise_id,
        setIndex: 0,
        isWarmup: false,
        weightKg: suggestions.get(e.exercise_id)?.weightKg ?? null,
        reps: null,
        rir: null,
        durationS: null,
        distanceM: null,
        calories: null,
        completed: false,
        completedAt: null,
      })
    }
    const block: LocalBlock = {
      id: newId(),
      order: session.blocks.length,
      blockType:
        exercises.length === 1 ? 'straight' : b.block_type === 'circuit' ? 'circuit' : 'superset',
      exercises: exercises.map((e) => {
        const s = suggestions.get(e.exercise_id)
        return {
          exerciseId: e.exercise_id,
          restS: e.rest_s,
          ...(s ? { suggestion: s } : {}),
          ...(e.per_side ? { perSide: true } : {}),
        }
      }),
      sets,
    }
    // Rondas y descanso entre ejercicios de las superseries y circuitos.
    if (exercises.length > 1 && settings?.kind === 'circuit') {
      const config = settings as CircuitConfig
      block.settings = {
        ...config,
        rounds: Math.max(0, ...[...counters.values()]) || config.rounds,
      }
    }
    session = { ...session, blocks: [...session.blocks, block] }
  }
  return session
}

// Nombre por defecto de una plantilla: el título de la sesión (sin «Entreno libre» genérico).
export function defaultTemplateName(title: string, date: Date) {
  const t = title.trim()
  if (t && t !== 'Entreno libre') return t.slice(0, 80)
  return `Entreno del ${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
}
