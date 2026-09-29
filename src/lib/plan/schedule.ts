// Reparto de las sesiones de una plantilla en los días del usuario (sin IA).
//
// Para cada semana se prueban todas las combinaciones de días y se elige la de menor coste:
// - días que no son los preferidos y días con actividad fija: penalización;
// - pierna pesada el día antes de frontón, pádel, tenis o surf (o ese mismo día): penalización
//   alta (actividades con leg_loading en activity_types);
// - dos sesiones intensas en días seguidos (también de domingo a lunes): penalización alta. Una
//   actividad fija de pierna y core (GAP: hard_legs) cuenta como sesión intensa;
// - sesiones en días seguidos y cambios del orden de la plantilla: penalización pequeña.
// Con el mismo coste gana la primera combinación (orden fijo): el resultado es determinista.
import { isHardLegsActivity, isLegLoadingActivity } from '@/lib/activities/catalog'
import { addDays, type DateKey } from '@/lib/progress/dates'
import type { FixedActivity } from './profile'
import { WEEKDAY_LONG } from './profile'
import type { PlanBlock, PlanSession, PlanStructure } from './types'

export type ScheduledSession = {
  date: DateKey
  week: number
  session_type: PlanSession['session_type']
  title: string
  intensity: PlanSession['intensity']
  heavy_legs: boolean
  duration_min: number
  notes: string | null
  blocks: PlanBlock[]
}

export type ScheduleInput = {
  structure: PlanStructure
  // Lunes en que empieza el plan.
  startDate: DateKey
  // 1 = lunes … 7 = domingo.
  preferredDays: number[]
  fixedActivities: Pick<FixedActivity, 'type' | 'days'>[]
}

// Actividades fijas que cargan las piernas (no poner pierna pesada el día antes) y las que
// cuentan como sesión intensa de pierna y core. Salen de los datos (activity_types).
export const isLegLoading = (type: FixedActivity['type']) => isLegLoadingActivity(type)
export const isHardFixed = (type: FixedActivity['type']) => isHardLegsActivity(type)

const COST = {
  notPreferred: 3,
  fixedDay: 4,
  heavyBeforeLegActivity: 12,
  heavySameDayLegActivity: 8,
  hardBackToBack: 8,
  backToBack: 1,
  outOfOrder: 0.5,
}

const next = (day: number) => (day % 7) + 1
const prev = (day: number) => ((day + 5) % 7) + 1

function* combinations(
  items: number[],
  k: number,
  start = 0,
  acc: number[] = [],
): Generator<number[]> {
  if (acc.length === k) {
    yield [...acc]
    return
  }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]!)
    yield* combinations(items, k, i + 1, acc)
    acc.pop()
  }
}

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield [...items]
    return
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) yield [items[i]!, ...p]
  }
}

type Context = {
  preferred: Set<number>
  fixed: Set<number>
  legFixed: Set<number>
  // Días con una actividad fija intensa de pierna y core (GAP).
  hardFixed: Set<number>
}

function context(input: Pick<ScheduleInput, 'preferredDays' | 'fixedActivities'>): Context {
  const fixed = new Set<number>()
  const legFixed = new Set<number>()
  const hardFixed = new Set<number>()
  for (const f of input.fixedActivities) {
    for (const d of f.days) {
      fixed.add(d)
      if (isLegLoading(f.type)) legFixed.add(d)
      if (isHardFixed(f.type)) hardFixed.add(d)
    }
  }
  return { preferred: new Set(input.preferredDays), fixed, legFixed, hardFixed }
}

// Sesión intensa o de pierna pesada al lado (día antes o después) de una actividad fija intensa.
function nextToHardFixed(
  s: Pick<PlanSession, 'intensity' | 'heavy_legs'>,
  day: number,
  ctx: Context,
) {
  return (
    (s.intensity === 'hard' || s.heavy_legs) &&
    (ctx.hardFixed.has(next(day)) || ctx.hardFixed.has(prev(day)))
  )
}

// Coste de poner cada sesión i en days[i].
export function assignmentCost(
  sessions: Pick<PlanSession, 'intensity' | 'heavy_legs'>[],
  days: number[],
  ctx: Context,
) {
  let cost = 0
  const byDay = new Map<number, number>()
  days.forEach((d, i) => byDay.set(d, i))
  days.forEach((d, i) => {
    const s = sessions[i]!
    if (ctx.preferred.size > 0 && !ctx.preferred.has(d)) cost += COST.notPreferred
    if (ctx.fixed.has(d)) cost += COST.fixedDay
    if (s.heavy_legs && ctx.legFixed.has(next(d))) cost += COST.heavyBeforeLegActivity
    if (s.heavy_legs && ctx.legFixed.has(d)) cost += COST.heavySameDayLegActivity
    if (nextToHardFixed(s, d, ctx)) cost += COST.hardBackToBack
    if (s.heavy_legs && ctx.hardFixed.has(d)) cost += COST.heavySameDayLegActivity
    const j = byDay.get(next(d))
    if (j !== undefined) {
      cost += COST.backToBack
      if (s.intensity === 'hard' && sessions[j]!.intensity === 'hard') cost += COST.hardBackToBack
    }
    for (let k = i + 1; k < days.length; k++) if (days[k]! < d) cost += COST.outOfOrder
  })
  return cost
}

