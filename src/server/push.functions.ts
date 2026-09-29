// Funciones de servidor de las notificaciones push (fase 7B). La clave privada VAPID y la
// service role solo existen aquí. Quien provoca el aviso (invitar a entrenar, reaccionar) llama
// a estas funciones después de la RPC; el servidor comprueba con la sesión del usuario (RLS) que
// la invitación o la reacción existen y son suyas antes de avisar a la otra persona.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { REACTION_EMOJI } from '@/lib/partners/labels'
import { authMiddleware } from './middleware'
import { getSupabaseAdminClient, getSupabaseServerClient } from './supabase.server'
import { getPushConfig } from './push/config'
import { sendToUser, supabasePushStore, webPushTransport, type PushMessage } from './push/send'

export type PushServerStatus = {
  configured: boolean
  publicKey: string | null
  problem: string | null
}

function pushDeps() {
  const config = getPushConfig()
  if (!config.configured) return null
  const admin = getSupabaseAdminClient()
  return { admin, transport: webPushTransport(config), store: supabasePushStore(admin) }
}

export const getPushServerStatus = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async (): Promise<PushServerStatus> => {
    const config = getPushConfig()
    return {
      configured: config.configured,
      publicKey: config.configured ? config.publicKey : null,
      problem: config.problem,
    }
  })

export const sendTestPush = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const deps = pushDeps()
    if (!deps) return { sent: 0, failed: 0, removed: 0, skipped: 'not_configured' }
    return sendToUser(deps, context.auth.userId, {
      title: 'Prueba de notificación 💪',
      body: 'Si ves esto, las notificaciones funcionan en este dispositivo.',
      url: '/perfil/notificaciones',
      tag: 'test',
    })
  })

// Preferencias del destinatario (sin fila = valores por defecto: invitaciones y reacciones sí).
async function wants(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  userId: string,
  kind: 'pair_invites' | 'reactions',
) {
  const [{ data: settings }, { data: profile }] = await Promise.all([
    admin.from('notification_settings').select(kind).eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('active').eq('id', userId).maybeSingle(),
  ])
  if (!profile?.active) return false
  const row = settings as Record<string, boolean> | null
  return row ? row[kind] !== false : true
}

async function displayName(admin: ReturnType<typeof getSupabaseAdminClient>, userId: string) {
  const { data } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle()
  return data?.display_name?.trim() || 'Tu compañero'
}

export const notifyPairInvite = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ inviteId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const deps = pushDeps()
    if (!deps) return { sent: 0, skipped: 'not_configured' }
    const supabase = getSupabaseServerClient()
    const { data: invite, error } = await supabase
      .from('pair_invites')
      .select('id, to_user, payload, status')
      .eq('id', data.inviteId)
      .eq('from_user', context.auth.userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!invite || invite.status !== 'pending') return { sent: 0, skipped: 'not_pending' }
    if (!(await wants(deps.admin, invite.to_user, 'pair_invites'))) {
      return { sent: 0, skipped: 'disabled' }
    }
    const name = await displayName(deps.admin, context.auth.userId)
    const payload = invite.payload as { title?: unknown } | null
    const title = typeof payload?.title === 'string' && payload.title ? payload.title : null
    const message: PushMessage = {
      title: `${name} te invita a entrenar juntos 🤝`,
      body: title ? `${title}. Toca para unirte.` : 'Toca para unirte.',
      url: '/',
      tag: `pair-${invite.id}`,
    }
    return sendToUser(deps, invite.to_user, message, `pair:${invite.id}`)
  })

const reactionInput = z.object({
  to: z.uuid(),
  kind: z.enum(['week', 'session']),
  key: z.string().min(1).max(64),
  emoji: z.enum(['clap', 'fire', 'muscle']),
})

export const notifyReaction = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(reactionInput)
  .handler(async ({ data, context }) => {
    const deps = pushDeps()
    if (!deps) return { sent: 0, skipped: 'not_configured' }
    const supabase = getSupabaseServerClient()
    const { data: rows, error } = await supabase
      .from('reactions')
      .select('id')
      .eq('from_user', context.auth.userId)
      .eq('to_user', data.to)
      .eq('target_kind', data.kind)
      .eq('target_key', data.key)
      .eq('emoji', data.emoji)
      .limit(1)
    if (error) throw new Error(error.message)
    if (rows.length === 0) return { sent: 0, skipped: 'no_reaction' }
    if (!(await wants(deps.admin, data.to, 'reactions'))) return { sent: 0, skipped: 'disabled' }
    const name = await displayName(deps.admin, context.auth.userId)
    const emoji = REACTION_EMOJI[data.emoji]
    const message: PushMessage =
      data.kind === 'week'
        ? {
            title: `${name} ha reaccionado ${emoji}`,
            body: 'A tu semana de entrenos. ¡Sigue así!',
            url: '/progreso/cumplimiento',
            tag: `reaction-week-${data.key}`,
          }
        : {
            title: `${name} ha reaccionado ${emoji}`,
            body: 'A una de tus sesiones.',
            url: `/entrenar/historial/${data.key}`,
            tag: `reaction-session-${data.key}`,
          }
    // Como mucho un aviso por persona y semana/sesión (aunque ponga y quite reacciones).
    return sendToUser(
      deps,
      data.to,
      message,
      `reaction:${context.auth.userId}:${data.kind}:${data.key}`,
    )
  })
