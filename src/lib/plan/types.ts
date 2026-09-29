// Formato de las plantillas y de las sesiones planificadas (CLAUDE.md §9).
// Sin imports con alias: lo usa también el script de semillas (Node).

export type PlanFamily = 'running' | 'swimming' | 'strength' | 'hyrox' | 'deka' | 'hybrid'
export type PlanLevel = 'beginner' | 'intermediate'
export type Intensity = 'easy' | 'moderate' | 'hard'
export type PlanSessionType =
  'strength' | 'functional' | 'running' | 'swimming' | 'cycling' | 'spinning' | 'yoga'

export type PlanBlockType =
  | 'straight'
  | 'superset'
  | 'circuit'
  | 'emom'
  | 'amrap'
  | 'tabata'
  | 'for_time'
  | 'intervals'
  | 'free'

// Prescripción de un ejercicio. En fuerza: series × reps (rango «8-10») con RIR y descanso.
// En cardio: series × distancia o duración con recuperación (rest_s), o un bloque continuo.
export type PlanExercise = {
  exercise_id: string
  sets?: number
  reps?: string
  rir?: number
  rest_s?: number
  distance_m?: number
  duration_s?: number
  calories?: number
  note?: string
}

export type PlanBlock = {
  block_type: PlanBlockType
  exercises: PlanExercise[]
  // EMOM / AMRAP: minutos; circuito: rondas y descanso entre rondas.
  minutes?: number
  rounds?: number
  rest_s?: number
  note?: string
}

export type PlanSession = {
  // Orden dentro de la semana (1 = primera sesión); el día real lo decide el programador.
  day_hint: number
  session_type: PlanSessionType
  title: string
  intensity: Intensity
  // Pierna pesada: no se pone el día antes de frontón o surf.
  heavy_legs: boolean
  duration_min: number
  notes?: string
  blocks: PlanBlock[]
}

export type PlanWeek = { week: number; deload: boolean; sessions: PlanSession[] }

export type PlanStructure = { weeks: PlanWeek[]; progression_rules: string }

export type PlanTemplate = {
  id: string
  family: PlanFamily
  name: string
  level: PlanLevel
  weeks: number
  days_per_week: number
  description: string
  structure: PlanStructure
}
