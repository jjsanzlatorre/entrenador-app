import type { Exercise, LocalSession, SetEntry } from './types'

// 1RM estimado (Epley): peso × (1 + reps/30), solo con reps ≤ 10 y sin calentamiento.
export function estimateOneRepMax(set: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup'>) {
  if (set.isWarmup || !set.weightKg || !set.reps || set.reps > 10) return null
  return Math.round(set.weightKg * (1 + set.reps / 30) * 10) / 10
}

// Series que cuentan: completadas y que no son de calentamiento.
export function isEffective(set: Pick<SetEntry, 'completed' | 'isWarmup'>) {
  return set.completed && !set.isWarmup
}

// Tonelaje: Σ peso × reps de series efectivas (el peso corporal no suma en la v1).
export function tonnage(sets: Pick<SetEntry, 'completed' | 'isWarmup' | 'weightKg' | 'reps'>[]) {
  return sets.reduce(
    (acc, s) => (isEffective(s) && s.weightKg && s.reps ? acc + s.weightKg * s.reps : acc),
    0,
  )
}

// Series efectivas por músculo: 1 por primario y 0,5 por secundario (CLAUDE.md §5).
export function effectiveSetsByMuscle(
  sets: Pick<SetEntry, 'completed' | 'isWarmup' | 'exerciseId'>[],
  exercises: Map<string, Pick<Exercise, 'muscles'>>,
) {
  const result = new Map<string, number>()
  for (const set of sets) {
    if (!isEffective(set)) continue
    const exercise = exercises.get(set.exerciseId)
    if (!exercise) continue
    for (const { muscleId, role } of exercise.muscles) {
      result.set(muscleId, (result.get(muscleId) ?? 0) + (role === 'primary' ? 1 : 0.5))
    }
  }
  return [...result.entries()]
    .map(([muscleId, sets]) => ({ muscleId, sets }))
    .sort((a, b) => b.sets - a.sets || a.muscleId.localeCompare(b.muscleId))
}

export function allSets(session: Pick<LocalSession, 'blocks'>) {
  return session.blocks.flatMap((b) => b.sets)
}

export function sessionStats(session: Pick<LocalSession, 'blocks'>) {
  const sets = allSets(session)
  const effective = sets.filter(isEffective)
  return {
    exercises: new Set(sets.map((s) => s.exerciseId)).size,
    completedSets: effective.length,
    totalReps: effective.reduce((acc, s) => acc + (s.reps ?? 0), 0),
    tonnageKg: tonnage(sets),
  }
}

export function elapsedMinutes(startedAt: string, now: number) {
  return Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 60000))
}
