// Equivalencias motivadoras (CLAUDE.md §10B). Lógica pura y determinista, con tests:
// el dato y la equivalencia salen siempre de aquí, nunca de la IA.
import type { DestinationType, EquivalenceKind } from '@/types/database'
import { formatDuration } from './period-summary'
import {
  PERIOD_PREFIX,
  accumulate,
  periodFor,
  type Accumulated,
  type Period,
  type PeriodKind,
} from './accumulated'
import type { DateKey } from './dates'
import type { SessionLogEntry } from './types'

export type EquivalenceObject = {
  id: string
  kind: EquivalenceKind
  label: string
  labelPlural: string
  article: string
  emoji: string
  value: number
  phraseTemplate: string
  minValue: number
}

export type Destination = {
  id: string
  name: string
  lat: number
  lng: number
  type: DestinationType
  waterRoute: boolean
}

export type Home = { city: string; lat: number; lng: number }

export type EquivalenceCatalog = { objects: EquivalenceObject[]; destinations: Destination[] }
export type EquivalenceContext = EquivalenceCatalog & { home: Home | null }

// ── Distancias ──────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_008.8

// Distancia en línea recta (círculo máximo) entre dos puntos, en metros.
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Destinos más cerca que esto de casa no cuentan (la propia ciudad o un barrio).
export const MIN_DESTINATION_M = 5000

// ── Escalera de equivalencias ───────────────────────────────

// Un peldaño: un objeto del catálogo o un destino (value = distancia desde casa).
export type Step = {
  id: string
  emoji: string
  // En la unidad de la métrica: kg, metros o minutos.
  value: number
  object: EquivalenceObject | null
  destination: Destination | null
}

const DESTINATION_EMOJI: Record<DestinationType, string> = {
  city: '🏙️',
  island: '🏝️',
  landmark: '📍',
}

export function destinationSteps(
  home: Home,
  destinations: Destination[],
  { waterOnly = false } = {},
): Step[] {
  return destinations
    .filter((d) => !waterOnly || d.waterRoute)
    .map((d) => ({
      id: d.id,
      emoji: DESTINATION_EMOJI[d.type],
      value: haversineM(home, d),
      object: null,
      destination: d,
    }))
    .filter((s) => s.value >= MIN_DESTINATION_M)
    .sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))
}

export function objectSteps(objects: EquivalenceObject[], kind: EquivalenceKind): Step[] {
  return objects
    .filter((o) => o.kind === kind)
    .map((o) => ({ id: o.id, emoji: o.emoji, value: o.value, object: o, destination: null }))
    .sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))
}

export type LadderPosition = {
  // Último peldaño superado (value ≤ valor) y el siguiente.
  passed: Step | null
  next: Step | null
  // valor / siguiente (0–1): barra hacia la siguiente equivalencia.
  fraction: number | null
  // Lo que falta para el siguiente.
  remaining: number | null
}

export function ladderPosition(steps: Step[], value: number): LadderPosition {
  let passed: Step | null = null
  let next: Step | null = null
  for (const step of steps) {
    if (step.value <= value) passed = step
    else {
      next = step
      break
    }
  }
  return {
    passed,
    next,
    fraction: next ? Math.max(0, Math.min(1, value / next.value)) : null,
    remaining: next ? next.value - value : null,
  }
}

// ── Textos ──────────────────────────────────────────────────

// «5.200 kg»: en es-ES los números de 4 cifras no se agrupan por defecto. 'always' es de
// Intl.NumberFormat v3 (los tipos de TS aún no lo recogen).
const ALWAYS = 'always' as unknown as boolean
const oneDecimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, useGrouping: ALWAYS })
const intFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: ALWAYS })

// Cuántas veces cabe el objeto (redondeado a 1 decimal).
export function objectMultiple(value: number, object: Pick<EquivalenceObject, 'value'>) {
  return Math.round((value / object.value) * 10) / 10
}

