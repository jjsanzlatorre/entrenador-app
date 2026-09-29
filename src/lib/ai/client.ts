// Entrenador IA en el cliente: estado (configurado, uso de hoy), peticiones al servidor y
// aceptar / descartar propuestas. Nada se aplica sin que el usuario pulse «Aceptar».
import { useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import type { ScheduledSession } from '@/lib/plan/schedule'
import { localDateKey } from '@/lib/progress/dates'
import { generatePlanProposal, getAiStatus, proposeTodayAdjust } from '@/server/ai.functions'
import type { Json } from '@/types/database'
import { aiFailure, type AiFailure } from './schemas'

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
  const base = () => ({ today: localDateKey(new Date()), tz: userTimeZone() })
  return {
    proposePlan: (templateId: string | null) =>
      call(() => planFn({ data: { ...base(), templateId } })),
    proposeAdjust: (plannedId: string) => call(() => adjustFn({ data: { ...base(), plannedId } })),
  }
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
