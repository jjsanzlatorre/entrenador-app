// Funciones de servidor del entrenador IA (fases 6A y 6B). Las claves del proveedor solo existen
// aquí. Aceptar o descartar una propuesta no necesita la IA: lo hace el cliente con RPC (0024).
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  aiFailure,
  CHAT_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE,
  chatPlanRequestSchema,
  type AiResult,
  type AiStatus,
  type ChatActionResults,
  type ChatResult,
  type PlanProposal,
} from '@/lib/ai/schemas'
import { cardsSummary, chatTier } from '@/lib/ai/chat-text'
import { recommendTemplate } from '@/lib/plan/recommend'
import { parseStructure } from '@/lib/plan/schema'
import { authMiddleware } from './middleware'
import { getSupabaseServerClient } from './supabase.server'
import {
  chatReply,
  proposeChatPlan,
  proposeDailyAdjust,
  proposePlan,
  proposeSwap,
  pendingToday,
  weeklyReview,
  type CoachDeps,
} from './ai/coach'
import { getAiConfig, modelFor, PLAN_TIMEOUTS, type AiTier, type AiTimeouts } from './ai/config'
import { loadAiContextInput } from './ai/load-context'
import { createProvider } from './ai/providers'
import { supabaseReviewStore } from './ai/reviews'
import { supabaseModelBlocks, supabaseUsageStore } from './ai/usage'

const dayInput = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tz: z.string().min(1).max(64),
})

// tier heavy: generar o personalizar un plan (también el create_plan del chat) y revisión
// semanal, con GEMINI_MODEL_HEAVY si existe. El resto usa el modelo normal. Con Gemini el
// proveedor es una cadena (pesado → normal → reserva) con presupuesto de tiempo desde aquí y los
// modelos bloqueados por cuota compartidos (0035).
function setup(tz: string, tier: AiTier = 'light', timeouts?: AiTimeouts) {
  const config = getAiConfig()
  const supabase = getSupabaseServerClient()
  const usage = supabaseUsageStore(supabase, {
    dailyLimit: config.dailyLimit,
    tz,
    provider: config.provider,
    model: modelFor(config, tier),
  })
  const provider = createProvider(config, tier, {
    blocks: supabaseModelBlocks(supabase),
    timeouts,
  })
  const deps: CoachDeps | null = provider
    ? { provider, usage, dailyLimit: config.dailyLimit }
    : null
  return { config, supabase, usage, provider, deps }
}

export const getAiStatus = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ tz: z.string().min(1).max(64) }))
  .handler(async ({ data }): Promise<AiStatus> => {
    const { config, usage } = setup(data.tz)
    let usedToday = 0
    try {
      usedToday = await usage.usedToday()
    } catch (error) {
      console.error('[ai] no se pudo leer el uso de hoy', error)
    }
    return {
      configured: config.configured,
      provider: config.provider,
      model: config.model,
      limit: config.dailyLimit,
      usedToday,
    }
  })

// Generar o adaptar un plan. templateId = plantilla elegida; null = «recomiéndame» (se parte de
// la plantilla recomendada por reglas, si la hay).
export const generatePlanProposal = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ templateId: z.string().min(1).max(80).nullable() }))
  .handler(async ({ data, context }) => {
    const { supabase, deps } = setup(data.tz, 'heavy', PLAN_TIMEOUTS)
    if (!deps) return aiFailure('not_configured')
    try {
      const input = await loadAiContextInput(supabase, {
        userId: context.auth.userId,
        profile: context.auth.profile,
        today: data.today,
        tz: data.tz,
      })
      const { data: rows, error } = await supabase.from('plan_templates').select('*')
      if (error) throw new Error(error.message)
      const templates = rows.flatMap((r) => {
        const structure = parseStructure(r.structure)
        return structure ? [{ ...r, structure }] : []
      })
      const chosen = data.templateId
        ? templates.find((t) => t.id === data.templateId)
        : input.training
          ? recommendTemplate(input.training, templates)?.template
          : undefined
      const base = chosen ? { id: chosen.id, name: chosen.name, structure: chosen.structure } : null
      return await proposePlan(deps, { data: input, base })
    } catch (error) {
      console.error('[ai] plan', error)
      return aiFailure('failed')
    }
  })

