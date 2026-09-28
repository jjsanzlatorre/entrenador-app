import type { Exercise } from './types'

export function makeExercise(partial: Partial<Exercise> & Pick<Exercise, 'id'>): Exercise {
  return {
    name: partial.id,
    aliases: [],
    category: 'strength',
    trackingType: 'weight_reps',
    equipment: [],
    isUnilateral: false,
    isCompound: true,
    defaultRestS: 120,
    techniqueNotes: null,
    ownerId: null,
    muscles: [],
    ...partial,
  }
}

export function sequentialIds(prefix = 'id') {
  let n = 0
  return () => `${prefix}-${++n}`
}
