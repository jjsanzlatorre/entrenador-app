import type { ExerciseSetRow, Json, SessionBlockRow, WorkoutSessionRow } from '@/types/database'
import type { BlockExercise, LocalBlock, LocalSession, SetEntry } from './types'

// Formato que espera save_workout_session(payload) (supabase/migrations/0004_workouts.sql).
export function toPayload(session: LocalSession) {
  return {
    session: {
      id: session.id,
      session_type: session.sessionType,
      title: session.title.trim() || null,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      duration_min: session.durationMin,
      rpe: session.rpe,
      avg_hr: session.avgHr,
      max_hr: session.maxHr,
      calories: session.calories,
      location: session.location,
      notes: session.notes?.trim() || null,
      client_rev: session.rev,
    },
    blocks: session.blocks.map((b) => ({
      id: b.id,
      order: b.order,
      block_type: b.blockType,
      config: {
        exercises: b.exercises.map((e) => ({ exercise_id: e.exerciseId, rest_s: e.restS })),
      },
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

function blockExercises(config: Json, sets: ExerciseSetRow[]): BlockExercise[] {
  const fromConfig =
    config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Array.isArray(config.exercises)
      ? config.exercises.flatMap((e) =>
          e && typeof e === 'object' && !Array.isArray(e) && typeof e.exercise_id === 'string'
            ? [{ exerciseId: e.exercise_id, restS: typeof e.rest_s === 'number' ? e.rest_s : 90 }]
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
      return {
        id: b.id,
        order: i,
        blockType: exercises.length > 1 ? 'superset' : 'straight',
        exercises,
        sets: own
          .sort(
            (x, y) =>
              (order.get(x.exercise_id) ?? 0) - (order.get(y.exercise_id) ?? 0) ||
              x.set_index - y.set_index,
          )
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
    })

  return {
    id: session.id,
    userId: session.user_id,
    mode,
    sessionType: session.session_type,
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
    blocks: localBlocks,
    rest: null,
    rev: session.client_rev,
  }
}
