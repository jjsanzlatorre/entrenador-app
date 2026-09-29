// Comprobaciones de las propuestas de la IA que Zod no puede hacer solo: que cada exercise_id
// exista en la biblioteca. Si la IA inventa uno, primero se reintenta con el error; si vuelve a
// pasar, se descarta ese ejercicio (y el bloque o la sesión que se queden vacíos).
import type { PlanStructure } from '@/lib/plan/types'
import type { AiPlan, DailyAdjust } from './schemas'

type WithBlocks = { blocks: { exercises: { exercise_id: string }[] }[] }

function unknownIn(items: WithBlocks[], known: Set<string>) {
  const unknown = new Set<string>()
  for (const item of items)
    for (const b of item.blocks)
      for (const e of b.exercises) if (!known.has(e.exercise_id)) unknown.add(e.exercise_id)
  return [...unknown]
}

export function unknownExerciseIssues(ids: string[]) {
  return ids.length === 0
    ? []
    : [
        `Estos exercise_id no existen en la lista de ejercicios: ${ids.join(', ')}. ` +
          'Usa solo ids exactos de la lista.',
      ]
}

function dropFrom<T extends WithBlocks>(item: T, known: Set<string>): T | null {
  const blocks = item.blocks
    .map((b) => ({ ...b, exercises: b.exercises.filter((e) => known.has(e.exercise_id)) }))
    .filter((b) => b.exercises.length > 0)
  return blocks.length > 0 ? { ...item, blocks } : null
}

// ── Plan ────────────────────────────────────────────────────

export function planIssues(plan: AiPlan, known: Set<string>, maxSessionsPerWeek = 7) {
  const issues = unknownExerciseIssues(
    unknownIn(
      plan.weeks.flatMap((w) => w.sessions),
      known,
    ),
  )
  for (const w of plan.weeks) {
    if (w.sessions.length > maxSessionsPerWeek) {
      issues.push(
        `La semana ${w.week} tiene ${w.sessions.length} sesiones; el máximo son ${maxSessionsPerWeek}.`,
      )
    }
  }
  return issues
}

// Quita los ejercicios que no existen. null si alguna semana se queda sin sesiones.
export function dropUnknownFromPlan(plan: AiPlan, known: Set<string>) {
  const dropped = unknownIn(
    plan.weeks.flatMap((w) => w.sessions),
    known,
  )
  const weeks = plan.weeks.map((w) => ({
    ...w,
    sessions: w.sessions.flatMap((s) => {
      const kept = dropFrom(s, known)
      return kept ? [kept] : []
    }),
  }))
  if (weeks.some((w) => w.sessions.length === 0)) return null
  return { plan: { ...plan, weeks }, dropped }
}

// Recupera de la plantilla base los estándares de competición (HYROX/DEKA, por sexo) de los
// ejercicios que la IA mantiene: la IA no los escribe, pero la app los muestra.
export function attachStandards(plan: PlanStructure, base: PlanStructure | null): PlanStructure {
  if (!base) return plan
  const standards = new Map<string, { men: string; women: string }>()
  for (const w of base.weeks)
    for (const s of w.sessions)
      for (const b of s.blocks)
        for (const e of b.exercises)
          if (e.standard && !standards.has(e.exercise_id)) standards.set(e.exercise_id, e.standard)
  if (standards.size === 0) return plan
  return {
    ...plan,
    weeks: plan.weeks.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) => ({
          ...b,
          exercises: b.exercises.map((e) => {
            const standard = standards.get(e.exercise_id)
            return standard ? { ...e, standard } : e
          }),
        })),
      })),
    })),
  }
}

// ── Ajuste del día ──────────────────────────────────────────

export function adjustIssues(adjust: DailyAdjust, known: Set<string>) {
  return adjust.session ? unknownExerciseIssues(unknownIn([adjust.session], known)) : []
}

export function dropUnknownFromAdjust(adjust: DailyAdjust, known: Set<string>) {
  if (!adjust.session) return { adjust, dropped: [] as string[] }
  const dropped = unknownIn([adjust.session], known)
  const session = dropFrom(adjust.session, known)
  if (!session) return null
  return { adjust: { ...adjust, session }, dropped }
}
