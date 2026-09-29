// Entrenador IA en el cliente: estado (configurado, uso de hoy), peticiones al servidor y
// aceptar / descartar propuestas. Nada se aplica sin que el usuario pulse «Aceptar».
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import type { ScheduledSession } from '@/lib/plan/schedule'
import { localDateKey } from '@/lib/progress/dates'
import {
  generatePlanProposal,
  getAiStatus,
  getWeeklyReview,
  prepareChatPlan,
  proposeExerciseSwap,
  proposeTodayAdjust,
  sendChatMessage,
} from '@/server/ai.functions'
import type { AiChatRole, Json } from '@/types/database'
import { reviewWeekOf } from './review'
import {
  aiFailure,
  type AiFailure,
  type ChangeResponses,
  type ChatActionResults,
  type ChatAdjustResult,
  type ChatPlanResult,
  type ChatResult,
  type PlanChange,
} from './schemas'

export const aiStatusKey = ['ai-status'] as const

export function userTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'
  } catch {
    return 'Europe/Madrid'
  }
}

export function useAiStatus() {
  const fn = useServerFn(getAiStatus)
  return useQuery({
    queryKey: aiStatusKey,
    queryFn: () => fn({ data: { tz: userTimeZone() } }),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

// Sin conexión la IA no está disponible: error amable sin llamar al servidor.
async function call<T>(run: () => Promise<T>): Promise<T | AiFailure> {
  if (!isOnline()) {
    return aiFailure('provider_unavailable', 'Necesitas conexión para consultar a la IA.')
  }
  try {
    return await run()
  } catch (error) {
    console.error('[ai]', error)
    return aiFailure('failed')
  }
}

export function useAiRequests() {
  const planFn = useServerFn(generatePlanProposal)
  const adjustFn = useServerFn(proposeTodayAdjust)
  const reviewFn = useServerFn(getWeeklyReview)
  const chatFn = useServerFn(sendChatMessage)
  const swapFn = useServerFn(proposeExerciseSwap)
  const chatPlanFn = useServerFn(prepareChatPlan)
  const base = () => ({ today: localDateKey(new Date()), tz: userTimeZone() })
  return {
    proposePlan: (templateId: string | null) =>
      call(() => planFn({ data: { ...base(), templateId } })),
    proposeAdjust: (plannedId: string) => call(() => adjustFn({ data: { ...base(), plannedId } })),
    weeklyReview: (opts: { generate: boolean; force: boolean }) =>
      call(() => reviewFn({ data: { ...base(), ...opts } })),
    sendChat: (text: string) => call(() => chatFn({ data: { ...base(), text } })),
    proposeSwap: (exerciseId: string) => call(() => swapFn({ data: { ...base(), exerciseId } })),
    // create_plan del chat: genera (o devuelve el ya generado) el plan de esa respuesta.
    prepareChatPlan: (chatInteractionId: string) =>
      call(() => chatPlanFn({ data: { ...base(), chatInteractionId } })),
  }
}

// ── Revisión semanal ────────────────────────────────────────

export const weeklyReviewKey = (userId: string, weekStart: string) =>
  ['weekly-review', userId, weekStart] as const

// Generación automática: una vez por semana y dispositivo (si falla, se reintenta a mano).
const autoKey = (userId: string, weekStart: string) => `weekly-review-auto:${userId}:${weekStart}`

export function autoReviewAllowed(userId: string, weekStart: string) {
  try {
    return localStorage.getItem(autoKey(userId, weekStart)) === null
  } catch {
    return false
  }
}

export function markAutoReview(userId: string, weekStart: string) {
  try {
    localStorage.setItem(autoKey(userId, weekStart), new Date().toISOString())
  } catch {
    // sin almacenamiento: no se genera sola
  }
}

// Revisión de la semana pasada: la guardada o, la primera vez de la semana, una nueva.
export function useWeeklyReview(userId: string, opts: { auto: boolean; enabled?: boolean }) {
  const ai = useAiRequests()
  const status = useAiStatus()
  const queryClient = useQueryClient()
  const weekStart = reviewWeekOf(localDateKey(new Date()))
  const configured = status.data?.configured === true
  return useQuery({
    queryKey: weeklyReviewKey(userId, weekStart),
    enabled: status.isSuccess && opts.enabled !== false,
    queryFn: async () => {
      const left = (status.data?.limit ?? 0) - (status.data?.usedToday ?? 0)
      const generate =
        opts.auto && configured && left > 0 && isOnline() && autoReviewAllowed(userId, weekStart)
      if (generate) markAutoReview(userId, weekStart)
      const res = await ai.weeklyReview({ generate, force: false })
      if (generate) void queryClient.invalidateQueries({ queryKey: aiStatusKey })
      return res
    },
    staleTime: 10 * 60_000,
    retry: false,
  })
}

// ── Cambios del plan propuestos (revisión y chat) ───────────

// Aceptar aplica en la base de datos el cambio guardado (no el del cliente).
export async function respondChange(interactionId: string, index: number, accept: boolean) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  return check(
    await withTimeout(
      db().rpc('respond_ai_change', {
        p_interaction: interactionId,
        p_index: index,
        p_accept: accept,
      }),
    ),
  )
}

// ── Chat ────────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  role: AiChatRole
  content: string
  createdAt: string
  interactionId: string | null
  // Solo en las respuestas: acciones propuestas y lo respondido.
  changes: PlanChange[]
  responses: ChangeResponses
  planRequest: ChatResult['plan_request'] | null
  adjustToday: ChatResult['adjust_today'] | null
  // Acciones que la app ha descartado por no poderse aplicar.
  discarded: string[]
  // Resultado real de crear el plan o ajustar el día (0033).
  results: ChatActionResults
}

export const chatKey = (userId: string) => ['ai-chat', userId] as const
export const CHAT_PAGE = 60

function asChanges(output: unknown): PlanChange[] {
  const changes = (output as { changes?: unknown } | null)?.changes
  return Array.isArray(changes) ? (changes as PlanChange[]) : []
}

function asObject<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function asResponses(value: unknown): ChangeResponses {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v === 'accepted' || v === 'discarded'),
  ) as ChangeResponses
}

