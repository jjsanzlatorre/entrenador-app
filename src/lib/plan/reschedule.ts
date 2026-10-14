// Mover sesiones y el plan entero (usabilidad 2/3). Funciones puras: calculan la lista de cambios
// que se enseña en la vista previa y que después aplica `apply_plan_change` (0043) tal cual, en
// una transacción. Solo se mueven sesiones pendientes (planned | moved); lo hecho y lo saltado
// se queda donde está.
import { addDays, daysBetween, isoWeekday, weekStartOf, type DateKey } from '@/lib/progress/dates'
import type { PlanChangeKind } from '@/types/database'
import type { PlannedSession } from './api'

export type SessionMove = { id: string; title: string; from: DateKey; to: DateKey }
export type SessionCopy = { sourceId: string; title: string; from: DateKey; date: DateKey }

export type PlanChange = {
  kind: PlanChangeKind
  moves: SessionMove[]
  copies: SessionCopy[]
  // Nueva fecha de inicio del plan (si aún no había empezado).
  newStart: DateKey | null
  params: Record<string, string | number>
  // Motivo por el que no se puede aplicar (la vista previa lo enseña y no deja aplicar).
  error: string | null
}

type Session = Pick<PlannedSession, 'id' | 'date' | 'status' | 'title'>
type Plan = { startDate: DateKey; sessions: Session[] }

export const isPendingPlanned = (s: Pick<PlannedSession, 'status'>) =>
  s.status === 'planned' || s.status === 'moved'

const byDate = (a: { date: DateKey }, b: { date: DateKey }) => a.date.localeCompare(b.date)

function change(kind: PlanChangeKind, partial: Partial<Omit<PlanChange, 'kind'>> = {}): PlanChange {
  return { kind, moves: [], copies: [], newStart: null, params: {}, error: null, ...partial }
}

// Un día concreto (también desde el arrastre y desde «Hoy»).
export function moveSession(session: Session, to: DateKey): PlanChange {
  if (!isPendingPlanned(session)) return change('move', { error: 'Solo se mueven pendientes.' })
  if (session.date === to) return change('move', { error: 'Ya está ese día.' })
  return change('move', {
    moves: [{ id: session.id, title: session.title, from: session.date, to }],
    params: { to },
  })
}

// Intercambiar dos sesiones pendientes de días distintos.
export function swapSessions(a: Session, b: Session): PlanChange {
  if (!isPendingPlanned(a) || !isPendingPlanned(b))
    return change('swap', { error: 'Solo se intercambian sesiones pendientes.' })
  if (a.date === b.date) return change('swap', { error: 'Las dos son del mismo día.' })
  return change('swap', {
    moves: [
      { id: a.id, title: a.title, from: a.date, to: b.date },
      { id: b.id, title: b.title, from: b.date, to: a.date },
    ],
  })
}

// Desplazar: todas las pendientes desde `from` (incluido) ± `days`.
export function shiftPlan(plan: Plan, from: DateKey, days: number, today: DateKey): PlanChange {
  const params = { from, days }
  if (!Number.isInteger(days) || days === 0)
    return change('shift', { params, error: 'Elige cuántos días o semanas.' })
  const affected = plan.sessions.filter((s) => isPendingPlanned(s) && s.date >= from).sort(byDate)
  if (affected.length === 0)
    return change('shift', { params, error: 'No hay sesiones pendientes desde esa fecha.' })
  const moves = affected.map((s) => ({
    id: s.id,
    title: s.title,
    from: s.date,
    to: addDays(s.date, days),
  }))
  const past = moves.find((m) => m.to < today)
  if (past)
    return change('shift', {
      moves,
      params,
      error: 'Alguna sesión quedaría en el pasado: desplaza menos días o desde más adelante.',
    })
  return change('shift', {
    moves,
    params,
    newStart: plan.startDate >= from ? addDays(plan.startDate, days) : null,
  })
}

