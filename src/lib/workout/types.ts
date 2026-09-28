import type {
  ExerciseCategory,
  MuscleRole,
  SessionLocation,
  SessionType,
  TrackingType,
} from '@/types/database'

// Ejercicio del catálogo ya combinado con sus músculos.
export type Exercise = {
  id: string
  name: string
  aliases: string[]
  category: ExerciseCategory
  trackingType: TrackingType
  equipment: string[]
  isUnilateral: boolean
  isCompound: boolean
  defaultRestS: number
  techniqueNotes: string | null
  ownerId: string | null
  muscles: { muscleId: string; role: MuscleRole }[]
}

export type SetEntry = {
  id: string
  exerciseId: string
  setIndex: number
  isWarmup: boolean
  weightKg: number | null
  reps: number | null
  rir: number | null
  durationS: number | null
  distanceM: number | null
  calories: number | null
  completed: boolean
  completedAt: string | null
}

export type BlockExercise = { exerciseId: string; restS: number }

export type LocalBlock = {
  id: string
  order: number
  blockType: 'straight' | 'superset'
  exercises: BlockExercise[]
  sets: SetEntry[]
}

export type RestTimer = {
  startedAt: number
  endsAt: number
  exerciseId: string
  // Si está en pausa, milisegundos que quedaban al pausar.
  pausedRemainingMs: number | null
}

// Sesión tal y como vive en el dispositivo (IndexedDB) mientras se registra o edita.
export type LocalSession = {
  id: string
  userId: string
  mode: 'live' | 'edit'
  sessionType: SessionType
  title: string
  startedAt: string
  endedAt: string | null
  durationMin: number | null
  rpe: number | null
  avgHr: number | null
  maxHr: number | null
  calories: number | null
  location: SessionLocation | null
  notes: string | null
  blocks: LocalBlock[]
  rest: RestTimer | null
  // Versión creciente para que el servidor descarte copias antiguas.
  rev: number
}

// Series de la última vez para un ejercicio.
export type LastPerformance = {
  exerciseId: string
  endedAt: string
  sets: Pick<
    SetEntry,
    'setIndex' | 'isWarmup' | 'weightKg' | 'reps' | 'rir' | 'durationS' | 'distanceM' | 'calories'
  >[]
}
