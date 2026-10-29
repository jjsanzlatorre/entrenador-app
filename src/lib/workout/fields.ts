import type { ExerciseCategory, TrackingType } from '@/types/database'
import {
  describeDistance,
  type DistanceUnit,
  type DurationUnit,
  type QuantityKind,
} from '@/lib/input/quantity'
import { formatClock, formatKg } from './format'
import type { SetEntry } from './types'

export type SetField = 'weightKg' | 'reps' | 'durationS' | 'distanceM' | 'calories'

// Lo que hace falta del ejercicio para saber qué campos y unidades tiene una serie.
export type FieldExercise = {
  id: string
  trackingType: TrackingType
  category: ExerciseCategory
  equipment: string[]
}

// Material de las máquinas de cardio (sus series no llevan peso).
export const CARDIO_MACHINE_EQUIPMENT = [
  'skierg',
  'rower',
  'air_bike',
  'echo_bike',
  'bike_erg',
  'stationary_bike',
  'treadmill',
  'elliptical',
  'stair_climber',
  'versaclimber',
] as const

const CARDIO_MACHINES = new Set<string>(CARDIO_MACHINE_EQUIPMENT)

export function isCardioMachine(exercise: Pick<FieldExercise, 'equipment'>) {
  return exercise.equipment.some((e) => CARDIO_MACHINES.has(e))
}

// Campos por máquina: lo que muestra su pantalla (distancia, tiempo y/o calorías).
const MACHINE_FIELDS: [string, SetField[]][] = [
  ['air_bike', ['calories', 'durationS', 'distanceM']],
  ['echo_bike', ['calories', 'durationS', 'distanceM']],
  ['stair_climber', ['durationS', 'calories']],
  ['versaclimber', ['durationS', 'calories']],
  ['elliptical', ['durationS', 'distanceM', 'calories']],
  ['stationary_bike', ['durationS', 'distanceM', 'calories']],
  ['bike_erg', ['distanceM', 'durationS', 'calories']],
  ['treadmill', ['distanceM', 'durationS', 'calories']],
  ['skierg', ['distanceM', 'durationS', 'calories']],
  ['rower', ['distanceM', 'durationS', 'calories']],
]

const LOADED_EQUIPMENT = new Set([
  'kettlebell',
  'dumbbell',
  'barbell',
  'plate',
  'trap_bar',
  'sandbag',
])

// Campos que se registran en cada serie según el tipo de seguimiento del ejercicio.
export function setFields(exercise: FieldExercise | undefined): SetField[] {
  if (!exercise) return ['weightKg', 'reps']
  if (isCardioMachine(exercise)) {
    const found = MACHINE_FIELDS.find(([eq]) => exercise.equipment.includes(eq))
    if (found) return found[1]
  }
  switch (exercise.trackingType) {
    case 'weight_reps':
      return ['weightKg', 'reps']
    case 'reps':
      return ['reps']
    case 'time':
      // Isométricos con carga (farmer hold, pinza con discos): también el peso.
      return exercise.equipment.some((e) => LOADED_EQUIPMENT.has(e))
        ? ['weightKg', 'durationS']
        : ['durationS']
    case 'distance_time':
      // Trineo, farmers, sandbag…: el peso también importa.
      return exercise.category === 'functional'
        ? ['weightKg', 'distanceM', 'durationS']
        : ['distanceM', 'durationS']
    case 'calories':
      return ['calories', 'durationS']
    case 'duration_only':
      return ['durationS']
  }
}

// En km: carrera, bici y máquinas «de calle» (cinta, elíptica, bici estática).
const KM_EXERCISES = new Set(['run', 'bike', 'spinning'])
const KM_EQUIPMENT = new Set(['treadmill', 'elliptical', 'stationary_bike', 'bike_erg', 'bike'])

export function distanceUnit(exercise: FieldExercise | undefined): DistanceUnit {
  if (!exercise) return 'm'
  if (KM_EXERCISES.has(exercise.id)) return 'km'
  if (exercise.equipment.some((e) => KM_EQUIPMENT.has(e))) return 'km'
  return 'm'
}

// Número suelto de un tiempo: segundos en isométricos, trineos y estaciones; minutos en
// carrera, natación, bici, máquinas de cardio y actividades por duración.
export function durationUnit(exercise: FieldExercise | undefined): DurationUnit {
  if (!exercise) return 's'
  if (exercise.trackingType === 'time') return 's'
  if (isCardioMachine(exercise)) return 'min'
  if (exercise.trackingType === 'duration_only') return 'min'
  if (exercise.category === 'cardio' || exercise.category === 'sport') return 'min'
  return 's'
}

export type FieldSpec = {
  field: SetField
  quantity: QuantityKind
  // Unidad visible junto al campo.
  unit: string
  // Paso de los botones ± (en la unidad del campo).
  step: number
  label: string
  // Texto tras la unidad en la celda («/lado» en los ejercicios «cada lado»).
  suffix?: string
}

export function fieldSpec(field: SetField, exercise: FieldExercise | undefined): FieldSpec {
  switch (field) {
    case 'weightKg':
      return { field, quantity: { kind: 'weight' }, unit: 'kg', step: 2.5, label: 'Peso (kg)' }
    case 'reps':
      return { field, quantity: { kind: 'count' }, unit: 'reps', step: 1, label: 'Repeticiones' }
    case 'calories':
      return {
        field,
        quantity: { kind: 'count', unit: 'kcal' },
        unit: 'kcal',
        step: 5,
        label: 'Calorías',
      }
    case 'durationS': {
      const bare = durationUnit(exercise)
      return {
        field,
        quantity: { kind: 'duration', bare },
        unit: bare,
        step: bare === 'min' ? 1 : 5,
        label: `Tiempo (${bare})`,
      }
    }
    case 'distanceM': {
      const bare = distanceUnit(exercise)
      return {
        field,
        quantity: { kind: 'distance', bare },
        unit: bare,
        step: bare === 'km' ? 0.5 : 25,
        label: `Distancia (${bare})`,
      }
    }
  }
}

// perSide: reps y tiempo son por lado («45 s/lado»).
export function fieldSpecs(exercise: FieldExercise | undefined, perSide = false) {
  return setFields(exercise).map((f) => {
    const spec = fieldSpec(f, exercise)
    return perSide && (f === 'reps' || f === 'durationS') ? { ...spec, suffix: '/lado' } : spec
  })
}

// Valor de la serie para mostrar en la celda (sin unidad: va debajo).
export function displayFieldValue(spec: FieldSpec, value: number | null) {
  if (value === null) return '—'
  switch (spec.field) {
    case 'durationS':
      return formatClock(value)
    case 'weightKg':
      return formatKg(value)
    case 'distanceM':
      return spec.unit === 'km' ? formatKg(value / 1000) : formatKg(value)
    default:
      return String(value)
  }
}

// Texto de una serie con unidades («62,5 kg × 8 reps», «5 km × 25:30»).
export function formatSetValues(
  set: Pick<SetEntry, SetField>,
  exercise: FieldExercise | undefined,
) {
  return fieldSpecs(exercise)
    .map((spec) => {
      const v = set[spec.field]
      if (v === null) return '—'
      if (spec.field === 'weightKg') return `${formatKg(v)} kg`
      if (spec.field === 'reps') return `${v} reps`
      if (spec.field === 'durationS') return formatClock(v)
      if (spec.field === 'distanceM') return describeDistance(v, distanceUnit(exercise))
      return `${v} kcal`
    })
    .join(' × ')
}

export function fieldValue(set: Pick<SetEntry, SetField>, field: SetField) {
  return set[field]
}