// «un tractor» (≈ 1 vez) o «3,4 coches».
export function formatQty(object: EquivalenceObject, multiple: number) {
  if (multiple <= 1) return `${object.article} ${object.label}`
  return `${oneDecimal.format(multiple)} ${object.labelPlural}`
}

export function objectPhrase(object: EquivalenceObject, value: number) {
  return object.phraseTemplate.replace('{qty}', formatQty(object, objectMultiple(value, object)))
}

// «12 %», «0,4 %»
export function formatFraction(fraction: number) {
  // Hacia abajo: nunca se dice «100 %» sin haber llegado.
  const pct = fraction * 100
  if (pct < 10) return `${oneDecimal.format(Math.floor(pct * 10) / 10)} %`
  return `${intFormat.format(Math.floor(pct))} %`
}

// Fracción de un objetivo grande: el objeto más grande aún no alcanzado que ya se puede
// mostrar (min_value ≤ valor). «Llevas el 12 % de la Torre Eiffel».
export function bigGoal(objects: EquivalenceObject[], kind: EquivalenceKind, value: number) {
  let best: EquivalenceObject | null = null
  for (const o of objects) {
    if (o.kind !== kind || o.value <= value || o.minValue > value) continue
    if (!best || o.value > best.value) best = o
  }
  return best ? { object: best, fraction: value / best.value } : null
}

// ── Métricas ────────────────────────────────────────────────

export type Metric = 'run' | 'swim' | 'bike' | 'tonnage' | 'dist' | 'time'

export const METRICS: Metric[] = ['swim', 'run', 'bike', 'dist', 'tonnage', 'time']

export const METRIC_LABEL: Record<Metric, string> = {
  swim: 'Natación',
  run: 'Carrera',
  bike: 'Bici y spinning',
  dist: 'Distancia total',
  tonnage: 'Tonelaje',
  time: 'Tiempo entrenando',
}

const DISTANCE_VERB: Record<Exclude<Metric, 'tonnage' | 'time'>, string> = {
  swim: 'Has nadado',
  run: 'Has corrido',
  bike: 'Has pedaleado',
  dist: 'Has recorrido',
}

export function metricValue(acc: Accumulated, metric: Metric) {
  switch (metric) {
    case 'swim':
      return acc.swimM
    case 'run':
      return acc.runM
    case 'bike':
      return acc.bikeM
    case 'dist':
      return acc.distM
    case 'tonnage':
      return acc.tonnageKg
    case 'time':
      return acc.minutes
  }
}

const kmFormat = (m: number) =>
  `${m >= 100_000 ? intFormat.format(m / 1000) : oneDecimal.format(m / 1000)} km`

export function formatMetricValue(metric: Metric, value: number) {
  switch (metric) {
    case 'swim':
      return value >= 10_000 ? kmFormat(value) : `${intFormat.format(value)} m`
    case 'run':
    case 'bike':
    case 'dist':
      return kmFormat(value)
    case 'tonnage':
      return `${intFormat.format(value)} kg`
    case 'time':
      return formatDuration(value)
  }
}

// Distancias que siempre se expresan en km (lo que falta hasta el siguiente destino).
export function formatKm(m: number) {
  return m < 1000 ? `${intFormat.format(m)} m` : kmFormat(m)
}

export function stepsFor(metric: Metric, ctx: EquivalenceContext): Step[] {
  switch (metric) {
    case 'swim': {
      // Rutas fijas a nado + destinos por mar desde casa.
      const routes = objectSteps(ctx.objects, 'distance_route')
      const water = ctx.home
        ? destinationSteps(ctx.home, ctx.destinations, { waterOnly: true })
        : []
      return [...routes, ...water].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))
    }
    case 'run':
    case 'bike':
    case 'dist':
      return ctx.home ? destinationSteps(ctx.home, ctx.destinations) : []
    case 'tonnage':
      return objectSteps(ctx.objects, 'weight')
    case 'time':
      return objectSteps(ctx.objects, 'time')
  }
}