export function bestDays(
  sessions: Pick<PlanSession, 'intensity' | 'heavy_legs'>[],
  ctx: Context,
): number[] {
  const n = Math.min(sessions.length, 7)
  let best: number[] = []
  let bestCost = Infinity
  for (const combo of combinations([1, 2, 3, 4, 5, 6, 7], n)) {
    for (const perm of permutations(combo)) {
      const c = assignmentCost(sessions, perm, ctx)
      if (c < bestCost) {
        bestCost = c
        best = perm
      }
    }
  }
  return best
}

export type ScheduleWarning =
  | { kind: 'more_sessions_than_days'; sessions: number; days: number }
  | { kind: 'heavy_before_activity'; week: number; day: number }
  | { kind: 'hard_back_to_back'; week: number; day: number }
  | { kind: 'next_to_hard_activity'; week: number; day: number }
  | { kind: 'on_fixed_day'; week: number; day: number }

export function schedulePlan(input: ScheduleInput) {
  const ctx = context(input)
  const warnings: ScheduleWarning[] = []
  const sessions: ScheduledSession[] = []
  const perWeek = input.structure.weeks[0]?.sessions.length ?? 0
  if (ctx.preferred.size > 0 && perWeek > ctx.preferred.size) {
    warnings.push({ kind: 'more_sessions_than_days', sessions: perWeek, days: ctx.preferred.size })
  }
  for (const week of input.structure.weeks) {
    const ordered = [...week.sessions].sort((a, b) => a.day_hint - b.day_hint)
    const days = bestDays(ordered, ctx)
    const byDay = new Map(days.map((d, i) => [d, ordered[i]!]))
    ordered.forEach((s, i) => {
      const day = days[i]!
      if (s.heavy_legs && ctx.legFixed.has(next(day))) {
        warnings.push({ kind: 'heavy_before_activity', week: week.week, day })
      }
      const after = byDay.get(next(day))
      if (s.intensity === 'hard' && after?.intensity === 'hard') {
        warnings.push({ kind: 'hard_back_to_back', week: week.week, day })
      }
      if (nextToHardFixed(s, day, ctx)) {
        warnings.push({ kind: 'next_to_hard_activity', week: week.week, day })
      }
      if (ctx.fixed.has(day)) warnings.push({ kind: 'on_fixed_day', week: week.week, day })
      sessions.push({
        date: addDays(input.startDate, (week.week - 1) * 7 + day - 1),
        week: week.week,
        session_type: s.session_type,
        title: s.title,
        intensity: s.intensity,
        heavy_legs: s.heavy_legs,
        duration_min: s.duration_min,
        notes: s.notes ?? null,
        blocks: s.blocks,
      })
    })
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date))
  return { sessions, warnings }
}

export function warningText(w: ScheduleWarning) {
  switch (w.kind) {
    case 'more_sessions_than_days':
      return `La plantilla tiene ${w.sessions} sesiones por semana y marcaste ${w.days} días: se usan también otros días.`
    case 'heavy_before_activity':
      return `Semana ${w.week}: pierna pesada el ${WEEKDAY_LONG[w.day - 1]}, el día antes de una actividad fija. Muévela si puedes.`
    case 'hard_back_to_back':
      return `Semana ${w.week}: dos sesiones intensas seguidas desde el ${WEEKDAY_LONG[w.day - 1]}.`
    case 'next_to_hard_activity':
      return `Semana ${w.week}: sesión intensa el ${WEEKDAY_LONG[w.day - 1]}, junto a una clase intensa de pierna y core (GAP).`
    case 'on_fixed_day':
      return `Semana ${w.week}: una sesión cae el ${WEEKDAY_LONG[w.day - 1]}, día de actividad fija.`
  }
}

// Lunes posibles para empezar: hoy si es lunes y los siguientes.
export function startOptions(today: DateKey, count = 4): DateKey[] {
  const d = new Date(`${today}T00:00:00Z`).getUTCDay()
  const daysToMonday = (8 - (d === 0 ? 7 : d)) % 7
  const first = addDays(today, daysToMonday)
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7))
}
