// Ritmos (CLAUDE.md §0: min/km, min/100 m) y velocidad de bici (km/h).
import type { SessionType } from '@/types/database'

export type PaceKind = 'run' | 'swim' | 'bike'

const SWIM_EXERCISES = new Set(['swim_freestyle', 'swim_backstroke', 'swim_breaststroke', 'swim_drills'])
const BIKE_EXERCISES = new Set(['bike', 'spinning', 'air_bike'])

export function paceKindForExercise(exerciseId: string): PaceKind | null {
  if (exerciseId === 'run') return 'run'
  if (SWIM_EXERCISES.has(exerciseId)) return 'swim'
  if (BIKE_EXERCISES.has(exerciseId)) return 'bike'
  return null
}

export function paceKindForSession(sessionType: SessionType): PaceKind | null {
  if (sessionType === 'running') return 'run'
  if (sessionType === 'swimming') return 'swim'
  if (sessionType === 'cycling' || sessionType === 'spinning') return 'bike'
  return null
}

// Segundos por km (carrera).
export function secondsPerKm(distanceM: number, durationS: number) {
  if (distanceM <= 0 || durationS <= 0) return null
  return durationS / (distanceM / 1000)
}

// Segundos por 100 m (natación).
export function secondsPer100m(distanceM: number, durationS: number) {
  if (distanceM <= 0 || durationS <= 0) return null
  return durationS / (distanceM / 100)
}

// Kilómetros por hora (bici).
export function kmPerHour(distanceM: number, durationS: number) {
  if (distanceM <= 0 || durationS <= 0) return null
  return distanceM / 1000 / (durationS / 3600)
}

// «4:05» (redondeo al segundo).
export function formatPaceClock(seconds: number) {
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const speedFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

// Texto listo para la UI: «4:05 min/km», «1:52 min/100 m» o «28,4 km/h».
export function formatPace(kind: PaceKind, distanceM: number | null, durationS: number | null) {
  if (!distanceM || !durationS) return null
  if (kind === 'run') {
    const v = secondsPerKm(distanceM, durationS)
    return v === null ? null : `${formatPaceClock(v)} min/km`
  }
  if (kind === 'swim') {
    const v = secondsPer100m(distanceM, durationS)
    return v === null ? null : `${formatPaceClock(v)} min/100 m`
  }
  const v = kmPerHour(distanceM, durationS)
  return v === null ? null : `${speedFormat.format(v)} km/h`
}

const kmFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

// «5,2 km» o «800 m» (natación siempre en metros).
export function formatDistance(distanceM: number, kind: PaceKind | null = null) {
  if (kind === 'swim' || distanceM < 1000) return `${Math.round(distanceM)} m`
  return `${kmFormat.format(distanceM / 1000)} km`
}
