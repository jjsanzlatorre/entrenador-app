// Envío de notificaciones push (solo servidor). El transporte (web-push) y el almacén (Supabase
// con service role) se inyectan para poder probar la lógica sin red.
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { PushConfig } from './config'

export type PushMessage = {
  title: string
  body: string
  // Ruta de la app que se abre al tocar la notificación.
  url: string
  // Notificaciones con el mismo tag se sustituyen en vez de acumularse.
  tag?: string
}

export type Subscription = { id: string; endpoint: string; p256dh: string; auth: string }

// Devuelve el código HTTP del servicio de push (201 = entregada al servicio).
export type Transport = (sub: Subscription, payload: string) => Promise<number>

export type PushStore = {
  subscriptions(userId: string): Promise<Subscription[]>
  // Reserva el envío con esa clave; false si ya se envió (o lo está enviando otra ejecución).
  claim(userId: string, key: string): Promise<boolean>
  markSuccess(ids: string[]): Promise<void>
  markFailure(ids: string[]): Promise<void>
  remove(ids: string[]): Promise<void>
}

export type SendResult = { sent: number; failed: number; removed: number; skipped?: string }

// Tras tantos fallos seguidos (que no son 404/410) la suscripción se da por perdida.
const MAX_FAILURES = 5

export async function sendToUser(
  deps: { transport: Transport; store: PushStore },
  userId: string,
  message: PushMessage,
  key?: string,
): Promise<SendResult> {
  const subs = await deps.store.subscriptions(userId)
  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0, skipped: 'no_subscriptions' }
  if (key && !(await deps.store.claim(userId, key))) {
    return { sent: 0, failed: 0, removed: 0, skipped: 'already_sent' }
  }
  const payload = JSON.stringify(message)
  const ok: string[] = []
  const gone: string[] = []
  const failed: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      let status: number
      try {
        status = await deps.transport(sub, payload)
      } catch {
        status = 0
      }
      if (status >= 200 && status < 300) ok.push(sub.id)
      else if (status === 404 || status === 410) gone.push(sub.id)
      else failed.push(sub.id)
    }),
  )
  if (ok.length) await deps.store.markSuccess(ok)
  if (gone.length) await deps.store.remove(gone)
  if (failed.length) await deps.store.markFailure(failed)
  return { sent: ok.length, failed: failed.length, removed: gone.length }
}

export function webPushTransport(config: PushConfig): Transport {
  const vapidDetails = {
    subject: config.subject,
    publicKey: config.publicKey ?? '',
    privateKey: config.privateKey ?? '',
  }
  return async (sub, payload) => {
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { vapidDetails, TTL: 12 * 3600, urgency: 'normal', timeout: 10_000 },
      )
      return res.statusCode
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode
      if (typeof status === 'number') return status
      console.error('[push] error de envío', error)
      return 0
    }
  }
}

export function supabasePushStore(admin: SupabaseClient<Database>): PushStore {
  return {
    async subscriptions(userId) {
      const { data, error } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', userId)
      if (error) throw new Error(error.message)
      return data
    },
    async claim(userId, key) {
      const { data, error } = await admin
        .from('push_log')
        .upsert({ user_id: userId, key }, { onConflict: 'user_id,key', ignoreDuplicates: true })
        .select('key')
      if (error) throw new Error(error.message)
      return (data ?? []).length > 0
    },
    async markSuccess(ids) {
      const { error } = await admin
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .in('id', ids)
      if (error) console.error('[push] markSuccess', error.message)
    },
    async markFailure(ids) {
      const { data } = await admin
        .from('push_subscriptions')
        .select('id, failure_count')
        .in('id', ids)
      for (const row of data ?? []) {
        const count = row.failure_count + 1
        if (count >= MAX_FAILURES) await admin.from('push_subscriptions').delete().eq('id', row.id)
        else
          await admin.from('push_subscriptions').update({ failure_count: count }).eq('id', row.id)
      }
    },
    async remove(ids) {
      const { error } = await admin.from('push_subscriptions').delete().in('id', ids)
      if (error) console.error('[push] remove', error.message)
    },
  }
}