export async function fetchChat(userId: string): Promise<ChatMessage[]> {
  const rows = (
    check(
      await withTimeout(
        db()
          .from('ai_chat_messages')
          .select('id, role, content, created_at, interaction_id')
          .eq('user_id', userId)
          .order('seq', { ascending: false })
          .limit(CHAT_PAGE),
      ),
    ) ?? []
  ).reverse()
  const ids = [
    ...new Set(
      rows.flatMap((r) => (r.role === 'assistant' && r.interaction_id ? [r.interaction_id] : [])),
    ),
  ]
  const interactions = ids.length
    ? (check(
        await withTimeout(
          db()
            .from('ai_interactions')
            .select('id, output, responses, action_results')
            .in('id', ids),
        ),
      ) ?? [])
    : []
  const byId = new Map(interactions.map((i) => [i.id, i]))
  return rows.map((r) => {
    const i = r.role === 'assistant' && r.interaction_id ? byId.get(r.interaction_id) : undefined
    return {
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      interactionId: r.interaction_id,
      changes: i ? asChanges(i.output) : [],
      responses: i ? asResponses(i.responses) : {},
      planRequest: i ? asObject(asObject<ChatResult>(i.output)?.plan_request) : null,
      adjustToday: i ? asObject(asObject<ChatResult>(i.output)?.adjust_today) : null,
      discarded: i ? asStrings(asObject<ChatResult>(i.output)?.discarded) : [],
      results: (i && asObject<ChatActionResults>(i.action_results)) || {},
    }
  })
}

export function useChat(userId: string) {
  return useQuery({
    queryKey: chatKey(userId),
    queryFn: () => fetchChat(userId),
    staleTime: 60_000,
    retry: 1,
  })
}

