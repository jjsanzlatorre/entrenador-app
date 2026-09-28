// Cumplimiento: lo prometido frente a lo hecho (CLAUDE.md §10A). Lógica pura, con tests.
import type { SessionType } from '@/types/database'
import { addDays, addMonths, daysBetween, localDateKey, weekStartOf, type DateKey } from './dates'
import type { ActivityDay, Commitment, SessionLogEntry } from './types'

// Actividades libres: cuentan para el objetivo solo si counts_free_activities.
export const FREE_ACTIVITY_TYPES = new Set<SessionType>(['yoga', 'surf', 'padel_fronton', 'other'])
// Duración mínima para que una sesión cuente.
export const MIN_SESSION_MINUTES = 15

export function sessionMinutes(s: Pick<SessionLogEntry, 'durationMin' | 'startedAt' | 'endedAt'>) {
  if (s.durationMin !== null) return s.durationMin
  return Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60_000))
}

export function activityDaysFromSessions(sessions: SessionLogEntry[]): ActivityDay[] {
  return sessions.map((s) => ({
    day: localDateKey(s.startedAt),
    sessionType: s.sessionType,
    minutes: sessionMinutes(s),
  }))
}

// Compromiso vigente en una semana (el que cubre su lunes).
export function commitmentForWeek(commitments: Commitment[], weekStart: DateKey) {
  let found: Commitment | null = null
  for (const c of commitments) {
    if (c.validFrom <= weekStart && (c.validTo === null || c.validTo >= weekStart)) {
      if (!found || c.validFrom > found.validFrom) found = c
    }
  }
  return found
}

function counts(c: Commitment, type: SessionType) {
  return c.countsFreeActivities || !FREE_ACTIVITY_TYPES.has(type)
}

