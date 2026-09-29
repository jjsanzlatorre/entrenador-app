// Acumulados por semana, mes, año y total (CLAUDE.md §10B). Lógica pura, con tests.
import { activityKey } from '@/lib/activities/catalog'
import type { SessionType } from '@/types/database'
import { sessionMinutes } from './adherence'
import { addDays, localDateKey, monthEndOf, monthStartOf, weekStartOf, type DateKey } from './dates'
import type { SessionLogEntry } from './types'

export type PeriodKind = 'week' | 'month' | 'year' | 'total'

// key: identificador del periodo para las claves de hitos (lunes, «2026-10», «2026»); null = total.
export type Period = {
  kind: PeriodKind
  from: DateKey | null
  to: DateKey | null
  key: string | null
}

export function periodFor(kind: PeriodKind, day: DateKey): Period {
  switch (kind) {
    case 'week': {
      const from = weekStartOf(day)
      return { kind, from, to: addDays(from, 6), key: from }
    }
    case 'month':
      return { kind, from: monthStartOf(day), to: monthEndOf(day), key: day.slice(0, 7) }
    case 'year':
      return {
        kind,
        from: `${day.slice(0, 4)}-01-01`,
        to: `${day.slice(0, 4)}-12-31`,
        key: day.slice(0, 4),
      }
    case 'total':
      return { kind, from: null, to: null, key: null }
  }
}

export const PERIOD_PREFIX: Record<PeriodKind, string> = {
  week: 'Esta semana',
  month: 'Este mes',
  year: 'Este año',
  total: 'En total',
}

export type Accumulated = {
  sessions: number
  minutes: number
  // Por clave de actividad (tipo de sesión o id de la actividad personalizada).
  minutesBySport: Record<string, number>
  // Metros por deporte. Bici = bici + spinning.
  swimM: number
  runM: number
  bikeM: number
  bikeMinutes: number
  // Carrera + bici + natación.
  distM: number
  // Σ peso × reps sin calentamiento ni peso corporal (lo calcula session_totals o el cliente).
  tonnageKg: number
  reps: number
}

export const BIKE_TYPES = new Set<SessionType>(['cycling', 'spinning'])

export function emptyAccumulated(): Accumulated {
  return {
    sessions: 0,
    minutes: 0,
    minutesBySport: {},
    swimM: 0,
    runM: 0,
    bikeM: 0,
    bikeMinutes: 0,
    distM: 0,
    tonnageKg: 0,
    reps: 0,
  }
}

// Sesiones con inicio (día local) dentro del periodo.
export function accumulate(sessions: SessionLogEntry[], period?: Period): Accumulated {
  const acc = emptyAccumulated()
  for (const s of sessions) {
    if (period?.from && period.to) {
      const day = localDateKey(s.startedAt)
      if (day < period.from || day > period.to) continue
    }
    const minutes = sessionMinutes(s)
    const distance = s.distanceM ?? 0
    acc.sessions++
    acc.minutes += minutes
    // Horas por deporte: cada actividad (también las clases y las personalizadas) por separado.
    const activity = activityKey(s)
    acc.minutesBySport[activity] = (acc.minutesBySport[activity] ?? 0) + minutes
    if (s.sessionType === 'swimming') acc.swimM += distance
    if (s.sessionType === 'running') acc.runM += distance
    if (BIKE_TYPES.has(s.sessionType)) {
      acc.bikeM += distance
      acc.bikeMinutes += minutes
    }
    if (
      s.sessionType === 'swimming' ||
      s.sessionType === 'running' ||
      BIKE_TYPES.has(s.sessionType)
    ) {
      acc.distM += distance
    }
    acc.tonnageKg += s.tonnageKg ?? 0
    acc.reps += s.totalReps ?? 0
  }
  return acc
}
