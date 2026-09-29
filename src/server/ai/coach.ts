// Tareas del entrenador IA: generar/adaptar plan y ajuste del día (6A); revisión semanal, chat
// y sustituir ejercicio (6B).
// Sin dependencias de TanStack ni de Supabase: el proveedor y el registro se inyectan (tests).
import {
  buildAiContext,
  exerciseLines,
  summarizeContext,
  upcomingSessions,
  type AiContextInput,
  type ContextPlanned,
} from '@/lib/ai/context'
import { computeReviewFacts, hasSomethingToReview, reviewWeekOf } from '@/lib/ai/review'
import {
  aiFailure,
  aiPlanSchema,
  chatReplySchema,
  dailyAdjustSchema,
  swapSchema,
  toPlanStructure,
  weeklyReviewSchema,
  type AdjustProposal,
  type AiResult,
  type ChangeResponses,
  type PlanChange,
  type PlanProposal,
  type SwapProposal,
  type WeeklyReview,
} from '@/lib/ai/schemas'
import {
  adjustIssues,
  attachStandards,
  changeIssues,
  dropInvalidAlternatives,
  dropInvalidChanges,
  dropUnknownFromAdjust,
  dropUnknownFromPlan,
  planIssues,
  swapIssues,
  type ChangeRules,
} from '@/lib/ai/validate'
import { addDays, weekStartOf, type DateKey } from '@/lib/progress/dates'
import type { PlanStructure } from '@/lib/plan/types'
import { suggestAlternatives } from '@/lib/workout/substitution'
import type { AiInteractionKind } from '@/types/database'
import {
  CHAT_PROMPT,
  DAILY_ADJUST_PROMPT,
  planPrompt,
  SWAP_PROMPT,
  SYSTEM_PROMPT,
  WEEKLY_REVIEW_PROMPT,
} from './prompts'
import { AiProviderError, type AiProvider } from './providers/types'
import { AiInvalidOutputError, generateStructured, type StructuredResult } from './structured'
import { DailyLimitError, InProgressError, type UsageStore } from './usage'

export type CoachDeps = {
  provider: AiProvider
  usage: UsageStore
  dailyLimit: number
}

