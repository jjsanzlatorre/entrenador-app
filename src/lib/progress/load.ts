// Carga de entrenamiento (CLAUDE.md §10): sRPE = RPE × duración (min) y ratio agudo:crónico
// = carga de los últimos 7 días / media semanal de los últimos 28 días.
import { sessionMinutes } from './adherence'
import { addDays, localDateKey, type DateKey } from './dates'
import type { SessionLogEntry } from './types'

type LoadSession = Pick<SessionLogEntry, 'rpe' | 'durationMin' | 'startedAt' | 'endedAt'>

// Carga sRPE de una sesión; null si falta el RPE.
export function sessionLoad(s: LoadSession) {
  const minutes = sessionMinutes(s)
  if (!s.rpe || !minutes) return null
  return s.rpe * minutes
}

// Carga total de las sesiones entre dos días (incluidos) y cuántas no tienen RPE.
export function loadBetween(sessions: LoadSession[], from: DateKey, to: DateKey) {
  let load = 0
  let sessionsCount = 0
  let missingRpe = 0
  for (const s of sessions) {
    const day = localDateKey(s.startedAt)
    if (day < from || day > to) continue
    sessionsCount++
    const l = sessionLoad(s)
    if (l === null) missingRpe++
    else load += l
  }
  return { load, sessions: sessionsCount, missingRpe }
}

// Carga de las `count` semanas (lunes a domingo) que acaban en la de `lastWeekStart`.
export function weeklyLoads(sessions: LoadSession[], lastWeekStart: DateKey, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const weekStart = addDays(lastWeekStart, -7 * (count - 1 - i))
    return { weekStart, ...loadBetween(sessions, weekStart, addDays(weekStart, 6)) }
  })
}

export const ACWR_HIGH = 1.5
export const ACWR_LOW = 0.8

export type AcwrStatus = 'insufficient' | 'ok' | 'high' | 'low'

export type Acwr = {
  acute: number
  chronicWeekly: number
  ratio: number | null
  status: AcwrStatus
  missingRpe: number
}

// Ratio agudo:crónico a fecha `today`. Con menos de 4 semanas de datos (primera sesión hace
// menos de 28 días) o sin carga crónica, «datos insuficientes» en vez de un ratio engañoso.
// El aviso de subcarga (< 0,8) solo tiene sentido con un plan activo (fase 5).
export function acuteChronicRatio(
  sessions: LoadSession[],
  today: DateKey,
  { hasActivePlan = false }: { hasActivePlan?: boolean } = {},
): Acwr {
  const acute = loadBetween(sessions, addDays(today, -6), today)
  const chronic = loadBetween(sessions, addDays(today, -27), today)
  const chronicWeekly = chronic.load / 4
  const first = sessions.reduce<DateKey | null>((min, s) => {
    const day = localDateKey(s.startedAt)
    return min === null || day < min ? day : min
  }, null)
  const enoughHistory = first !== null && first <= addDays(today, -27)
  if (!enoughHistory || chronicWeekly <= 0) {
    return {
      acute: acute.load,
      chronicWeekly,
      ratio: null,
      status: 'insufficient',
      missingRpe: chronic.missingRpe,
    }
  }
  const ratio = acute.load / chronicWeekly
  const status: AcwrStatus =
    ratio > ACWR_HIGH ? 'high' : ratio < ACWR_LOW && hasActivePlan ? 'low' : 'ok'
  return { acute: acute.load, chronicWeekly, ratio, status, missingRpe: chronic.missingRpe }
}
