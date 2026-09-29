// Entreno en pareja (§7, fase 7A): la estructura que se manda a la otra persona y cómo se
// convierte en su sesión local. Lógica pura, con tests.
//
// La plantilla lleva bloques, ejercicios globales, series con reps/tiempo/distancia objetivo y
// los ajustes de los temporizadores; nunca pesos ni notas. Cada uno registra sus propios pesos:
// al unirse, los pesos se precargan con los de SU última vez.
import { z } from 'zod'
import type { BlockType, SessionLocation, SessionType } from '@/types/database'
import { toCamel, toSnake } from '@/lib/workout/payload'
import { createSession, type IdFn } from '@/lib/workout/session-ops'
import type {
  BlockSettings,
  LastPerformance,
  LocalBlock,
  LocalSession,
  SetEntry,
} from '@/lib/workout/types'

const SESSION_TYPES = [
  'strength',
  'functional',
  'running',
  'swimming',
  'cycling',
  'spinning',
  'yoga',
  'padel_fronton',
  'surf',
  'other',
] as const satisfies readonly SessionType[]
const BLOCK_TYPES = [
  'straight',
  'superset',
  'circuit',
  'emom',
  'amrap',
  'tabata',
  'for_time',
  'intervals',
  'free',
] as const satisfies readonly BlockType[]
const LOCATIONS = [
  'gym',
  'outdoor',
  'pool',
  'home',
  'other',
] as const satisfies readonly SessionLocation[]

const optionalNumber = z.number().finite().nonnegative().nullable().optional()

export const pairTemplateSchema = z.object({
  v: z.literal(1),
  session_type: z.enum(SESSION_TYPES),
  title: z.string().max(120),
  location: z.enum(LOCATIONS).nullable(),
  blocks: z
    .array(
      z.object({
        block_type: z.enum(BLOCK_TYPES),
        settings: z.record(z.string(), z.unknown()).nullable(),
        exercises: z
          .array(
            z.object({
              exercise_id: z.string().min(1).max(80),
              rest_s: z.number().int().min(0).max(3600),
              target_reps: z.number().int().min(0).max(1000).nullable().optional(),
            }),
          )
          .max(20),
        sets: z
          .array(
            z.object({
              exercise_id: z.string().min(1).max(80),
              is_warmup: z.boolean(),
              reps: optionalNumber,
              duration_s: optionalNumber,
              distance_m: optionalNumber,
            }),
          )
          .max(200),
      }),
    )
    .max(40),
})

export type PairTemplate = z.infer<typeof pairTemplateSchema>

// Estructura de mi sesión para la otra persona. Los ejercicios propios no se mandan (la otra
// persona no los tiene en su biblioteca); `skipped` cuenta los que se han quitado.
export function pairTemplateFromSession(
  session: Pick<LocalSession, 'sessionType' | 'title' | 'location' | 'blocks'>,
  isShareable: (exerciseId: string) => boolean,
): { template: PairTemplate; skipped: number } {
  const skippedIds = new Set<string>()
  const blocks = session.blocks.flatMap((b) => {
    const exercises = b.exercises.filter((e) => {
      const ok = isShareable(e.exerciseId)
      if (!ok) skippedIds.add(e.exerciseId)
      return ok
    })
    if (exercises.length === 0) return []
    const keep = new Set(exercises.map((e) => e.exerciseId))
    return [
      {
        block_type: b.blockType,
        settings: b.settings ? (toSnake(b.settings) as Record<string, unknown>) : null,
        exercises: exercises.map((e) => ({
          exercise_id: e.exerciseId,
          rest_s: e.restS,
          ...(e.targetReps !== undefined ? { target_reps: e.targetReps } : {}),
        })),
        sets: b.sets
          .filter((s) => keep.has(s.exerciseId))
          .map((s) => ({
            exercise_id: s.exerciseId,
            is_warmup: s.isWarmup,
            reps: s.reps,
            duration_s: s.durationS,
            distance_m: s.distanceM,
          })),
      },
    ]
  })
  return {
    template: {
      v: 1,
      session_type: session.sessionType,
      title: session.title.slice(0, 120),
      location: session.location,
      blocks,
    },
    skipped: skippedIds.size,
  }
}

// Firma estable de una plantilla (claves ordenadas): la que vuelve de la base de datos (jsonb
// reordena las claves) y la calculada en el móvil coinciden si la estructura es la misma.
export function pairTemplateSignature(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, norm(x)]),
      )
    }
    return v
  }
  return JSON.stringify(norm(value))
}