// Abre la consulta (límite diario), ejecuta la tarea, la registra y traduce los errores a
// mensajes en español. Nunca lanza: la app sigue funcionando sin IA.
async function runTask<T, R>(
  deps: CoachDeps,
  kind: AiInteractionKind,
  inputSummary: unknown,
  task: () => Promise<StructuredResult<T>>,
  toResult: (result: StructuredResult<T>) => R,
  period?: string,
): Promise<AiResult<R>> {
  let id: string
  try {
    id = await deps.usage.begin(kind, inputSummary, period)
  } catch (error) {
    if (error instanceof DailyLimitError) return aiFailure('daily_limit')
    if (error instanceof InProgressError) return aiFailure('in_progress')
    console.error('[ai] no se pudo registrar la consulta', error)
    return aiFailure('failed')
  }
  const remaining = async () => {
    try {
      return Math.max(0, deps.dailyLimit - (await deps.usage.usedToday()))
    } catch {
      return 0
    }
  }

  try {
    const result = await task()
    const value = toResult(result)
    await deps.usage.finish(id, {
      status: 'ok',
      output: value,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      model: result.model,
    })
    return { ok: true, interactionId: id, remaining: await remaining(), ...value }
  } catch (error) {
    const tokens = error as { tokensIn?: number; tokensOut?: number; model?: string }
    if (error instanceof AiInvalidOutputError) {
      await deps.usage.finish(id, {
        status: 'invalid',
        error: error.message,
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
        model: tokens.model,
      })
      return aiFailure('invalid_output')
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ai] ${kind}`, message)
    await deps.usage.finish(id, { status: 'error', error: message })
    if (error instanceof AiProviderError) {
      switch (error.kind) {
        case 'quota':
          return aiFailure('provider_quota')
        case 'auth':
          return aiFailure('provider_auth')
        case 'blocked':
        case 'truncated':
          return aiFailure('invalid_output')
        default:
          return aiFailure('provider_unavailable')
      }
    }
    return aiFailure('failed')
  }
}

// ── Generar o adaptar plan (plan_generation) ───────────────

export type PlanRequest = {
  data: AiContextInput
  base: { id: string; name: string; structure: PlanStructure } | null
}

export function sessionsPerWeekFor(data: AiContextInput, base: PlanRequest['base']) {
  const available = data.training?.availability.days_per_week ?? null
  const template = base?.structure.weeks[0]?.sessions.length ?? null
  if (available && template) return Math.min(available, template)
  return available ?? template
}

export async function proposePlan(
  deps: CoachDeps,
  req: PlanRequest,
): Promise<AiResult<{ proposal: PlanProposal }>> {
  const known = new Set(req.data.exercises.map((e) => e.id))
  const perWeek = sessionsPerWeekFor(req.data, req.base)
  const context = buildAiContext(req.data, { includeExercises: true, baseTemplate: req.base })
  const maxPerWeek = Math.max(perWeek ?? 5, req.base?.structure.weeks[0]?.sessions.length ?? 0)
  let dropped: string[] = []

  return runTask(
    deps,
    'plan_generation',
    summarizeContext(context),
    () =>
      generateStructured({
        provider: deps.provider,
        schema: aiPlanSchema,
        system: SYSTEM_PROMPT,
        prompt: planPrompt({ hasBase: req.base !== null, sessionsPerWeek: perWeek }),
        context,
        check: (plan) => planIssues(plan, known, maxPerWeek),
        repair: (plan) => {
          const fixed = dropUnknownFromPlan(plan, known)
          if (!fixed || planIssues(fixed.plan, known, maxPerWeek).length > 0) return null
          dropped = fixed.dropped
          return fixed.plan
        },
        maxOutputTokens: 32_768,
        timeoutMs: 55_000,
      }),
    (result) => ({
      proposal: {
        name: result.data.name,
        summary: result.data.summary,
        baseTemplateId: req.base?.id ?? null,
        structure: attachStandards(toPlanStructure(result.data), req.base?.structure ?? null),
        dropped,
      },
    }),
  )
}

// ── Ajuste del día (daily_adjust) ──────────────────────────

export async function proposeDailyAdjust(
  deps: CoachDeps,
  req: { data: AiContextInput; today: ContextPlanned | null },
): Promise<AiResult<{ proposal: AdjustProposal }>> {
  const todaySession = req.today
  if (!todaySession) return aiFailure('no_planned_session')
  const known = new Set(req.data.exercises.map((e) => e.id))
  const context = buildAiContext(req.data, { includeExercises: true, todaySession })
  let dropped: string[] = []

  return runTask(
    deps,
    'daily_adjust',
    summarizeContext(context),
    () =>
      generateStructured({
        provider: deps.provider,
        schema: dailyAdjustSchema,
        system: SYSTEM_PROMPT,
        prompt: DAILY_ADJUST_PROMPT,
        context,
        check: (adjust) => adjustIssues(adjust, known),
        repair: (adjust) => {
          const fixed = dropUnknownFromAdjust(adjust, known)
          if (!fixed) return null
          dropped = fixed.dropped
          return fixed.adjust
        },
        maxOutputTokens: 8192,
        timeoutMs: 40_000,
      }),
    (result) => {
      // keep y rest no llevan sesión aunque la IA la mande.
      const adjust =
        result.data.decision === 'keep' || result.data.decision === 'rest'
          ? { decision: result.data.decision, reason: result.data.reason }
          : result.data
      return { proposal: { plannedSessionId: todaySession.id, adjust, dropped } }
    },
  )
}

// Sesión de hoy pendiente: la pedida o, si no se indica, la primera.
export function pendingToday(planned: ContextPlanned[], today: string, id: string | null = null) {
  return (
    planned.find(
      (p) =>
        p.date === today &&
        (p.status === 'planned' || p.status === 'moved') &&
        (id === null || p.id === id),
    ) ?? null
  )
}

// ── Cambios del plan (revisión semanal y chat) ─────────────

// Reglas para validar los cambios: sesiones pendientes entre `from` y `to`.
export function changeRules(data: AiContextInput, from: DateKey, to: DateKey): ChangeRules {
  return {
    known: new Set(data.exercises.map((e) => e.id)),
    pending: new Map(upcomingSessions(data, from, to).map((s) => [s.id, s.date])),
    hasPlan: data.plan !== null,
    from,
    to,
  }
}

async function remainingFor(usage: UsageStore, dailyLimit: number) {
  try {
    return Math.max(0, dailyLimit - (await usage.usedToday()))
  } catch {
    return 0
  }
}

// ── Revisión semanal (weekly_review) ───────────────────────

// Revisión guardada de una semana (la última, si se regeneró).
export type StoredReview = {
  interactionId: string
  review: WeeklyReview
  responses: ChangeResponses
  createdAt: string
}

export interface ReviewStore {
  latest(weekStart: DateKey): Promise<StoredReview | null>
}

export type ReviewDeps = {
  provider: AiProvider | null
  usage: UsageStore
  dailyLimit: number
  reviews: ReviewStore
}

export type WeeklyReviewResult = {
  review: WeeklyReview
  responses: ChangeResponses
  createdAt: string
  // true = guardada (no ha gastado consulta).
  cached: boolean
}

// Una revisión por semana (la anterior a la de hoy): si ya existe se devuelve la guardada sin
// llamar a la IA. generate = crearla si no existe; force = «Regenerar» (gasta una consulta).
export async function weeklyReview(
  deps: ReviewDeps,
  req: {
    today: DateKey
    generate: boolean
    force: boolean
    load: () => Promise<AiContextInput>
    now?: () => Date
  },
): Promise<AiResult<WeeklyReviewResult>> {
  const weekStart = reviewWeekOf(req.today)
  if (!req.force) {
    const stored = await deps.reviews.latest(weekStart)
    if (stored) {
      return {
        ok: true,
        interactionId: stored.interactionId,
        remaining: await remainingFor(deps.usage, deps.dailyLimit),
        review: stored.review,
        responses: stored.responses,
        createdAt: stored.createdAt,
        cached: true,
      }
    }
    if (!req.generate) return aiFailure('not_generated')
  }
  const provider = deps.provider
  if (!provider) return aiFailure('not_configured')

  const data = await req.load()
  const facts = computeReviewFacts(data, weekStart)
  if (!hasSomethingToReview(facts)) return aiFailure('no_data')

  const weekEnd = addDays(weekStartOf(req.today), 6)
  const rules = changeRules(data, req.today, weekEnd)
  const context = buildAiContext(data, {
    includeExercises: true,
    reviewWeek: facts,
    upcoming: { from: req.today, to: weekEnd },
  })
  let dropped: string[] = []

  const result = await runTask(
    { provider, usage: deps.usage, dailyLimit: deps.dailyLimit },
    'weekly_review',
    summarizeContext(context),
    () =>
      generateStructured({
        provider,
        schema: weeklyReviewSchema,
        system: SYSTEM_PROMPT,
        prompt: WEEKLY_REVIEW_PROMPT,
        context,
        check: (review) => changeIssues(review.changes, rules),
        repair: (review) => {
          const fixed = dropInvalidChanges(review.changes, rules)
          dropped = fixed.dropped
          return { ...review, changes: fixed.changes }
        },
        maxOutputTokens: 16_384,
        timeoutMs: 50_000,
      }),
    (res): WeeklyReview => {
      const { changes, ...review } = res.data
      return { weekStart, facts, review, changes, dropped }
    },
    weekStart,
  )
  if (!result.ok) return result
  const { ok, interactionId, remaining, ...review } = result
  return {
    ok,
    interactionId,
    remaining,
    review,
    responses: {},
    createdAt: (req.now?.() ?? new Date()).toISOString(),
    cached: false,
  }
}

// ── Chat con el entrenador (chat) ──────────────────────────

// Días en los que el chat puede proponer cambios: de hoy a 2 semanas.
export const CHAT_CHANGE_DAYS = 14

export type ChatResult = { reply: string; changes: PlanChange[]; dropped: string[] }

export async function chatReply(
  deps: CoachDeps,
  req: {
    data: AiContextInput
    message: string
    history: { role: 'user' | 'assistant'; text: string }[]
  },
): Promise<AiResult<ChatResult>> {
  const today = req.data.today
  const to = addDays(today, CHAT_CHANGE_DAYS - 1)
  const rules = changeRules(req.data, today, to)
  const context = buildAiContext(req.data, {
    includeExercises: true,
    upcoming: { from: today, to },
    conversation: req.history,
    message: req.message,
  })
  let dropped: string[] = []

  return runTask(
    deps,
    'chat',
    { ...summarizeContext(context), conversation: req.history.length },
    () =>
      generateStructured({
        provider: deps.provider,
        schema: chatReplySchema,
        system: SYSTEM_PROMPT,
        prompt: CHAT_PROMPT,
        context,
        check: (reply) => changeIssues(reply.changes ?? [], rules),
        repair: (reply) => {
          const fixed = dropInvalidChanges(reply.changes ?? [], rules)
          dropped = fixed.dropped
          return { ...reply, changes: fixed.changes }
        },
        maxOutputTokens: 8192,
        timeoutMs: 40_000,
      }),
    (res): ChatResult => ({ reply: res.data.reply, changes: res.data.changes ?? [], dropped }),
  )
}

// ── Sustituir ejercicio (exercise_swap) ────────────────────

export async function proposeSwap(
  deps: CoachDeps,
  req: { data: AiContextInput; exerciseId: string },
): Promise<AiResult<{ proposal: SwapProposal }>> {
  const target = req.data.exercises.find((e) => e.id === req.exerciseId)
  if (!target) return aiFailure('failed', 'No se ha encontrado el ejercicio que quieres sustituir.')
  const equipment = req.data.training?.equipment ?? []
  // Solo si las reglas no encuentran nada: así no se gasta una consulta sin necesidad.
  if (suggestAlternatives(target, req.data.exercises, equipment).length > 0) {
    return aiFailure('rules_available')
  }
  const known = new Set(req.data.exercises.map((e) => e.id))
  const t = req.data.training
  const context = {
    target: {
      exercise_id: target.id,
      name: target.name,
      category: target.category,
      equipment: target.equipment,
      muscles: target.muscles.map((m) => `${m.muscleId} (${m.role})`),
    },
    athlete: {
      level: t?.level ?? null,
      equipment: equipment.length ? equipment : 'sin indicar',
      places: t?.availability.places ?? [],
      limitations: t?.limitations ?? null,
    },
    exercises: {
      format: 'exercise_id | nombre | categoría | material | músculos principales',
      list: exerciseLines(req.data),
    },
  }

  return runTask(
    deps,
    'exercise_swap',
    { target: target.id, equipment },
    () =>
      generateStructured({
        provider: deps.provider,
        schema: swapSchema,
        system: SYSTEM_PROMPT,
        prompt: SWAP_PROMPT,
        context,
        check: (swap) => swapIssues(swap, known, target.id),
        repair: (swap) => dropInvalidAlternatives(swap, known, target.id),
        maxOutputTokens: 2048,
        timeoutMs: 30_000,
      }),
    (res) => ({ proposal: { exerciseId: target.id, alternatives: res.data.alternatives } }),
  )
}
