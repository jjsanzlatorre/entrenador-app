// Grupos para filtrar la biblioteca («Máquinas de cardio», «Core», «Movilidad»…). Se derivan
// de la categoría, el material y los músculos del ejercicio (sin columna nueva en la base de
// datos), así que también valen para los ejercicios propios.
import { isCardioMachine } from './fields'
import type { Exercise } from './types'

export const EXERCISE_GROUPS = [
  'strength',
  'gym_machine',
  'cardio_machine',
  'core',
  'bodyweight',
  'kettlebell',
  'trx_bands',
  'plyometrics',
  'functional',
  'mobility',
  'cardio_sport',
] as const

export type ExerciseGroup = (typeof EXERCISE_GROUPS)[number]

export const EXERCISE_GROUP_LABELS: Record<ExerciseGroup, string> = {
  strength: 'Fuerza',
  gym_machine: 'Máquinas y poleas',
  cardio_machine: 'Máquinas de cardio',
  core: 'Core',
  bodyweight: 'Peso corporal',
  kettlebell: 'Kettlebell',
  trx_bands: 'TRX y gomas',
  plyometrics: 'Pliometría',
  functional: 'Functional',
  mobility: 'Movilidad',
  cardio_sport: 'Cardio y deportes',
}

// Saltos y lanzamientos explosivos (no hay material que los distinga).
const PLYOMETRIC_IDS = new Set([
  'box_jump',
  'box_jump_over',
  'burpee_broad_jump',
  'jump_squat',
  'broad_jump',
  'skater_jump',
  'depth_jump',
  'tuck_jump',
  'jumping_lunge',
  'plyo_push_up',
  'pogo_jumps',
  'med_ball_slam',
  'med_ball_chest_pass',
])

const BODYWEIGHT_EQUIPMENT = new Set([
  'bodyweight',
  'pullup_bar',
  'dip_bars',
  'rings',
  'parallettes',
  'bench',
  'box',
  'mat',
])

type GroupExercise = Pick<Exercise, 'id' | 'category' | 'equipment' | 'muscles'>

export function exerciseGroups(exercise: GroupExercise): ExerciseGroup[] {
  const groups: ExerciseGroup[] = []
  const machine = isCardioMachine(exercise)
  const eq = exercise.equipment
  if (exercise.category === 'strength') groups.push('strength')
  if (eq.some((e) => e === 'machine' || e === 'cable' || e === 'smith')) groups.push('gym_machine')
  if (machine) groups.push('cardio_machine')
  if (exercise.muscles.some((m) => m.muscleId === 'core' && m.role === 'primary'))
    groups.push('core')
  if (
    !machine &&
    exercise.category !== 'cardio' &&
    exercise.category !== 'sport' &&
    eq.length > 0 &&
    eq.every((e) => BODYWEIGHT_EQUIPMENT.has(e)) &&
    eq.some((e) => e !== 'bench' && e !== 'box' && e !== 'mat')
  )
    groups.push('bodyweight')
  if (eq.includes('kettlebell')) groups.push('kettlebell')
  if (eq.includes('trx') || eq.includes('band')) groups.push('trx_bands')
  if (PLYOMETRIC_IDS.has(exercise.id)) groups.push('plyometrics')
  if (exercise.category === 'functional' && !machine) groups.push('functional')
  if (exercise.category === 'mobility') groups.push('mobility')
  if ((exercise.category === 'cardio' || exercise.category === 'sport') && !machine)
    groups.push('cardio_sport')
  return groups
}