export function parsePairTemplate(payload: unknown): PairTemplate | null {
  const parsed = pairTemplateSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

// Nº de ejercicios distintos de la plantilla (para la tarjeta de invitación).
export function templateExerciseCount(template: PairTemplate) {
  return new Set(template.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id))).size
}

// Sesión local de quien se une: misma estructura, mismo pair_group_id, sus propios pesos.
// Ejercicios que no conoce (p. ej. borrados de la biblioteca) se quitan.
export function sessionFromPairTemplate(
  template: PairTemplate,
  opts: {
    userId: string
    pairGroupId: string
    now?: number
    known: (exerciseId: string) => boolean
    last?: Map<string, LastPerformance>
    newId?: IdFn
  },
): LocalSession {
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const base = createSession(
    opts.userId,
    opts.now ?? Date.now(),
    newId,
    template.title || 'Entreno en pareja',
    template.session_type,
    template.location,
  )
  const blocks: LocalBlock[] = template.blocks.flatMap((b) => {
    const exercises = b.exercises.filter((e) => opts.known(e.exercise_id))
    if (exercises.length === 0) return []
    const keep = new Set(exercises.map((e) => e.exercise_id))
    const counters = new Map<string, number>()
    const sets: SetEntry[] = b.sets
      .filter((s) => keep.has(s.exercise_id))
      .map((s) => {
        const index = counters.get(s.exercise_id) ?? 0
        counters.set(s.exercise_id, index + 1)
        const mine = opts.last?.get(s.exercise_id)?.sets
        const previous = mine?.[index] ?? mine?.at(-1)
        return {
          id: newId(),
          exerciseId: s.exercise_id,
          setIndex: index,
          isWarmup: s.is_warmup,
          weightKg: previous?.weightKg ?? null,
          reps: s.reps ?? previous?.reps ?? null,
          rir: null,
          durationS: s.duration_s ?? null,
          distanceM: s.distance_m ?? null,
          calories: null,
          completed: false,
          completedAt: null,
        }
      })
    const block: LocalBlock = {
      id: newId(),
      order: 0,
      blockType: b.block_type,
      exercises: exercises.map((e) => ({
        exerciseId: e.exercise_id,
        restS: e.rest_s,
        ...(e.target_reps !== undefined ? { targetReps: e.target_reps } : {}),
      })),
      sets,
    }
    if (b.settings) block.settings = toCamel(b.settings) as BlockSettings
    return [block]
  })
  return {
    ...base,
    pairGroupId: opts.pairGroupId,
    blocks: blocks.map((b, i) => ({ ...b, order: i })),
  }
}

// ── Comparación lado a lado ─────────────────────────────────

export type PairExerciseRow = {
  exerciseId: string
  mine: { sets: number; bestKg: number | null; bestReps: number | null; tonnageKg: number }
  theirs: { sets: number; bestKg: number | null; bestReps: number | null; tonnageKg: number }
}

function exerciseStats(sets: SetEntry[]) {
  const effective = sets.filter((s) => s.completed && !s.isWarmup)
  let best: SetEntry | null = null
  for (const s of effective) {
    if (s.weightKg === null) continue
    if (
      !best ||
      s.weightKg > (best.weightKg ?? 0) ||
      (s.weightKg === best.weightKg && (s.reps ?? 0) > (best.reps ?? 0))
    )
      best = s
  }
  const bestReps = best ? best.reps : Math.max(0, ...effective.map((s) => s.reps ?? 0)) || null
  return {
    sets: effective.length,
    bestKg: best?.weightKg ?? null,
    bestReps,
    tonnageKg: effective.reduce(
      (acc, s) => acc + (s.weightKg && s.reps ? s.weightKg * s.reps : 0),
      0,
    ),
  }
}

// Ejercicios en el orden de mi sesión; después los que solo hizo la otra persona.
export function comparePairSessions(
  mine: Pick<LocalSession, 'blocks'>,
  theirs: Pick<LocalSession, 'blocks'>,
): PairExerciseRow[] {
  const order: string[] = []
  const collect = (s: Pick<LocalSession, 'blocks'>) => {
    const by = new Map<string, SetEntry[]>()
    for (const b of s.blocks)
      for (const set of b.sets) {
        if (!order.includes(set.exerciseId)) order.push(set.exerciseId)
        by.set(set.exerciseId, [...(by.get(set.exerciseId) ?? []), set])
      }
    return by
  }
  const a = collect(mine)
  const b = collect(theirs)
  return order.map((exerciseId) => ({
    exerciseId,
    mine: exerciseStats(a.get(exerciseId) ?? []),
    theirs: exerciseStats(b.get(exerciseId) ?? []),
  }))
}