// Pausar (vacaciones, lesión): de `from` a `until` (incluidos) no hay sesiones. Las pendientes
// desde `from` se desplazan semanas enteras, las mínimas para que la primera caiga después de la
// pausa: así se mantienen el orden y los días de la semana.
export function pausePlan(plan: Plan, from: DateKey, until: DateKey, today: DateKey): PlanChange {
  const params = { from, until }
  if (from < today)
    return change('pause', { params, error: 'La pausa no puede empezar antes de hoy.' })
  if (until < from)
    return change('pause', { params, error: 'La fecha final es anterior a la de inicio.' })
  const affected = plan.sessions.filter((s) => isPendingPlanned(s) && s.date >= from).sort(byDate)
  const inPause = affected.filter((s) => s.date <= until)
  if (inPause.length === 0)
    return change('pause', {
      params,
      error: 'No hay sesiones pendientes en esas fechas: no hace falta mover nada.',
    })
  const first = inPause[0]!.date
  const weeks = Math.ceil((daysBetween(first, until) + 1) / 7)
  const days = weeks * 7
  return change('pause', {
    params: { ...params, days },
    moves: affected.map((s) => ({
      id: s.id,
      title: s.title,
      from: s.date,
      to: addDays(s.date, days),
    })),
    newStart: plan.startDate >= from ? addDays(plan.startDate, days) : null,
  })
}

// Repetir la semana `weekStart`: copia sus sesiones (todas, también las hechas) una semana
// después y desplaza 7 días las pendientes de después.
export function repeatWeek(plan: Plan, weekStart: DateKey, today: DateKey): PlanChange {
  const start = weekStartOf(weekStart)
  const end = addDays(start, 6)
  const params = { week_start: start }
  const week = plan.sessions.filter((s) => s.date >= start && s.date <= end).sort(byDate)
  if (week.length === 0)
    return change('repeat', { params, error: 'Esta semana no tiene sesiones que repetir.' })
  if (addDays(end, 7) < today)
    return change('repeat', { params, error: 'Solo se puede repetir esta semana o una futura.' })
  const copies = week.map((s) => ({
    sourceId: s.id,
    title: s.title,
    from: s.date,
    date: addDays(s.date, 7),
  }))
  const moves = plan.sessions
    .filter((s) => isPendingPlanned(s) && s.date > end)
    .sort(byDate)
    .map((s) => ({ id: s.id, title: s.title, from: s.date, to: addDays(s.date, 7) }))
  const pastCopy = copies.find((c) => c.date < today)
  return change('repeat', {
    params,
    copies,
    moves,
    error: pastCopy ? 'Alguna sesión repetida caería en el pasado.' : null,
  })
}

// Días de pausa (de los cambios de tipo «pause» sin deshacer).
export type PlanPause = { from: DateKey; until: DateKey }

export function pauseOn(pauses: PlanPause[], date: DateKey) {
  return pauses.find((p) => date >= p.from && date <= p.until) ?? null
}

// Última fecha de las sesiones del plan (para la vista previa: «el plan termina el…»).
export function planEnd(sessions: Pick<PlannedSession, 'date'>[]) {
  return sessions.reduce<DateKey | null>((max, s) => (!max || s.date > max ? s.date : max), null)
}

export function planEndAfter(plan: Plan, c: PlanChange) {
  const moved = new Map(c.moves.map((m) => [m.id, m.to]))
  const dates = [
    ...plan.sessions.map((s) => ({ date: moved.get(s.id) ?? s.date })),
    ...c.copies.map((x) => ({ date: x.date })),
  ]
  return planEnd(dates)
}

// Semana del plan que se ve en el calendario: la de sus sesiones (con pausas o semanas repetidas
// el plan dura más de 4 semanas); si no hay, por la fecha de inicio.
export function planWeekForRange(
  sessions: Pick<PlannedSession, 'date' | 'week'>[],
  weekStart: DateKey,
): number | null {
  const end = addDays(weekStart, 6)
  const weeks = sessions.filter((s) => s.date >= weekStart && s.date <= end).map((s) => s.week)
  if (weeks.length === 0) return null
  // La más frecuente (una sesión movida desde otra semana no cambia la etiqueta).
  const counts = new Map<number, number>()
  for (const w of weeks) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]
}

// Tira de 14 días para mover una sesión: la semana de la sesión (o la actual si ya pasó) y la
// siguiente.
export function moveStripStart(sessionDate: DateKey, today: DateKey) {
  return weekStartOf(sessionDate > today ? sessionDate : today)
}

export function moveStrip(start: DateKey) {
  return Array.from({ length: 14 }, (_, i) => {
    const date = addDays(start, i)
    return { date, weekday: isoWeekday(date) }
  })
}