export async function clearChat(userId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  check(await withTimeout(db().from('ai_chat_messages').delete().eq('user_id', userId)))
}

// Tras responder a un cambio: el plan y las respuestas guardadas cambian.
export async function refreshAfterChange(queryClient: QueryClient, userId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['active-plan'] }),
    queryClient.invalidateQueries({ queryKey: chatKey(userId) }),
    queryClient.invalidateQueries({ queryKey: ['weekly-review', userId] }),
  ])
}

// ── Acciones del chat (0033) ────────────────────────────────

// Crea el plan preparado desde el chat; devuelve lo que ha quedado en la base de datos.
export async function acceptChatPlan(input: {
  chatInteractionId: string
  name: string
  startDate: string
  sessions: ScheduledSession[]
}) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para crear el plan')
  return check(
    await withTimeout(
      db().rpc('accept_chat_plan', {
        p_chat: input.chatInteractionId,
        p_name: input.name,
        p_start_date: input.startDate,
        p_sessions: input.sessions as unknown as Json,
      }),
    ),
  ) as unknown as Extract<ChatPlanResult, { status: 'accepted' }>
}

// Aplica el ajuste del día pedido desde el chat (apply_daily_adjust + resultado en el chat).
export async function applyChatAdjust(
  chatInteractionId: string,
  adjustId: string,
  plannedId: string,
) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  return check(
    await withTimeout(
      db().rpc('apply_chat_adjust', {
        p_chat: chatInteractionId,
        p_adjust: adjustId,
        p_planned: plannedId,
      }),
    ),
  ) as unknown as Extract<ChatAdjustResult, { status: 'accepted' }>
}

export async function discardChatAction(chatInteractionId: string, key: 'plan' | 'adjust') {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  check(
    await withTimeout(db().rpc('discard_chat_action', { p_chat: chatInteractionId, p_key: key })),
  )
}

// ── Sustituir ejercicio ─────────────────────────────────────

// Elegir una alternativa de la IA la marca como aceptada (sin esperar: no bloquea la sesión).
export function markSwapAccepted(interactionId: string) {
  if (!isOnline()) return
  void setAccepted(interactionId, true).catch((error: unknown) =>
    console.error('[ai] no se marcó la sustitución como aceptada', error),
  )
}

function db() {
  return getSupabaseBrowserClient()
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

async function setAccepted(interactionId: string, accepted: boolean) {
  const rows = check(
    await withTimeout(
      db().from('ai_interactions').update({ accepted }).eq('id', interactionId).select('id'),
    ),
  )
  if (!rows || rows.length === 0) throw new Error('No se ha encontrado la propuesta')
}

// Descartar: queda registrado como no aceptada.
export async function discardProposal(interactionId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  await setAccepted(interactionId, false)
}

// Aceptar un plan de la IA: se crea como cualquier plan (create_user_plan) con origen «ai».
export async function acceptAiPlan(input: {
  interactionId: string
  templateId: string | null
  name: string
  summary: string
  startDate: string
  sessions: ScheduledSession[]
}) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para crear el plan')
  const planId = check(
    await withTimeout(
      db().rpc('create_user_plan', {
        p_template_id: input.templateId,
        p_name: input.name,
        p_start_date: input.startDate,
        p_sessions: input.sessions as unknown as Json,
        p_source: 'ai',
        p_notes: input.summary,
      }),
    ),
  )
  await setAccepted(input.interactionId, true).catch((error: unknown) =>
    console.error('[ai] plan creado, pero no se marcó la propuesta como aceptada', error),
  )
  return planId
}

// Aceptar el ajuste del día: la base de datos aplica la propuesta guardada (no la del cliente).
export async function applyTodayAdjust(interactionId: string, plannedId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  return check(
    await withTimeout(
      db().rpc('apply_daily_adjust', { p_interaction: interactionId, p_planned: plannedId }),
    ),
  )
}

export async function revertTodayAdjust(plannedId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  check(await withTimeout(db().rpc('revert_daily_adjust', { p_planned: plannedId })))
}
