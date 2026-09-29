// Comprobaciones de las propuestas de la IA que Zod no puede hacer solo: que cada exercise_id
// exista en la biblioteca. Si la IA inventa uno, primero se reintenta con el error; si vuelve a
// pasar, se descarta ese ejercicio (y el bloque o la sesión que se queden vacíos).
import type { PlanStructure } from '@/lib/plan/types'
import type { DateKey } from '@/lib/progress/dates'
import type { AiPlan, DailyAdjust, PlanChange, SwapAi } from './schemas'

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

// ── Cambios del plan (revisión semanal y chat) ──────────────

export type ChangeRules = {
  known: Set<string>
  // Sesiones planificadas pendientes que se pueden cambiar: id → día.
  pending: Map<string, DateKey>
  hasPlan: boolean
  // Días permitidos para mover o añadir (incluidos).
  from: DateKey
  to: DateKey
}

// Motivos por los que un cambio no se puede aplicar (sin contar ejercicios inventados).
function changeProblem(c: PlanChange, rules: ChangeRules, seen: Set<string>): string | null {
  if (!rules.hasPlan) return 'No hay plan activo: no propongas cambios del plan (changes vacío).'
  if (c.action !== 'add') {
    const id = c.planned_session_id ?? ''
    if (!rules.pending.has(id)) {
      return `planned_session_id «${id}» no es una sesión pendiente de upcoming_sessions.`
    }
    if (seen.has(id)) return `Hay dos cambios para la misma sesión (${id}): deja uno.`
    seen.add(id)
  }
  if (c.action === 'move' || c.action === 'add') {
    const date = c.date ?? ''
    if (date < rules.from || date > rules.to) {
      return `La fecha ${date} está fuera de rango: usa un día entre ${rules.from} y ${rules.to}.`
    }
    if (c.action === 'move' && rules.pending.get(c.planned_session_id ?? '') === date) {
      return `Mover la sesión ${c.planned_session_id} al mismo día (${date}) no cambia nada.`
    }
  }
  return null
}

export function changeIssues(changes: PlanChange[], rules: ChangeRules) {
  const seen = new Set<string>()
  const issues = changes.flatMap((c, i) => {
    const p = changeProblem(c, rules, seen)
    return p ? [`changes.${i}: ${p}`] : []
  })
  const sessions = changes.flatMap((c) => (c.session ? [c.session] : []))
  return [...issues, ...unknownExerciseIssues(unknownIn(sessions, rules.known))]
}

// Quita los cambios que no se pueden aplicar y los ejercicios inventados (si una sesión se
// queda vacía, se quita su cambio). Nunca falla: en el peor caso no quedan cambios.
export function dropInvalidChanges(changes: PlanChange[], rules: ChangeRules) {
  const seen = new Set<string>()
  const dropped = unknownIn(
    changes.flatMap((c) => (c.session ? [c.session] : [])),
    rules.known,
  )
  let removed = 0
  const kept = changes.flatMap((c) => {
    if (changeProblem(c, rules, seen)) {
      removed++
      return []
    }
    if (!c.session) return [c]
    const session = dropFrom(c.session, rules.known)
    if (!session) {
      removed++
      return []
    }
    return [{ ...c, session }]
  })
  return { changes: kept, dropped, removed }
}

// ── Sustituir ejercicio ─────────────────────────────────────

export function swapIssues(swap: SwapAi, known: Set<string>, targetId: string) {
  const issues = unknownExerciseIssues(
    [...new Set(swap.alternatives.map((a) => a.exercise_id))].filter((id) => !known.has(id)),
  )
  if (swap.alternatives.some((a) => a.exercise_id === targetId)) {
    issues.push(`No propongas el mismo ejercicio que se quiere sustituir (${targetId}).`)
  }
  return issues
}

// Deja solo alternativas existentes, distintas del original y sin repetir. null si no queda
// ninguna.
export function dropInvalidAlternatives(swap: SwapAi, known: Set<string>, targetId: string) {
  const seen = new Set<string>()
  const alternatives = swap.alternatives.filter((a) => {
    if (!known.has(a.exercise_id) || a.exercise_id === targetId || seen.has(a.exercise_id)) {
      return false
    }
    seen.add(a.exercise_id)
    return true
  })
  return alternatives.length > 0 ? { alternatives } : null
}
