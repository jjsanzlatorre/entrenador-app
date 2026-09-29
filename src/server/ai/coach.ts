// Tareas del entrenador IA de la fase 6A: generar/adaptar plan y ajuste del día.
// Sin dependencias de TanStack ni de Supabase: el proveedor y el registro se inyectan (tests).
import {
  buildAiContext,
  summarizeContext,
  type AiContextInput,
  type ContextPlanned,
} from '@/lib/ai/context'
import {
  aiFailure,
  aiPlanSchema,
  dailyAdjustSchema,
  toPlanStructure,
  type AdjustProposal,
  type AiResult,
  type PlanProposal,
} from '@/lib/ai/schemas'
import {
  adjustIssues,
  attachStandards,
  dropUnknownFromAdjust,
  dropUnknownFromPlan,
  planIssues,
} from '@/lib/ai/validate'
import type { PlanStructure } from '@/lib/plan/types'
import type { AiInteractionKind } from '@/types/database'
import { DAILY_ADJUST_PROMPT, planPrompt, SYSTEM_PROMPT } from './prompts'
import { AiProviderError, type AiProvider } from './providers/types'
import { AiInvalidOutputError, generateStructured, type StructuredResult } from './structured'
import { DailyLimitError, type UsageStore } from './usage'

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
): Promise<AiResult<R>> {
  let id: string
  try {
    id = await deps.usage.begin(kind, inputSummary)
  } catch (error) {
    if (error instanceof DailyLimitError) return aiFailure('daily_limit')
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
    })
    return { ok: true, interactionId: id, remaining: await remaining(), ...value }
  } catch (error) {
    const tokens = error as { tokensIn?: number; tokensOut?: number }
    if (error instanceof AiInvalidOutputError) {
      await deps.usage.finish(id, {
        status: 'invalid',
        error: error.message,
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
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