// Frase de un peldaño superado (sin el periodo delante).
export function stepPhrase(metric: Metric, step: Step, value: number, home: Home | null) {
  if (step.object) return objectPhrase(step.object, value)
  const d = step.destination!
  const verb = metric === 'tonnage' || metric === 'time' ? 'Has recorrido' : DISTANCE_VERB[metric]
  return `${verb} la distancia de ${home?.city ?? 'tu ciudad'} a ${d.name}, en línea recta`
}

export function stepName(step: Step) {
  if (step.object) return `${step.object.article} ${step.object.label}`
  return step.destination!.name
}

// «Siguiente: Madrid, a 48 km en línea recta» o «Llevas el 62 % de un elefante africano».
export function nextText(step: Step, value: number) {
  if (step.destination) {
    return `Siguiente: ${step.destination.name}, a ${formatKm(step.value - value)} en línea recta`
  }
  return `Llevas el ${formatFraction(value / step.value)} de ${stepName(step)}`
}

export type Equivalence = {
  metric: Metric
  value: number
  position: LadderPosition
  // Frase del peldaño superado (null si aún no se ha superado ninguno).
  phrase: string | null
  next: string | null
  big: { object: EquivalenceObject; fraction: number; text: string } | null
  // Falta la ciudad de referencia para esta equivalencia.
  needsHome: boolean
}

export function equivalenceFor(
  metric: Metric,
  value: number,
  ctx: EquivalenceContext,
): Equivalence {
  const steps = stepsFor(metric, ctx)
  const position = ladderPosition(steps, value)
  const kind: EquivalenceKind | null =
    metric === 'tonnage'
      ? 'weight'
      : metric === 'time'
        ? 'time'
        : metric === 'swim'
          ? 'distance_route'
          : null
  const goal = kind ? bigGoal(ctx.objects, kind, value) : null
  const big =
    goal && goal.object.id !== position.next?.id
      ? {
          ...goal,
          text: `Llevas el ${formatFraction(goal.fraction)} de ${goal.object.article} ${goal.object.label}`,
        }
      : null
  return {
    metric,
    value,
    position,
    phrase: position.passed ? stepPhrase(metric, position.passed, value, ctx.home) : null,
    next: position.next ? nextText(position.next, value) : null,
    big,
    needsHome:
      !ctx.home &&
      (metric === 'run' || metric === 'bike' || metric === 'dist' || metric === 'swim'),
  }
}

// «Este mes has levantado el peso de un tractor»
export function withPeriod(kind: PeriodKind, phrase: string) {
  return `${PERIOD_PREFIX[kind]} ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`
}

// ── Hitos (pop-up de fin de sesión) ─────────────────────────

export const POPUP_PERIODS: PeriodKind[] = ['week', 'month', 'total']

// Cuanto más alto, más llamativo: el total antes que el mes y el mes antes que la semana;
// dentro del mismo periodo, los destinos antes que el tonelaje y el tiempo.
const PERIOD_SCORE: Record<PeriodKind, number> = { total: 300, year: 250, month: 200, week: 100 }
const METRIC_SCORE: Record<Metric, number> = {
  run: 50,
  swim: 50,
  bike: 40,
  tonnage: 30,
  dist: 20,
  time: 10,
}

export function milestoneKey(metric: Metric, period: Period, stepId: string) {
  return [metric, period.kind, period.key, stepId].filter(Boolean).join('_')
}

export function monthSummaryKey(monthStart: DateKey) {
  return `month_summary_${monthStart.slice(0, 7)}`
}

export type ParsedMilestone =
  | { type: 'step'; metric: Metric; period: PeriodKind; periodKey: string | null; stepId: string }
  | { type: 'month_summary'; month: string }