// Una sesión por día y tipo como máximo, de al menos 15 min.
function qualifying(days: ActivityDay[], c: Commitment) {
  const seen = new Set<string>()
  const out: ActivityDay[] = []
  for (const d of days) {
    if (d.minutes !== null && d.minutes < MIN_SESSION_MINUTES) continue
    if (!counts(c, d.sessionType)) continue
    const key = `${d.day}|${d.sessionType}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

export type TypeProgress = { sessionType: SessionType; done: number; committed: number }

export type WeekAdherence = {
  weekStart: DateKey
  commitment: Commitment | null
  committed: number
  // Sesiones que llenan huecos del compromiso (≤ committed) y las que sobran («+1 extra»).
  counted: number
  extra: number
  // counted / committed (0–1). null si esa semana no había compromiso.
  pct: number | null
  byType: TypeProgress[]
  // Minutos de las sesiones de la semana (null si no se conocen, p. ej. de la pareja).
  minutesDone: number | null
  minutesTarget: number | null
}

export function committedSessions(c: Commitment) {
  const typed = Object.values(c.byType ?? {}).reduce((a, n) => a + (n ?? 0), 0)
  return Math.max(c.sessionsPerWeek, typed)
}

export function weekAdherence(
  commitments: Commitment[],
  days: ActivityDay[],
  weekStart: DateKey,
): WeekAdherence {
  const weekEnd = addDays(weekStart, 6)
  const inWeek = days.filter((d) => d.day >= weekStart && d.day <= weekEnd)
  const c = commitmentForWeek(commitments, weekStart)
  if (!c) {
    return {
      weekStart,
      commitment: null,
      committed: 0,
      counted: 0,
      extra: 0,
      pct: null,
      byType: [],
      minutesDone: null,
      minutesTarget: null,
    }
  }

  const q = qualifying(inWeek, c)
  const doneByType = new Map<SessionType, number>()
  for (const d of q) doneByType.set(d.sessionType, (doneByType.get(d.sessionType) ?? 0) + 1)

  const committed = committedSessions(c)
  const typed = Object.entries(c.byType ?? {}).filter(([, n]) => (n ?? 0) > 0) as [
    SessionType,
    number,
  ][]
  let counted: number
  if (typed.length === 0) {
    counted = Math.min(q.length, committed)
  } else {
    // Reparto por tipo: cada tipo llena sus huecos; lo que sobra llena los huecos libres
    // (sesiones por semana − suma del reparto), si los hay.
    let filled = 0
    for (const [type, n] of typed) filled += Math.min(doneByType.get(type) ?? 0, n)
    const typedTotal = typed.reduce((a, [, n]) => a + n, 0)
    const freeSlots = Math.max(0, c.sessionsPerWeek - typedTotal)
    counted = filled + Math.min(q.length - filled, freeSlots)
  }

  const known = inWeek.filter((d) => d.minutes !== null && counts(c, d.sessionType))
  const minutesDone =
    inWeek.length > 0 && known.length === 0 ? null : known.reduce((a, d) => a + (d.minutes ?? 0), 0)

  return {
    weekStart,
    commitment: c,
    committed,
    counted,
    extra: q.length - counted,
    pct: counted / committed,
    byType: typed.map(([sessionType, n]) => ({
      sessionType,
      committed: n,
      done: doneByType.get(sessionType) ?? 0,
    })),
    minutesDone,
    minutesTarget: c.minutesPerWeek,
  }
}

export type MonthAdherence = {
  monthStart: DateKey
  // Prorrateado por días en las semanas partidas (puede tener decimales).
  committed: number
  // Objetivo entero del mes: el prorrateo redondeado (mínimo 1). 0 si no había compromiso.
  target: number
  done: number
  // Sesiones que llenan el objetivo (≤ target) y las que sobran («+N extra»).
  counted: number
  extra: number
  // counted / target (0–1). null si no había compromiso o el mes es parcial.
  pct: number | null
  // El compromiso empezó tan tarde que el objetivo prorrateado no llega a 1 sesión:
  // se muestra «Mes parcial» en vez de un porcentaje.
  partial: boolean
}

export function monthAdherence(
  commitments: Commitment[],
  days: ActivityDay[],
  monthStart: DateKey,
): MonthAdherence {
  const nextMonth = addMonths(monthStart, 1)
  let committed = 0
  const commitmentByDay = new Map<DateKey, Commitment | null>()
  for (let d = monthStart; d < nextMonth; d = addDays(d, 1)) {
    const c = commitmentForWeek(commitments, weekStartOf(d))
    commitmentByDay.set(d, c)
    if (c) committed += committedSessions(c) / 7
  }
  const seen = new Set<string>()
  let done = 0
  for (const d of days) {
    const c = commitmentByDay.get(d.day)
    if (!c) continue
    if (d.minutes !== null && d.minutes < MIN_SESSION_MINUTES) continue
    if (!counts(c, d.sessionType)) continue
    const key = `${d.day}|${d.sessionType}`
    if (seen.has(key)) continue
    seen.add(key)
    done++
  }
  committed = Math.round(committed * 10) / 10
  if (committed === 0) {
    return {
      monthStart,
      committed,
      target: 0,
      done,
      counted: 0,
      extra: 0,
      pct: null,
      partial: false,
    }
  }
  const partial = committed < 1
  const target = Math.max(1, Math.round(committed))
  const counted = Math.min(done, target)
  return {
    monthStart,
    committed,
    target,
    done,
    counted,
    extra: done - counted,
    pct: partial ? null : counted / target,
    partial,
  }
}

// «3/4 · 75 %», «Mes parcial · 2 sesiones» o «—».
export function monthValue(m: MonthAdherence) {
  if (m.partial) return `Mes parcial · ${plural(m.done, 'sesión', 'sesiones')}`
  if (m.target === 0) return '—'
  return `${m.counted}/${m.target} · ${formatPct(m.pct)}`
}

export type Streaks = { current: number; best: number }

// Racha: semanas seguidas con ≥ 100 %. La semana en curso suma si ya está completa,
// pero no rompe la racha mientras no ha terminado.
export function streaks(commitments: Commitment[], days: ActivityDay[], today: DateKey): Streaks {
  if (commitments.length === 0) return { current: 0, best: 0 }
  const first = weekStartOf(
    commitments.reduce((a, c) => (c.validFrom < a ? c.validFrom : a), today),
  )
  const thisWeek = weekStartOf(today)
  const weeks: { weekStart: DateKey; complete: boolean }[] = []
  for (let w = first; w <= thisWeek; w = addDays(w, 7)) {
    const a = weekAdherence(commitments, days, w)
    weeks.push({ weekStart: w, complete: a.pct !== null && a.pct >= 1 })
  }
  let best = 0
  let run = 0
  for (const w of weeks) {
    run = w.complete ? run + 1 : 0
    best = Math.max(best, run)
  }
  let current = 0
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i]!
    if (w.complete) current++
    else if (w.weekStart === thisWeek) continue
    else break
  }
  return { current, best }
}

// Últimas n semanas (la última es la semana en curso).
export function weekHistory(
  commitments: Commitment[],
  days: ActivityDay[],
  today: DateKey,
  n = 12,
): WeekAdherence[] {
  const thisWeek = weekStartOf(today)
  return Array.from({ length: n }, (_, i) =>
    weekAdherence(commitments, days, addDays(thisWeek, -7 * (n - 1 - i))),
  )
}

// % medio de las 13 semanas terminadas anteriores (≈ 3 meses), con cada semana hasta 100 %.
export function averagePct(commitments: Commitment[], days: ActivityDay[], today: DateKey) {
  const thisWeek = weekStartOf(today)
  const pcts: number[] = []
  for (let i = 1; i <= 13; i++) {
    const a = weekAdherence(commitments, days, addDays(thisWeek, -7 * i))
    if (a.pct !== null) pcts.push(Math.min(1, a.pct))
  }
  return pcts.length === 0 ? null : pcts.reduce((a, b) => a + b, 0) / pcts.length
}

export type AdherenceLevel = 'low' | 'mid' | 'done'

// < 50 % neutro, 50–99 % intermedio, ≥ 100 % logro.
export function adherenceLevel(pct: number | null): AdherenceLevel {
  if (pct === null || pct < 0.5) return 'low'
  return pct >= 1 ? 'done' : 'mid'
}

export function formatPct(pct: number | null) {
  return pct === null ? '—' : `${Math.round(pct * 100)} %`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Mensaje de ánimo de la semana (sin culpa).
export function weekMessage(week: WeekAdherence, today: DateKey) {
  if (!week.commitment) return 'Define tu compromiso semanal para ver tu barra.'
  const remaining = Math.max(0, week.committed - week.counted)
  const weekEnd = addDays(week.weekStart, 6)
  const inProgress = today >= week.weekStart && today <= weekEnd
  if (remaining === 0) {
    return week.extra > 0 ? `¡Semana completa y +${week.extra} extra! 🔥` : '¡Semana completa! 💪'
  }
  if (!inProgress) {
    return `${week.counted} de ${week.committed}. ¡La siguiente, a por ella!`
  }
  const daysLeft = daysBetween(today, weekEnd) + 1
  if (remaining === 1) {
    return `${week.counted} de ${week.committed}, ¡una más y semana completa!`
  }
  return `Te faltan ${plural(remaining, 'sesión', 'sesiones')}, ${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`}.`
}

// Semana en curso: ¿quedan días?
export function isCurrentWeek(weekStart: DateKey, today: DateKey) {
  return weekStartOf(today) === weekStart
}
