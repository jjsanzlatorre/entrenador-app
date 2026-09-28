// Series por sesión para las gráficas de un ejercicio.
// Fuerza: 1RM estimado, peso máximo y volumen. Cardio: distancia y ritmo (o velocidad en bici).
import { estimateOneRepMax } from '@/lib/workout/calc'
import { kmPerHour, secondsPer100m, secondsPerKm, type PaceKind } from '@/lib/workout/pace'

export type ExerciseSetSample = {
  sessionId: string
  endedAt: string
  isWarmup: boolean
  completed: boolean
  weightKg: number | null
  reps: number | null
  durationS: number | null
  distanceM: number | null
}

export type ExercisePoint = {
  sessionId: string
  endedAt: string
  est1rm: number | null
  maxWeight: number | null
  volume: number
  reps: number
  distanceM: number | null
  durationS: number | null
  // s/km (carrera), s/100 m (natación) o km/h (bici).
  pace: number | null
}

export function exerciseSeries(
  samples: ExerciseSetSample[],
  paceKind: PaceKind | null,
): ExercisePoint[] {
  const bySession = new Map<string, ExerciseSetSample[]>()
  for (const s of samples) {
    if (!s.completed || s.isWarmup) continue
    const list = bySession.get(s.sessionId) ?? []
    list.push(s)
    bySession.set(s.sessionId, list)
  }
  const points: ExercisePoint[] = []
  for (const [sessionId, sets] of bySession) {
    let est1rm: number | null = null
    let maxWeight: number | null = null
    let volume = 0
    let reps = 0
    let distance = 0
    let movingM = 0
    let movingS = 0
    for (const s of sets) {
      const e = estimateOneRepMax(s)
      if (e !== null) est1rm = Math.max(est1rm ?? 0, e)
      if (s.weightKg && s.reps) {
        maxWeight = Math.max(maxWeight ?? 0, s.weightKg)
        volume += s.weightKg * s.reps
      }
      reps += s.reps ?? 0
      distance += s.distanceM ?? 0
      // Ritmo sobre las series con distancia y tiempo (sin recuperaciones).
      if (s.distanceM && s.durationS) {
        movingM += s.distanceM
        movingS += s.durationS
      }
    }
    let pace: number | null = null
    if (paceKind && movingM > 0) {
      pace =
        paceKind === 'run'
          ? secondsPerKm(movingM, movingS)
          : paceKind === 'swim'
            ? secondsPer100m(movingM, movingS)
            : kmPerHour(movingM, movingS)
      if (pace !== null) pace = Math.round(pace * 10) / 10
    }
    points.push({
      sessionId,
      endedAt: sets[0]!.endedAt,
      est1rm,
      maxWeight,
      volume,
      reps,
      distanceM: distance > 0 ? distance : null,
      durationS: movingS > 0 ? movingS : null,
      pace,
    })
  }
  return points.sort((a, b) => a.endedAt.localeCompare(b.endedAt))
}
