import type { ExerciseCategory, TrackingType } from '@/types/database'
import type { SetEntry } from './types'

export type SetField = 'weightKg' | 'reps' | 'durationS' | 'distanceM' | 'calories'

// Campos que se registran en cada serie según el tipo de seguimiento del ejercicio.
export function setFields(trackingType: TrackingType, category?: ExerciseCategory): SetField[] {
  switch (trackingType) {
    case 'weight_reps':
      return ['weightKg', 'reps']
    case 'reps':
      return ['reps']
    case 'time':
      return ['durationS']
    case 'distance_time':
      // Trineo, farmers, sandbag…: el peso también importa.
      return category === 'functional'
        ? ['weightKg', 'distanceM', 'durationS']
        : ['distanceM', 'durationS']
    case 'calories':
      return ['calories', 'durationS']
    case 'duration_only':
      return ['durationS']
  }
}

export const FIELD_STEP: Record<SetField, number> = {
  weightKg: 2.5,
  reps: 1,
  durationS: 15,
  distanceM: 25,
  calories: 1,
}

export const FIELD_UNIT: Record<SetField, string> = {
  weightKg: 'kg',
  reps: 'reps',
  durationS: 'tiempo',
  distanceM: 'm',
  calories: 'kcal',
}

export function stepField(value: number | null, field: SetField, direction: 1 | -1) {
  const next = (value ?? 0) + FIELD_STEP[field] * direction
  const rounded = field === 'weightKg' ? Math.round(next * 100) / 100 : Math.round(next)
  return Math.max(0, rounded)
}

export function fieldValue(set: Pick<SetEntry, SetField>, field: SetField) {
  return set[field]
}