export function parseMilestoneKey(key: string): ParsedMilestone | null {
  const summary = /^month_summary_(\d{4}-\d{2})$/.exec(key)
  if (summary) return { type: 'month_summary', month: summary[1]! }
  const m = /^(run|swim|bike|tonnage|dist|time)_(week|month|year|total)_(.+)$/.exec(key)
  if (!m) return null
  const [, metric, period, rest] = m as unknown as [string, Metric, PeriodKind, string]
  if (period === 'total') return { type: 'step', metric, period, periodKey: null, stepId: rest }
  const keyed = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)_(.+)$/.exec(rest)
  if (!keyed) return null
  return { type: 'step', metric, period, periodKey: keyed[1]!, stepId: keyed[2]! }
}

export type MilestoneCandidate = {
  key: string
  metric: Metric
  period: Period
  step: Step
  value: number
  // Frase completa con el periodo delante y el dato real formateado.
  phrase: string
  valueLabel: string
  score: number
}

// Hitos que cruza una sesión: peldaños superados con ella que no lo estaban sin ella.
export function crossedMilestones(
  sessions: SessionLogEntry[],
  sessionId: string,
  day: DateKey,
  ctx: EquivalenceContext,
): MilestoneCandidate[] {
  const before = sessions.filter((s) => s.id !== sessionId)
  if (before.length === sessions.length) return []
  const out: MilestoneCandidate[] = []
  for (const kind of POPUP_PERIODS) {
    const period = periodFor(kind, day)
    const accBefore = accumulate(before, period)
    const accAfter = accumulate(sessions, period)
    for (const metric of METRICS) {
      const vBefore = metricValue(accBefore, metric)
      const vAfter = metricValue(accAfter, metric)
      if (vAfter <= vBefore) continue
      const steps = stepsFor(metric, ctx)
      const was = ladderPosition(steps, vBefore).passed
      const now = ladderPosition(steps, vAfter).passed
      if (!now || now.id === was?.id) continue
      out.push({
        key: milestoneKey(metric, period, now.id),
        metric,
        period,
        step: now,
        value: vAfter,
        phrase: withPeriod(kind, stepPhrase(metric, now, vAfter, ctx.home)),
        valueLabel: formatMetricValue(metric, vAfter),
        score: PERIOD_SCORE[kind] + METRIC_SCORE[metric] + now.value / (now.value + 1e9),
      })
    }
  }
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

// Como máximo 1 pop-up: el más llamativo que no se haya enseñado. Todas las claves nuevas se
// marcan como vistas (así el resto no salta en la siguiente sesión repitiendo la misma idea).
export function pickMilestone(candidates: MilestoneCandidate[], shown: Set<string>) {
  const fresh = candidates.filter((c) => !shown.has(c.key))
  return { best: fresh[0] ?? null, keys: fresh.map((c) => c.key) }
}

// La mejor equivalencia de un periodo (para el resumen del mes).
export function bestEquivalence(acc: Accumulated, ctx: EquivalenceContext) {
  let best: Equivalence | null = null
  let bestScore = -1
  for (const metric of METRICS) {
    const eq = equivalenceFor(metric, metricValue(acc, metric), ctx)
    if (!eq.position.passed) continue
    const score = METRIC_SCORE[metric]
    if (score > bestScore) {
      best = eq
      bestScore = score
    }
  }
  return best
}

// Acumulados de un periodo concreto (atajo para la UI).
export function accumulatedFor(sessions: SessionLogEntry[], kind: PeriodKind, day: DateKey) {
  return accumulate(sessions, periodFor(kind, day))
}

// Frases vistas por una persona vinculada: «Has corrido…» → «Ha corrido…» (fase 7A).
export function thirdPerson(text: string) {
  return text
    .replace(/\b([Hh])as\b/g, '$1a')
    .replace(/\b([Ll])levas\b/g, '$1leva')
    .replace(/\btu ciudad\b/g, 'su ciudad')
}
