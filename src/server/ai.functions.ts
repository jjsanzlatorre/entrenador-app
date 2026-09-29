// Funciones de servidor del entrenador IA (fases 6A y 6B). Las claves del proveedor solo existen
// aquí. Aceptar o descartar una propuesta no necesita la IA: lo hace el cliente con RPC (0024).
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { aiFailure, CHAT_HISTORY_MESSAGES, CHAT_MAX_MESSAGE, type AiStatus } from '@/lib/ai/schemas'
import { recommendTemplate } from '@/lib/plan/recommend'
import { parseStructure } from '@/lib/plan/schema'
import { authMiddleware } from './middleware'
import { getSupabaseServerClient } from './supabase.server'
import {
  chatReply,
  proposeDailyAdjust,
  proposePlan,
  proposeSwap,
  pendingToday,
  weeklyReview,
  type CoachDeps,
} from './ai/coach'
import { getAiConfig } from './ai/config'
import { loadAiContextInput } from './ai/load-context'
import { createProvider } from './ai/providers'
import { supabaseReviewStore } from './ai/reviews'
import { supabaseUsageStore } from './ai/usage'

const dayInput = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tz: z.string().min(1).max(64),
})

function setup(tz: string) {
  const config = getAiConfig()
  const supabase = getSupabaseServerClient()
  const usage = supabaseUsageStore(supabase, {
    dailyLimit: config.dailyLimit,
    tz,
    provider: config.provider,
    model: config.model,
  })
  const provider = createProvider(config)
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
    const { supabase, deps } = setup(data.tz)
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
    const { config, supabase, usage, provider } = setup(data.tz)
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
export const sendChatMessage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(dayInput.extend({ text: z.string().trim().min(1).max(CHAT_MAX_MESSAGE) }))
  .handler(async ({ data, context }) => {
    const { supabase, deps } = setup(data.tz)
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
          .select('role, content')
          .eq('user_id', context.auth.userId)
          .order('seq', { ascending: false })
          .limit(CHAT_HISTORY_MESSAGES),
      ])
      if (recent.error) throw new Error(recent.error.message)
      const history = (recent.data ?? [])
        .reverse()
        .map((m) => ({ role: m.role, text: m.content.slice(0, 800) }))
      const res = await chatReply(deps, { data: input, message: data.text, history })
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
