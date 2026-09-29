// Resumen semanal y mensual: sesiones, horas, carga (sRPE) y distancia por deporte.
import { activityKey } from '@/lib/activities/catalog'
import type { SessionType } from '@/types/database'
import { sessionMinutes } from './adherence'
import { localDateKey, type DateKey } from './dates'
import type { SessionLogEntry } from './types'

export type SportSummary = {
  // Clave de actividad: tipo de sesión o id de la actividad personalizada (cada una, su fila).
  activity: string
  sessionType: SessionType
  sessions: number
  minutes: number
  load: number
  distanceM: number
}

export type PeriodSummary = {
  sessions: number
  minutes: number
  // Σ RPE × minutos (solo sesiones con RPE).
  load: number
  distanceM: number
  bySport: SportSummary[]
}

// Sesiones con inicio (día local) en [from, to].
export function periodSummary(
  sessions: SessionLogEntry[],
  from: DateKey,
  to: DateKey,
): PeriodSummary {
  const bySport = new Map<string, SportSummary>()
  const total: PeriodSummary = { sessions: 0, minutes: 0, load: 0, distanceM: 0, bySport: [] }
  for (const s of sessions) {
    const day = localDateKey(s.startedAt)
    if (day < from || day > to) continue
    const minutes = sessionMinutes(s)
    const load = s.rpe ? s.rpe * minutes : 0
    const distance = s.distanceM ?? 0
    const activity = activityKey(s)
    const sport = bySport.get(activity) ?? {
      activity,
      sessionType: s.sessionType,
      sessions: 0,
      minutes: 0,
      load: 0,
      distanceM: 0,
    }
    sport.sessions++
    sport.minutes += minutes
    sport.load += load
    sport.distanceM += distance
    bySport.set(activity, sport)
    total.sessions++
    total.minutes += minutes
    total.load += load
    total.distanceM += distance
  }
  total.bySport = [...bySport.values()].sort(
    (a, b) => b.minutes - a.minutes || a.activity.localeCompare(b.activity),
  )
  return total
}

// «1 h 25 min», «45 min»
export function formatDuration(minutes: number) {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}
