// Calendario semanal del plan: planificado frente a hecho.
import { addDays, localDateKey, type DateKey } from '@/lib/progress/dates'
import type { SessionLogEntry } from '@/lib/progress/types'
import type { PlannedSession } from './api'
import type { FixedActivity } from './profile'

export type PlannedView = PlannedSession & {
  // «done» también si la sesión registrada aún está pendiente de subir.
  effectiveStatus: PlannedSession['status']
  linkedSessionId: string | null
}

export type DayView = {
  date: DateKey
  weekday: number
  planned: PlannedView[]
  // Sesiones registradas ese día que no están enlazadas a ninguna planificada.
  extra: SessionLogEntry[]
  fixed: Pick<FixedActivity, 'type' | 'minutes'>[]
}

export function weekView(
  planned: PlannedSession[],
  log: SessionLogEntry[],
  weekStart: DateKey,
  fixed: Pick<FixedActivity, 'type' | 'days' | 'minutes'>[] = [],
): DayView[] {
  const byPlanned = new Map<string, string>()
  for (const s of log) if (s.plannedSessionId) byPlanned.set(s.plannedSessionId, s.id)
  const linked = new Set<string>()
  for (const p of planned) if (p.workoutSessionId) linked.add(p.workoutSessionId)
  const plannedIds = new Set(planned.map((p) => p.id))
  for (const s of log)
    if (s.plannedSessionId && plannedIds.has(s.plannedSessionId)) linked.add(s.id)

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const weekday = i + 1
    return {
      date,
      weekday,
      planned: planned
        .filter((p) => p.date === date)
        .map((p) => {
          const pendingLink = byPlanned.get(p.id) ?? null
          return {
            ...p,
            effectiveStatus: pendingLink && p.status !== 'done' ? 'done' : p.status,
            linkedSessionId: p.workoutSessionId ?? pendingLink,
          }
        }),
      extra: log.filter((s) => localDateKey(s.startedAt) === date && !linked.has(s.id)),
      fixed: fixed
        .filter((f) => f.days.includes(weekday))
        .map((f) => ({ type: f.type, minutes: f.minutes })),
    }
  })
}

export function weekSummary(days: DayView[]) {
  const planned = days.flatMap((d) => d.planned)
  return {
    planned: planned.length,
    done: planned.filter((p) => p.effectiveStatus === 'done').length,
    skipped: planned.filter((p) => p.effectiveStatus === 'skipped').length,
    extra: days.reduce((a, d) => a + d.extra.length, 0),
  }
}

// Semana del plan (1–4) de un lunes; null si está fuera.
export function planWeekNumber(planStart: DateKey, weekStart: DateKey, weeks = 4) {
  const diff = Math.round(
    (Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${planStart}T00:00:00Z`)) /
      (7 * 86_400_000),
  )
  return diff >= 0 && diff < weeks ? diff + 1 : null
}

// Adherencia al plan (§10A): planificadas hechas / planificadas que ya tocaban. Cuentan las que
// eran de antes de hoy y las ya hechas (aunque sean de hoy o se adelantaran); la de hoy sin hacer
// aún no resta. Es un indicador separado del compromiso.
export function planAdherence(
  planned: Pick<PlannedSession, 'id' | 'date' | 'status'>[],
  log: Pick<SessionLogEntry, 'plannedSessionId'>[],
  today: DateKey,
) {
  const pendingLinks = new Set(log.flatMap((s) => (s.plannedSessionId ? [s.plannedSessionId] : [])))
  const isDone = (p: Pick<PlannedSession, 'id' | 'status'>) =>
    p.status === 'done' || pendingLinks.has(p.id)
  const done = planned.filter(isDone).length
  const due = planned.filter((p) => p.date < today || isDone(p)).length
  const skipped = planned.filter((p) => p.status === 'skipped' && !isDone(p)).length
  return {
    done,
    due,
    skipped,
    total: planned.length,
    pct: due > 0 ? Math.round((done / due) * 100) : null,
  }
}

// Pendientes de días anteriores de la semana en curso (para ofrecer hacerlas o saltarlas).
export function overdueThisWeek(days: DayView[], today: DateKey) {
  return days
    .filter((d) => d.date < today)
    .flatMap((d) =>
      d.planned.filter((p) => p.effectiveStatus === 'planned' || p.effectiveStatus === 'moved'),
    )
}

// Sesiones por semana del plan (la semana con más sesiones), para usarlo como compromiso.
export function planSessionsPerWeek(planned: Pick<PlannedSession, 'week'>[]) {
  const byWeek = new Map<number, number>()
  for (const p of planned) byWeek.set(p.week, (byWeek.get(p.week) ?? 0) + 1)
  return Math.max(0, ...byWeek.values())
}
