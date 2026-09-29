import { normalizeSessionType } from '@/lib/activities/catalog'
import type { ExerciseSetRow, Json, SessionBlockRow, WorkoutSessionRow } from '@/types/database'
import type {
  BlockExercise,
  BlockResult,
  BlockSettings,
  LocalBlock,
  LocalSession,
  SetEntry,
} from './types'

// Las claves de config/result se guardan en snake_case en la base de datos.
function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function mapKeys(value: unknown, fn: (key: string) => string): Json {
  if (Array.isArray(value)) return value.map((v) => mapKeys(v, fn))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [fn(k), mapKeys(v, fn)]),
    )
  }
  return (value ?? null) as Json
}

export const toSnake = (value: unknown) => mapKeys(value, snakeKey)
export const toCamel = (value: unknown) => mapKeys(value, camelKey)

// Formato que espera save_workout_session(payload) (supabase/migrations/0004_workouts.sql).
export function toPayload(session: LocalSession) {
  return {
    session: {
      id: session.id,
      planned_session_id: session.plannedSessionId ?? null,
      // Copias locales anteriores a 0031 pueden traer padel_fronton.
      session_type: normalizeSessionType(session.sessionType),
      activity_type_id: session.sessionType === 'custom' ? (session.activityTypeId ?? null) : null,
      title: session.title.trim() || null,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      duration_min: session.durationMin,
      rpe: session.rpe,
      distance_m: session.distanceM ?? null,
      avg_hr: session.avgHr,
      max_hr: session.maxHr,
      calories: session.calories,
      location: session.location,
      notes: session.notes?.trim() || null,
      pair_group_id: session.pairGroupId ?? null,
      client_rev: session.rev,
    },
    blocks: session.blocks.map((b) => ({
      id: b.id,
      order: b.order,
      block_type: b.blockType,
      config: {
        exercises: b.exercises.map((e) => ({
          exercise_id: e.exerciseId,
          rest_s: e.restS,
          ...(e.targetReps !== undefined ? { target_reps: e.targetReps } : {}),
        })),
        ...(b.settings ? { settings: toSnake(b.settings) } : {}),
      },
      result: b.result ? toSnake(b.result) : null,
    })),
    sets: session.blocks.flatMap((b) =>
      b.sets.map((s) => ({
        id: s.id,
        block_id: b.id,
        exercise_id: s.exerciseId,
        set_index: s.setIndex,
        is_warmup: s.isWarmup,
        weight_kg: s.weightKg,
        reps: s.reps,
        rir: s.rir,
        duration_s: s.durationS,
        distance_m: s.distanceM,
        calories: s.calories,
        completed: s.completed,
        completed_at: s.completedAt,
      })),
    ),
  } satisfies Record<string, Json>
}

export type SessionPayload = ReturnType<typeof toPayload>

function num(value: number | string | null) {
  return value === null ? null : Number(value)
}

function isObject(value: unknown): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function blockExercises(config: Json, sets: ExerciseSetRow[]): BlockExercise[] {
  const fromConfig: BlockExercise[] =
    isObject(config) && Array.isArray(config.exercises)
      ? config.exercises.flatMap((e) =>
          isObject(e) && typeof e.exercise_id === 'string'
            ? [
                {
                  exerciseId: e.exercise_id,
                  restS: typeof e.rest_s === 'number' ? e.rest_s : 90,
                  ...(e.target_reps !== undefined
                    ? { targetReps: typeof e.target_reps === 'number' ? e.target_reps : null }
                    : {}),
                },
              ]
            : [],
        )
      : []
  // Si la config no trae ejercicios, se deducen de las series.
  const seen = new Set(fromConfig.map((e) => e.exerciseId))
  for (const s of sets) {
    if (!seen.has(s.exercise_id)) {
      seen.add(s.exercise_id)
      fromConfig.push({ exerciseId: s.exercise_id, restS: 90 })
    }
  }
  return fromConfig
}

// En EMOM y Tabata las series van por minuto/ronda (rotando ejercicios).
const ROUND_ORDERED = new Set(['emom', 'tabata'])

// Reconstruye una sesión local desde las filas del servidor (para ver o editar).
export function fromServerRows(
  session: WorkoutSessionRow,
  blocks: SessionBlockRow[],
  sets: ExerciseSetRow[],
  mode: LocalSession['mode'] = 'edit',
): LocalSession {
  const localBlocks: LocalBlock[] = [...blocks]
    .sort((a, b) => a.order - b.order)
    .map((b, i) => {
      const own = sets.filter((s) => s.block_id === b.id).sort((x, y) => x.set_index - y.set_index)
      const exercises = blockExercises(b.config, own)
      const order = new Map(exercises.map((e, idx) => [e.exerciseId, idx]))
      const blockType =
        b.block_type === 'straight' || b.block_type === 'superset'
          ? exercises.length > 1
            ? 'superset'
            : 'straight'
          : b.block_type
      const settings =
        isObject(b.config) && isObject(b.config.settings)
          ? (toCamel(b.config.settings) as BlockSettings)
          : null
      const byRound = ROUND_ORDERED.has(blockType)
      const block: LocalBlock = {
        id: b.id,
        order: i,
        blockType,
        exercises,
        sets: own
          .sort((x, y) => {
            const ex = (order.get(x.exercise_id) ?? 0) - (order.get(y.exercise_id) ?? 0)
            return byRound ? x.set_index - y.set_index || ex : ex || x.set_index - y.set_index
          })
          .map((s): SetEntry => ({
            id: s.id,
            exerciseId: s.exercise_id,
            setIndex: s.set_index,
            isWarmup: s.is_warmup,
            weightKg: num(s.weight_kg),
            reps: s.reps,
            rir: s.rir,
            durationS: s.duration_s,
            distanceM: num(s.distance_m),
            calories: s.calories,
            completed: s.completed,
            completedAt: s.completed_at,
          })),
      }
      if (settings) block.settings = settings
      if (b.result) block.result = toCamel(b.result) as BlockResult
      return block
    })

  return {
    id: session.id,
    userId: session.user_id,
    mode,
    sessionType: normalizeSessionType(session.session_type),
    activityTypeId: session.activity_type_id ?? null,
    title: session.title ?? '',
    startedAt: session.started_at,
    endedAt: session.ended_at,
    durationMin: session.duration_min,
    rpe: session.rpe,
    avgHr: session.avg_hr,
    maxHr: session.max_hr,
    calories: session.calories,
    location: session.location,
    notes: session.notes,
    distanceM: num(session.distance_m),
    plannedSessionId: session.planned_session_id,
    pairGroupId: session.pair_group_id,
    blocks: localBlocks,
    rest: null,
    rev: session.client_rev,
  }
}
