import type { SessionType } from '@/types/database'
import type { DateKey } from './dates'

// Sesión terminada, solo con lo necesario para resúmenes y cumplimiento.
export type SessionLogEntry = {
  id: string
  sessionType: SessionType
  startedAt: string
  endedAt: string
  durationMin: number | null
  rpe: number | null
  distanceM: number | null
  // Fuerza (session_totals en el servidor; calculado en el cliente si está pendiente de subir).
  tonnageKg?: number
  totalReps?: number
}

// Día con actividad de un tipo. minutes = null cuando no se conoce (datos de la pareja,
// que ya llegan filtrados por el servidor: sesiones de ≥ 15 min).
export type ActivityDay = { day: DateKey; sessionType: SessionType; minutes: number | null }

export type Commitment = {
  validFrom: DateKey
  validTo: DateKey | null
  sessionsPerWeek: number
  minutesPerWeek: number | null
  byType: Partial<Record<SessionType, number>> | null
  countsFreeActivities: boolean
}