// Ajuste del día: la sesión planificada pendiente de hoy (la indicada o la primera).
export const proposeTodayAdjust = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ plannedId: z.string().min(1).max(64).nullable() }))
  .handler(async ({ data, context }) => {
    const { supabase, deps } = setup(data.tz)
    if (!deps) return aiFailure('not_configured')
    try {
      const input = await loadAiContextInput(supabase, {
        userId: context.auth.userId,
        profile: context.auth.profile,
        today: data.today,
        tz: data.tz,
      })
      return await proposeDailyAdjust(deps, {
        data: input,
        today: pendingToday(input.planned, data.today, data.plannedId),
      })
    } catch (error) {
      console.error('[ai] ajuste del día', error)
      return aiFailure('failed')
    }
  })

// Revisión semanal: la guardada de la semana pasada o, con generate, una nueva (una vez por
// semana). force = «Regenerar» (gasta una consulta).
export const getWeeklyReview = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ generate: z.boolean(), force: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { config, supabase, usage, provider } = setup(data.tz, 'heavy')
    try {
      return await weeklyReview(
        {
          provider,
          usage,
          dailyLimit: config.dailyLimit,
          reviews: supabaseReviewStore(supabase, context.auth.userId),
        },
        {
          today: data.today,
          generate: data.generate,
          force: data.force,
          load: () =>
            loadAiContextInput(supabase, {
              userId: context.auth.userId,
              profile: context.auth.profile,
              today: data.today,
              tz: data.tz,
            }),
        },
      )
    } catch (error) {
      console.error('[ai] revisión semanal', error)
      return aiFailure('failed')
    }
  })

// Chat: envía los últimos mensajes guardados + el nuevo; si la IA responde bien, se guardan
// los dos (save_chat_turn). Si falla, no se guarda nada y el texto sigue en el móvil.
// Si el mensaje pide planificar varios días o sesiones, responde el modelo pesado
// (GEMINI_MODEL_HEAVY); si no, el normal.
export const sendChatMessage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ text: z.string().trim().min(1).max(CHAT_MAX_MESSAGE) }))
  .handler(async ({ data, context }) => {
    const tier = chatTier(data.text)
    const { supabase, deps } = setup(data.tz, tier)
    if (!deps) return aiFailure('not_configured')
    try {
      const [input, recent] = await Promise.all([
        loadAiContextInput(supabase, {
          userId: context.auth.userId,
          profile: context.auth.profile,
          today: data.today,
          tz: data.tz,
        }),
        supabase
          .from('ai_chat_messages')
          .select('role, content, interaction_id')
          .eq('user_id', context.auth.userId)
          .order('seq', { ascending: false })
          .limit(CHAT_HISTORY_MESSAGES),
      ])
      if (recent.error) throw new Error(recent.error.message)
      // Tarjetas que vio el usuario en cada respuesta: así la IA sabe si las hubo o no.
      const ids = (recent.data ?? []).flatMap((m) =>
        m.role === 'assistant' && m.interaction_id ? [m.interaction_id] : [],
      )
      const outputs = new Map<string, Partial<ChatResult> | null>()
      if (ids.length > 0) {
        const { data: rows, error } = await supabase
          .from('ai_interactions')
          .select('id, output')
          .in('id', ids)
        if (error) console.error('[ai] no se pudieron leer las tarjetas del chat', error.message)
        for (const r of rows ?? []) outputs.set(r.id, r.output as Partial<ChatResult> | null)
      }
      const history = (recent.data ?? []).reverse().map((m) => {
        const text = m.content.slice(0, 800)
        const cards =
          m.role === 'assistant' && m.interaction_id
            ? cardsSummary(outputs.get(m.interaction_id))
            : null
        return { role: m.role, text: cards ? `${text}\n${cards}` : text }
      })
      const res = await chatReply(deps, { data: input, message: data.text, history, tier })
      if (res.ok) {
        const saved = await supabase.rpc('save_chat_turn', {
          p_interaction: res.interactionId,
          p_user_text: data.text,
        })
        if (saved.error) console.error('[ai] no se pudo guardar el chat', saved.error.message)
      }
      return res
    } catch (error) {
      console.error('[ai] chat', error)
      return aiFailure('failed')
    }
  })

