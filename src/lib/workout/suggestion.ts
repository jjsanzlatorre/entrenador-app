// Sugerencia de peso sin IA (CLAUDE.md §10): progresión doble sobre las últimas sesiones del
// mismo ejercicio.
// - Todas las series de trabajo con el peso más alto llegaron al techo del rango → subir.
// - No se completaron las reps (alguna por debajo del suelo del rango) → mantener; si también
//   falló la sesión anterior → bajar un 10 %.
// - RIR registrado ≥ 3 en todas las series con RIR → subir.
// - Si no, mantener y buscar el techo del rango.
// Subida: +2,5 kg en tren superior, +5 kg en tren inferior (§9).
import { formatKg } from './format'
import type { Exercise, LastPerformance } from './types'

export type RepRange = { min: number; max: number }

export type WeightSuggestion = {
  exerciseId: string
  weightKg: number
  previousKg: number
  action: 'increase' | 'keep' | 'decrease'
  reason: string
  // El usuario volvió al peso de la última vez.
  reverted?: boolean
}

// Músculos del tren inferior (§5, grupo «lower»).
export const LOWER_BODY_MUSCLES = new Set(['quads', 'glutes', 'hamstrings', 'adductors', 'calves'])

export const UPPER_INCREMENT_KG = 2.5
export const LOWER_INCREMENT_KG = 5

// «8-10» → 8–10; «12» → 12–12; «8–10» también. Sin rango válido → null.
export function parseRepRange(reps: string | null | undefined): RepRange | null {
  if (!reps) return null
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(reps)
  if (!m) return null
  const min = Number(m[1])
  const max = m[2] ? Number(m[2]) : min
  if (min < 1 || max < min) return null
  return { min, max }
}

// Sin prescripción (entreno libre): 6–10 en compuestos y 8–12 en accesorios.
export function defaultRepRange(exercise: Pick<Exercise, 'isCompound'> | undefined): RepRange {
  return exercise?.isCompound === false ? { min: 8, max: 12 } : { min: 6, max: 10 }
}

// Tren inferior si algún músculo principal es de pierna o glúteo.
export function weightIncrement(exercise: Pick<Exercise, 'muscles'> | undefined) {
  const lower = exercise?.muscles.some(
    (m) => m.role === 'primary' && LOWER_BODY_MUSCLES.has(m.muscleId),
  )
  return lower ? LOWER_INCREMENT_KG : UPPER_INCREMENT_KG
}

type PastSet = LastPerformance['sets'][number]

// Series de trabajo con el peso más alto de la sesión.
function topSets(p: LastPerformance | undefined) {
  const work = (p?.sets ?? []).filter(
    (s): s is PastSet & { weightKg: number; reps: number } =>
      !s.isWarmup && s.weightKg !== null && s.weightKg > 0 && s.reps !== null,
  )
  if (work.length === 0) return null
  const weight = Math.max(...work.map((s) => s.weightKg))
  return { weight, sets: work.filter((s) => s.weightKg === weight) }
}

const failed = (top: NonNullable<ReturnType<typeof topSets>>, range: RepRange) =>
  top.sets.some((s) => s.reps < range.min)

// Redondeo a 0,5 kg (mancuernas y discos pequeños), nunca por debajo de 0,5.
const roundKg = (kg: number) => Math.max(0.5, Math.round(kg * 2) / 2)

const kg = (n: number) => `${formatKg(n)} kg`

// history: sesiones anteriores con el ejercicio, de la más reciente a la más antigua.
export function suggestWeight(
  exerciseId: string,
  history: LastPerformance[],
  range: RepRange,
  increment: number,
): WeightSuggestion | null {
  const last = topSets(history[0])
  if (!last) return null
  const base = { exerciseId, previousKg: last.weight }
  const reps = last.sets.map((s) => s.reps)

  if (reps.every((r) => r >= range.max)) {
    return {
      ...base,
      weightKg: roundKg(last.weight + increment),
      action: 'increase',
      reason: `+${formatKg(increment)} kg: completaste ${last.sets.length}×${Math.min(...reps)} con ${kg(last.weight)} la última vez`,
    }
  }

  if (failed(last, range)) {
    const previous = topSets(history[1])
    if (previous && failed(previous, range)) {
      const weight = roundKg(last.weight * 0.9)
      return {
        ...base,
        weightKg: weight,
        action: 'decrease',
        reason: `−10 % (${kg(weight)}): no llegaste a ${range.min} reps en las dos últimas sesiones`,
      }
    }
    return {
      ...base,
      weightKg: last.weight,
      action: 'keep',
      reason: `Mantén ${kg(last.weight)}: la última vez no llegaste a ${range.min} reps en todas las series`,
    }
  }

  const rirs = last.sets.flatMap((s) => (s.rir === null ? [] : [s.rir]))
  if (rirs.length > 0 && Math.min(...rirs) >= 3) {
    return {
      ...base,
      weightKg: roundKg(last.weight + increment),
      action: 'increase',
      reason: `+${formatKg(increment)} kg: la última vez te sobraban reps (RIR ${Math.min(...rirs)})`,
    }
  }

  return {
    ...base,
    weightKg: last.weight,
    action: 'keep',
    reason: `Mantén ${kg(last.weight)} y busca ${last.sets.length}×${range.max}`,
  }
}

// Sugerencia para un ejercicio del catálogo: solo en ejercicios con peso.
export function suggestionFor(
  exercise: Pick<Exercise, 'id' | 'trackingType' | 'isCompound' | 'muscles'> | undefined,
  exerciseId: string,
  history: LastPerformance[] | undefined,
  prescribedReps?: string | null,
): WeightSuggestion | null {
  if (!exercise || exercise.trackingType !== 'weight_reps' || !history?.length) return null
  const range = parseRepRange(prescribedReps) ?? defaultRepRange(exercise)
  return suggestWeight(exerciseId, history, range, weightIncrement(exercise))
}

// Historial reciente (más reciente primero, sin duplicados por fecha), como mucho `max`.
export function mergeHistory(
  a: LastPerformance[] | undefined,
  b: LastPerformance[] | undefined,
  max = 2,
): LastPerformance[] {
  const byEnd = new Map<string, LastPerformance>()
  for (const p of [...(a ?? []), ...(b ?? [])]) if (!byEnd.has(p.endedAt)) byEnd.set(p.endedAt, p)
  return [...byEnd.values()].sort((x, y) => y.endedAt.localeCompare(x.endedAt)).slice(0, max)
}
