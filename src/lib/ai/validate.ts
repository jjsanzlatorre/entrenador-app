// Comprobaciones de las propuestas de la IA que Zod no puede hacer solo: que cada exercise_id
// exista en la biblioteca. Si la IA inventa uno, primero se reintenta con el error; si vuelve a
// pasar, se descarta ese ejercicio (y el bloque o la sesión que se queden vacíos).
import type { PlanStructure } from '@/lib/plan/types'
import type { DateKey } from '@/lib/progress/dates'
import {
  CHAT_SESSION_ACTIONS,
  type AiPlan,
  type ChatAction,
  type ChatResult,
  type DailyAdjust,
  type PlanChange,
  type SwapAi,
} from './schemas'

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

// ── Acciones del chat ───────────────────────────────────────

export type ChatActionRules = ChangeRules & {
  // ids de plan_templates (create_plan.template_id).
  templates: Set<string>
  // Sesión planificada pendiente de hoy (adjust_today), si la hay.
  todayPending: string | null
}

// Problema de una acción: `model` va al reintento; `user` se enseña si se descarta.
type ActionProblem = { model: string; user: string }

// Acción de sesiones del chat → cambio del plan (formato de respond_ai_change).
export function chatActionToChange(a: ChatAction): PlanChange | null {
  const action = CHAT_SESSION_ACTIONS[a.type]
  if (!action) return null
  return {
    action,
    title: a.title,
    reason: a.reason,
    ...(a.planned_session_id !== undefined ? { planned_session_id: a.planned_session_id } : {}),
    ...(a.date !== undefined ? { date: a.date } : {}),
    ...(a.session !== undefined && (action === 'add' || action === 'modify')
      ? { session: a.session }
      : {}),
  }
}

function missingFields(a: ChatAction): string | null {
  switch (a.type) {
    case 'create_plan':
      return a.plan ? null : 'plan'
    case 'adjust_today':
      return null
    case 'add_session':
      if (!a.date) return 'date'
      if (!a.session) return 'session'
      return a.session.session_type ? null : 'session.session_type'
    case 'move_session':
      if (!a.planned_session_id) return 'planned_session_id'
      return a.date ? null : 'date'
    case 'skip_session':
      return a.planned_session_id ? null : 'planned_session_id'
    case 'modify_session':
      if (!a.planned_session_id) return 'planned_session_id'
      return a.session ? null : 'session'
  }
}

function chatActionProblem(
  a: ChatAction,
  rules: ChatActionRules,
  state: { seen: Set<string>; plan: boolean; adjust: boolean; withPlan: boolean },
): ActionProblem | null {
  const missing = missingFields(a)
  if (missing) {
    return {
      model: `con ${a.type} hay que indicar ${missing}.`,
      user: 'le faltaban datos',
    }
  }
  if (a.type === 'create_plan') {
    if (state.plan) {
      return { model: 'Propón como mucho un create_plan.', user: 'ya había otro plan propuesto' }
    }
    state.plan = true
    return null
  }
  if (state.withPlan) {
    return {
      model:
        'Con create_plan no propongas otras acciones: el plan nuevo sustituye al actual (deja solo create_plan).',
      user: 'no tiene sentido junto a un plan nuevo',
    }
  }
  if (a.type === 'adjust_today') {
    if (!rules.todayPending) {
      return {
        model: 'Hoy no hay ninguna sesión planificada pendiente: no propongas adjust_today.',
        user: 'hoy no tienes ninguna sesión pendiente en el plan',
      }
    }
    if (state.adjust) {
      return { model: 'Propón como mucho un adjust_today.', user: 'estaba repetida' }
    }
    if (state.seen.has(rules.todayPending)) {
      return {
        model: `Hay dos acciones para la sesión de hoy (${rules.todayPending}): deja una.`,
        user: 'había otra propuesta para la sesión de hoy',
      }
    }
    state.adjust = true
    state.seen.add(rules.todayPending)
    return null
  }
  const change = chatActionToChange(a)!
  const problem = changeProblem(change, rules, state.seen)
  if (!problem) return null
  return {
    model: problem,
    user: !rules.hasPlan
      ? 'no tienes un plan activo'
      : change.action !== 'add' && !rules.pending.has(change.planned_session_id ?? '')
        ? 'esa sesión no está pendiente en tu plan'
        : 'la fecha no es válida',
  }
}

function newState(actions: ChatAction[]) {
  return {
    seen: new Set<string>(),
    plan: false,
    adjust: false,
    withPlan: actions.some((a) => a.type === 'create_plan' && a.plan),
  }
}

function templateIssue(a: ChatAction, rules: ChatActionRules) {
  const id = a.type === 'create_plan' ? a.plan?.template_id : undefined
  return id !== undefined && !rules.templates.has(id) ? id : null
}

// Problemas de las acciones (para el reintento), incluidos los ejercicios inventados.
export function chatActionIssues(actions: ChatAction[], rules: ChatActionRules) {
  const state = newState(actions)
  const issues = actions.flatMap((a, i) => {
    const p = chatActionProblem(a, rules, state)
    const out = p ? [`actions.${i}: ${p.model}`] : []
    const template = templateIssue(a, rules)
    if (template) {
      out.push(`actions.${i}: plan.template_id «${template}» no existe en plan_templates.`)
    }
    return out
  })
  const sessions = actions.flatMap((a) => (a.session ? [a.session] : []))
  return [...issues, ...unknownExerciseIssues(unknownIn(sessions, rules.known))]
}

// Convierte las acciones en lo que se guarda (ChatResult sin `reply`): quita las que no se pueden
// aplicar (con un aviso para el usuario) y los ejercicios inventados. Nunca falla.
export function resolveChatActions(
  actions: ChatAction[],
  rules: ChatActionRules,
): Omit<ChatResult, 'reply'> {
  const state = newState(actions)
  const dropped = unknownIn(
    actions.flatMap((a) => (a.session ? [a.session] : [])),
    rules.known,
  )
  const discarded: string[] = []
  const result: Omit<ChatResult, 'reply'> = { changes: [], dropped }
  for (const a of actions) {
    const problem = chatActionProblem(a, rules, state)
    if (problem) {
      discarded.push(`«${a.title}»: ${problem.user}.`)
      continue
    }
    if (a.type === 'create_plan' && a.plan) {
      const { template_id, ...plan } = a.plan
      result.plan_request = {
        ...plan,
        ...(template_id !== undefined && rules.templates.has(template_id) ? { template_id } : {}),
        title: a.title,
        reason: a.reason,
      }
      continue
    }
    if (a.type === 'adjust_today' && rules.todayPending) {
      result.adjust_today = {
        title: a.title,
        reason: a.reason,
        planned_session_id: rules.todayPending,
      }
      continue
    }
    const change = chatActionToChange(a)!
    if (!change.session) {
      result.changes.push(change)
      continue
    }
    const session = dropFrom(change.session, rules.known)
    if (!session) {
      discarded.push(`«${a.title}»: usaba ejercicios que no están en tu biblioteca.`)
      continue
    }
    result.changes.push({ ...change, session })
  }
  if (discarded.length > 0) result.discarded = discarded
  return result
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