// Plan de un create_plan del chat: se genera con el mismo flujo que «Personalizar con IA» a
// partir de la petición guardada en la respuesta del chat (no la del cliente) y se enlaza con
// ella (link_chat_plan). Si ya se generó, se devuelve el guardado sin gastar consulta.
export const prepareChatPlan = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ chatInteractionId: z.string().uuid() }))
  .handler(
    async ({ data, context }): Promise<AiResult<{ proposal: PlanProposal; cached: boolean }>> => {
      const { config, supabase, usage, deps } = setup(data.tz, 'heavy', PLAN_TIMEOUTS)
      const userId = context.auth.userId
      try {
        const { data: row, error } = await supabase
          .from('ai_interactions')
          .select('id, kind, status, output, action_results')
          .eq('id', data.chatInteractionId)
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw new Error(error.message)
        const request = chatPlanRequestSchema.safeParse(
          (row?.output as { plan_request?: unknown } | null)?.plan_request,
        )
        if (!row || row.kind !== 'chat' || row.status !== 'ok' || !request.success) {
          return aiFailure('failed', 'Esta respuesta no propone ningún plan.')
        }
        const done = (row.action_results as ChatActionResults | null)?.plan
        if (done?.status === 'accepted') return aiFailure('failed', 'Este plan ya se ha creado.')
        if (done?.status === 'discarded') {
          return aiFailure('failed', 'Descartaste esta propuesta de plan.')
        }
        if (done?.status === 'prepared') {
          const { data: prepared, error: e2 } = await supabase
            .from('ai_interactions')
            .select('id, output')
            .eq('id', done.interaction_id)
            .eq('user_id', userId)
            .maybeSingle()
          if (e2) throw new Error(e2.message)
          const proposal = (prepared?.output as { proposal?: PlanProposal } | null)?.proposal
          if (prepared && proposal) {
            let used = 0
            try {
              used = await usage.usedToday()
            } catch {
              used = config.dailyLimit
            }
            return {
              ok: true,
              interactionId: prepared.id,
              remaining: Math.max(0, config.dailyLimit - used),
              proposal,
              cached: true,
            }
          }
        }
        if (!deps) return aiFailure('not_configured')

        const [input, templates] = await Promise.all([
          loadAiContextInput(supabase, {
            userId,
            profile: context.auth.profile,
            today: data.today,
            tz: data.tz,
          }),
          supabase.from('plan_templates').select('*'),
        ])
        if (templates.error) throw new Error(templates.error.message)
        const list = templates.data.flatMap((r) => {
          const structure = parseStructure(r.structure)
          return structure ? [{ ...r, structure }] : []
        })
        const res = await proposeChatPlan(deps, {
          data: input,
          request: request.data,
          templates: list,
        })
        if (!res.ok) return res
        const linked = await supabase.rpc('link_chat_plan', {
          p_chat: data.chatInteractionId,
          p_plan: res.interactionId,
        })
        if (linked.error) throw new Error(linked.error.message)
        return { ...res, cached: false }
      } catch (error) {
        console.error('[ai] plan del chat', error)
        return aiFailure('failed')
      }
    },
  )

// Sustituir ejercicio con IA: solo si las reglas no encuentran alternativa.
export const proposeExerciseSwap = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ exerciseId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const { supabase, deps } = setup(data.tz)
    if (!deps) return aiFailure('not_configured')
    try {
      const input = await loadAiContextInput(supabase, {
        userId: context.auth.userId,
        profile: context.auth.profile,
        today: data.today,
        tz: data.tz,
      })
      return await proposeSwap(deps, { data: input, exerciseId: data.exerciseId })
    } catch (error) {
      console.error('[ai] sustituir ejercicio', error)
      return aiFailure('failed')
    }
  })
