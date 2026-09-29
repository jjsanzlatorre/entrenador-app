import type { ExerciseCategory, TrackingType } from '@/types/database'
import musclesSeed from '../../../supabase/seed/muscles.json'

export const MUSCLES = musclesSeed as { id: string; name: string; view: string; group: string }[]

const muscleNames = new Map(MUSCLES.map((m) => [m.id, m.name]))
export function muscleName(id: string) {
  return muscleNames.get(id) ?? id
}

export const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barra',
  dumbbell: 'Mancuernas',
  kettlebell: 'Kettlebell',
  machine: 'Máquina',
  cable: 'Polea',
  bodyweight: 'Peso corporal',
  pullup_bar: 'Barra de dominadas',
  dip_bars: 'Paralelas',
  bench: 'Banco',
  rack: 'Rack',
  box: 'Cajón',
  band: 'Goma',
  ab_wheel: 'Rueda abdominal',
  sled: 'Trineo',
  sandbag: 'Saco',
  medball: 'Balón medicinal',
  deadball: 'Dead ball',
  skierg: 'SkiErg',
  rower: 'Remo ergómetro',
  air_bike: 'Air bike',
  jump_rope: 'Comba',
  bike: 'Bici',
  pool: 'Piscina',
  mat: 'Esterilla',
  board: 'Tabla',
  ram: 'RAM',
  tank: 'Tank (trineo)',
}

export function equipmentLabel(id: string) {
  return EQUIPMENT_LABELS[id] ?? id
}

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: 'Fuerza',
  functional: 'Functional',
  cardio: 'Cardio',
  mobility: 'Movilidad',
  sport: 'Deporte',
}

export const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Peso y repeticiones',
  reps: 'Repeticiones',
  time: 'Tiempo',
  distance_time: 'Distancia y tiempo',
  calories: 'Calorías',
  duration_only: 'Solo duración',
}
