// Revisión semanal (CLAUDE.md §11.4): los datos de la semana revisada salen de este cálculo
// determinista (adherencia, carga, ACWR, músculos, récords); la IA solo los comenta y propone
// recomendaciones y cambios. Función pura.
import { weekAdherence } from '@/lib/progress/adherence'
import { acuteChronicRatio, loadBetween, type AcwrStatus } from '@/lib/progress/load'
import { addDays, weekStartOf, type DateKey } from '@/lib/progress/dates'
import { MUSCLE_IDS, muscleVolume } from '@/lib/progress/muscle-volume'
import type { ActivityDay, Commitment } from '@/lib/progress/types'
import type { PrType, SessionType } from '@/types/database'
import type { AiContextInput, ContextSession } from './context'

// Más de 20 series efectivas en la semana: el tramo más alto del mapa muscular (§12, fase 4).
export const OVERLOAD_SETS = 20

export type ReviewFacts = {
  weekStart: DateKey
  weekEnd: DateKey
  sessions: number
  minutes: number
  byType: Partial<Record<SessionType, number>>
  // Compromiso de esa semana (null si no había).
  commitment: { committed: number; counted: number; extra: number; pct: number } | null
  // Sesiones del plan de esa semana (null sin plan).
  plan: { done: number; planned: number } | null
  load: number
  previousLoad: number
  missingRpe: number
  // Ratio agudo:crónico al acabar la semana.
  acwr: { ratio: number | null; status: AcwrStatus }
  // 0 series en la semana revisada y en la anterior (solo con historial suficiente).
  neglected: string[]
  overloaded: { muscleId: string; sets: number }[]
  prs: { exercise: string; type: PrType; value: number; unit: string; date: DateKey }[]
}

// Semana que se revisa: la anterior a la de hoy (lunes a domingo).
export function reviewWeekOf(today: DateKey) {
  return addDays(weekStartOf(today), -7)
}

const round1 = (n: number) => Math.round(n * 10) / 10

// Las funciones de carga agrupan por día local de startedAt: mediodía UTC cae en el mismo día
// en cualquier zona horaria de ±11 h.
function asLoadSession(s: ContextSession) {
  const iso = `${s.date}T12:00:00.000Z`
  return {
    id: s.id,
    sessionType: s.sessionType,
    startedAt: iso,
    endedAt: iso,
    durationMin: s.durationMin ?? 0,
    rpe: s.rpe,
  }
}

export function computeReviewFacts(
  input: AiContextInput & { commitments?: Commitment[] },
  weekStart: DateKey,
): ReviewFacts {
  const weekEnd = addDays(weekStart, 6)
  const inWeek = input.sessions.filter((s) => s.date >= weekStart && s.date <= weekEnd)
  const byType: Partial<Record<SessionType, number>> = {}
  for (const s of inWeek) byType[s.sessionType] = (byType[s.sessionType] ?? 0) + 1

  const commitments = input.commitments ?? (input.commitment ? [input.commitment] : [])
  const days: ActivityDay[] = inWeek.map((s) => ({
    day: s.date,
    sessionType: s.sessionType,
    minutes: s.durationMin,
  }))
  const adherence = weekAdherence(commitments, days, weekStart)

  const plannedInWeek = (input.plan?.sessions ?? []).filter(
    (p) => p.date >= weekStart && p.date <= weekEnd,
  )

  const loadSessions = input.sessions.map(asLoadSession)
  const load = loadBetween(loadSessions, weekStart, weekEnd)
  const previous = loadBetween(loadSessions, addDays(weekStart, -7), addDays(weekStart, -1))
  const acwr = acuteChronicRatio(loadSessions, weekEnd, { hasActivePlan: input.plan !== null })

  const catalog = new Map(input.exercises.map((e) => [e.id, { muscles: e.muscles }]))
  const volume = (from: DateKey, to: DateKey) =>
    muscleVolume(
      loadSessions.filter(
        (s) => s.startedAt.slice(0, 10) >= from && s.startedAt.slice(0, 10) <= to,
      ),
      input.setCounts,
      catalog,
    )
  const thisWeek = volume(weekStart, weekEnd)
  const weekBefore = volume(addDays(weekStart, -7), addDays(weekStart, -1))
  const first = input.sessions.reduce<DateKey | null>(
    (min, s) => (min === null || s.date < min ? s.date : min),
    null,
  )
  const neglected =
    first !== null && first < addDays(weekStart, -7)
      ? MUSCLE_IDS.filter(
          (id) => (thisWeek.get(id)?.sets ?? 0) === 0 && (weekBefore.get(id)?.sets ?? 0) === 0,
        )
      : []
  const overloaded = MUSCLE_IDS.flatMap((id) => {
    const sets = thisWeek.get(id)?.sets ?? 0
    return sets > OVERLOAD_SETS ? [{ muscleId: id, sets: round1(sets) }] : []
  })

  const names = new Map(input.exercises.map((e) => [e.id, e.name]))
  return {
    weekStart,
    weekEnd,
    sessions: inWeek.length,
    minutes: inWeek.reduce((sum, s) => sum + (s.durationMin ?? 0), 0),
    byType,
    commitment:
      adherence.pct === null
        ? null
        : {
            committed: adherence.committed,
            counted: adherence.counted,
            extra: adherence.extra,
            pct: Math.round(adherence.pct * 100),
          },
    plan: input.plan
      ? {
          done: plannedInWeek.filter((p) => p.status === 'done').length,
          planned: plannedInWeek.length,
        }
      : null,
    load: Math.round(load.load),
    previousLoad: Math.round(previous.load),
    missingRpe: load.missingRpe,
    acwr: {
      ratio: acwr.ratio === null ? null : Math.round(acwr.ratio * 100) / 100,
      status: acwr.status,
    },
    neglected,
    overloaded,
    prs: input.prs
      .filter((p) => p.date >= weekStart && p.date <= weekEnd)
      .map((p) => ({
        exercise: names.get(p.exerciseId) ?? p.exerciseId,
        type: p.prType,
        value: round1(p.value),
        unit: p.unit,
        date: p.date,
      })),
  }
}

// Sin sesiones ni plan esa semana no hay nada que revisar (no se gasta una consulta).
export function hasSomethingToReview(facts: ReviewFacts) {
  return facts.sessions > 0 || (facts.plan !== null && facts.plan.planned > 0)
}
