// Récords personales: textos y selección de los vigentes (los calcula la base de datos, 0008).
import type { PrType } from '@/types/database'
import { formatClock, formatKg } from '@/lib/workout/format'
import { formatDistance, formatPaceClock, paceKindForExercise } from '@/lib/workout/pace'

export type PersonalRecord = {
  id: string
  exerciseId: string
  prType: PrType
  value: number
  unit: string
  weightKg: number | null
  previousValue: number | null
  sessionId: string
  achievedAt: string
}

export const PR_LABELS: Record<PrType, string> = {
  est_1rm: '1RM estimado',
  max_weight: 'Peso máximo',
  max_reps_at_weight: 'Reps con un peso',
  best_time: 'Mejor tiempo',
  longest_distance: 'Distancia más larga',
  best_pace: 'Mejor ritmo',
}

const ORDER: PrType[] = [
  'est_1rm',
  'max_weight',
  'max_reps_at_weight',
  'best_pace',
  'longest_distance',
  'best_time',
]

const speedFormat = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})

export function formatRecordValue(
  r: Pick<PersonalRecord, 'prType' | 'value' | 'unit' | 'weightKg' | 'exerciseId'>,
  value = r.value,
) {
  switch (r.prType) {
    case 'est_1rm':
    case 'max_weight':
      return `${formatKg(value)} kg`
    case 'max_reps_at_weight':
      return r.weightKg ? `${value} × ${formatKg(r.weightKg)} kg` : `${value} reps`
    case 'best_time':
      return formatClock(value)
    case 'longest_distance':
      return formatDistance(value, paceKindForExercise(r.exerciseId))
    case 'best_pace':
      if (paceKindForExercise(r.exerciseId) === 'bike') {
        return `${speedFormat.format(3600 / value)} km/h`
      }
      return `${formatPaceClock(value)} ${r.unit === 's/100m' ? 'min/100 m' : 'min/km'}`
  }
}

// Texto de la mejora: «antes 60 kg».
export function formatPrevious(r: PersonalRecord) {
  if (r.previousValue === null) return null
  if (r.prType === 'max_reps_at_weight') return `antes ${r.previousValue} reps`
  return `antes ${formatRecordValue(r, r.previousValue)}`
}

// Récords vigentes: el último de cada tipo; en reps con un peso, los que no ha superado
// ninguna marca posterior (≥ peso y ≥ reps), del peso más alto al más bajo.
export function currentRecords(records: PersonalRecord[]) {
  const sorted = [...records].sort((a, b) => a.achievedAt.localeCompare(b.achievedAt))
  const latest = new Map<PrType, PersonalRecord>()
  const reps: PersonalRecord[] = []
  for (const r of sorted) {
    if (r.prType === 'max_reps_at_weight') reps.push(r)
    else latest.set(r.prType, r)
  }
  const frontier = reps
    .filter(
      (r, i) =>
        !reps.some(
          (o, j) =>
            j !== i &&
            (o.weightKg ?? 0) >= (r.weightKg ?? 0) &&
            o.value >= r.value &&
            ((o.weightKg ?? 0) > (r.weightKg ?? 0) || o.value > r.value || j > i),
        ),
    )
    .sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0))
  const main = ORDER.filter((t) => t !== 'max_reps_at_weight' && latest.has(t)).map((t) =>
    latest.get(t)!,
  )
  return { main, reps: frontier }
}

// Mejoras conseguidas en una sesión (las primeras marcas no cuentan como récord).
export function sessionImprovements(records: PersonalRecord[]) {
  return records
    .filter((r) => r.previousValue !== null)
    .sort((a, b) => ORDER.indexOf(a.prType) - ORDER.indexOf(b.prType))
}
