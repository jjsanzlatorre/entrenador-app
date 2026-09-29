// Convierte una sesión planificada (prescripción §9) en una sesión local lista para registrar,
// enlazada con la planificada (plannedSessionId). Pesos: los de la última vez (la sugerencia de
// peso con progresión doble llega en la fase 5B).
import { createSession, type IdFn } from '@/lib/workout/session-ops'
import { addCircuitBlock, addTimedBlock } from '@/lib/workout/timed-blocks'
import type { SessionLocation, SessionType } from '@/types/database'
import type {
  Exercise,
  LastPerformance,
  LocalBlock,
  LocalSession,
  SetEntry,
} from '@/lib/workout/types'
import type { PlanBlock, PlanExercise } from './types'

const LOCATION: Partial<Record<SessionType, SessionLocation>> = {
  running: 'outdoor',
  swimming: 'pool',
  cycling: 'outdoor',
  yoga: 'home',
}

// «8-10» → 8 (se empieza por el suelo del rango); «12» → 12.
export function lowerReps(reps: string | undefined) {
  if (!reps) return null
  const n = Number.parseInt(reps, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type PlannedLike = {
  id: string
  session_type: SessionType
  title: string
  blocks: PlanBlock[]
}

type Catalog = Map<string, Pick<Exercise, 'id' | 'defaultRestS' | 'trackingType'>>

function lastWorkWeight(last: LastPerformance | undefined) {
  const work = last?.sets.filter((s) => !s.isWarmup && s.weightKg) ?? []
  return work.at(-1)?.weightKg ?? null
}

function straightSets(
  e: PlanExercise,
  catalog: Catalog,
  last: LastPerformance | undefined,
  newId: IdFn,
): SetEntry[] {
  const count = e.sets ?? 3
  const tracking = catalog.get(e.exercise_id)?.trackingType
  const weight = tracking === 'weight_reps' ? lastWorkWeight(last) : null
  return Array.from({ length: count }, (_, i) => ({
    id: newId(),
    exerciseId: e.exercise_id,
    setIndex: i,
    isWarmup: false,
    weightKg: weight,
    reps: lowerReps(e.reps),
    rir: null,
    durationS: e.duration_s ?? null,
    distanceM: e.distance_m ?? null,
    calories: e.calories ?? null,
    completed: false,
    completedAt: null,
  }))
}

export function plannedToLocalSession(
  planned: PlannedLike,
  userId: string,
  catalog: Catalog,
  lastByExercise: Map<string, LastPerformance>,
  now: number,
  newId: IdFn = () => crypto.randomUUID(),
): LocalSession {
  let session: LocalSession = {
    ...createSession(
      userId,
      now,
      newId,
      planned.title,
      planned.session_type,
      LOCATION[planned.session_type] ?? 'gym',
    ),
    plannedSessionId: planned.id,
  }
  const ref = (id: string) => catalog.get(id) ?? { id, defaultRestS: 90 }

  for (const b of planned.blocks) {
    const first = b.exercises[0]
    if (!first) continue
    switch (b.block_type) {
      case 'straight':
      case 'superset': {
        const block: LocalBlock = {
          id: newId(),
          order: session.blocks.length,
          blockType: b.exercises.length > 1 ? 'superset' : 'straight',
          exercises: b.exercises.map((e) => ({
            exerciseId: e.exercise_id,
            restS: e.rest_s ?? ref(e.exercise_id).defaultRestS,
          })),
          sets: b.exercises.flatMap((e) =>
            straightSets(e, catalog, lastByExercise.get(e.exercise_id), newId),
          ),
        }
        session = { ...session, blocks: [...session.blocks, block] }
        break
      }
      case 'intervals':
        session = addTimedBlock(
          session,
          {
            kind: 'intervals',
            reps: first.sets ?? 1,
            workDistanceM: first.distance_m ?? null,
            workS: first.distance_m ? null : (first.duration_s ?? 60),
            recoveryS: first.rest_s ?? 60,
          },
          [{ exercise: ref(first.exercise_id), targetReps: null }],
          now,
          newId,
        )
        break
      case 'free':
        for (const e of b.exercises) {
          session = addTimedBlock(
            session,
            { kind: 'free' },
            [{ exercise: ref(e.exercise_id), targetReps: null }],
            now,
            newId,
          )
        }
        break
      case 'emom':
      case 'amrap':
      case 'for_time':
      case 'tabata': {
        const minutes = b.minutes ?? 10
        const config =
          b.block_type === 'emom'
            ? { kind: 'emom' as const, minutes, intervalS: 60 }
            : b.block_type === 'amrap'
              ? { kind: 'amrap' as const, durationS: minutes * 60 }
              : b.block_type === 'tabata'
                ? { kind: 'tabata' as const, workS: 20, restS: 10, rounds: b.rounds ?? 8 }
                : { kind: 'for_time' as const, capS: b.minutes ? b.minutes * 60 : null }
        session = addTimedBlock(
          session,
          config,
          b.exercises.map((e) => ({
            exercise: ref(e.exercise_id),
            targetReps: lowerReps(e.reps),
            weightKg: lastWorkWeight(lastByExercise.get(e.exercise_id)),
          })),
          now,
          newId,
        )
        break
      }
      case 'circuit': {
        session = addCircuitBlock(
          session,
          { kind: 'circuit', rounds: b.rounds ?? 3, restBetweenRoundsS: b.rest_s ?? 90 },
          b.exercises.map((e) => ({
            exercise: ref(e.exercise_id),
            last: lastByExercise.get(e.exercise_id),
          })),
          now,
          newId,
        )
        // La prescripción manda sobre la última vez en distancia, reps y calorías.
        const block = session.blocks.at(-1)!
        const byExercise = new Map(b.exercises.map((e) => [e.exercise_id, e]))
        const sets = block.sets.map((s) => {
          const e = byExercise.get(s.exerciseId)
          if (!e) return s
          return {
            ...s,
            reps: lowerReps(e.reps) ?? s.reps,
            distanceM: e.distance_m ?? s.distanceM,
            calories: e.calories ?? s.calories,
          }
        })
        session = { ...session, blocks: [...session.blocks.slice(0, -1), { ...block, sets }] }
        break
      }
    }
  }
  return { ...session, rev: now }
}
