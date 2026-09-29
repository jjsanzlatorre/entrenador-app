// Notificaciones push en el cliente (fase 7B): soporte del navegador, suscribir este dispositivo,
// preferencias y avisos a la otra persona (invitación a entrenar, reacción).
// En iPhone/iPad solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4+).
import { useQuery } from '@tanstack/react-query'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import { userTimeZone } from '@/lib/ai/client'
import {
  getPushServerStatus,
  notifyPairInvite,
  notifyReaction,
  sendTestPush,
} from '@/server/push.functions'
import type { NotificationSettingsRow, ReactionEmoji, ReactionKind } from '@/types/database'

export type PushSupport =
  { ok: true } | { ok: false; reason: 'unsupported' | 'ios_not_installed' | 'denied' }

export function isIos(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && hasTouch())
}

function hasTouch() {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  const apis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!apis)
    return isIos() && !isStandalone()
      ? { ok: false, reason: 'ios_not_installed' }
      : { ok: false, reason: 'unsupported' }
  if (isIos() && !isStandalone()) return { ok: false, reason: 'ios_not_installed' }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  return { ok: true }
}

// Clave pública VAPID (base64url) → bytes para PushManager.subscribe.
export function base64UrlToBytes(value: string) {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of view) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registration() {
  const reg = await withTimeout(navigator.serviceWorker.ready, 8000)
  return reg
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager?.getSubscription()) ?? null
  } catch {
    return null
  }
}

function sameKey(sub: PushSubscription, publicKey: string) {
  const key = sub.options?.applicationServerKey
  return !key || bytesToBase64Url(key) === publicKey
}

// Pide permiso, suscribe este dispositivo y lo guarda para el usuario actual.
export async function enablePush(publicKey: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para activar las notificaciones')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'has bloqueado las notificaciones; actívalas en los ajustes del navegador'
        : 'no has dado permiso',
    )
  }
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  // Si las claves VAPID cambiaron, la suscripción antigua ya no sirve.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  })
  await saveSubscription(sub)
  return sub
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('suscripción no válida')
  const { error } = await withTimeout(
    getSupabaseBrowserClient().rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent.slice(0, 300),
    }),
  )
  if (error) throw new Error(error.message)
}

// Deja de recibir notificaciones en este dispositivo.
export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await withTimeout(
    getSupabaseBrowserClient().from('push_subscriptions').delete().eq('endpoint', sub.endpoint),
  )
  if (error) throw new Error(error.message)
  await sub.unsubscribe().catch(() => false)
}

// Al abrir la app: si este dispositivo tiene suscripción, se vuelve a guardar para el usuario que
// ha entrado (si en el móvil entra otra persona, las notificaciones pasan a ser suyas).
export async function refreshPushSubscription() {
  if (!isOnline() || typeof Notification === 'undefined' || Notification.permission !== 'granted')
    return
  const sub = await currentSubscription()
  if (sub) await saveSubscription(sub).catch(() => {})
}

// ── Preferencias ────────────────────────────────────────────

export type NotificationSettings = {
  pairInvites: boolean
  reactions: boolean
  planReminder: boolean
  reminderTime: string // HH:MM
  behindNudge: boolean
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  pairInvites: true,
  reactions: true,
  planReminder: false,
  reminderTime: '08:00',
  behindNudge: false,
}

function toSettings(r: NotificationSettingsRow | null): NotificationSettings {
  if (!r) return DEFAULT_SETTINGS
  return {
    pairInvites: r.pair_invites,
    reactions: r.reactions,
    planReminder: r.plan_reminder,
    reminderTime: r.reminder_time.slice(0, 5),
    behindNudge: r.behind_nudge,
  }
}

export const notificationSettingsKey = (userId: string) => ['notification-settings', userId]

export async function fetchNotificationSettings(userId: string) {
  const { data, error } = await withTimeout(
    getSupabaseBrowserClient()
      .from('notification_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  )
  if (error) throw new Error(error.message)
  return toSettings(data)
}

export async function saveNotificationSettings(userId: string, settings: NotificationSettings) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para guardar')
  const { data, error } = await withTimeout(
    getSupabaseBrowserClient()
      .from('notification_settings')
      .upsert({
        user_id: userId,
        pair_invites: settings.pairInvites,
        reactions: settings.reactions,
        plan_reminder: settings.planReminder,
        reminder_time: `${settings.reminderTime}:00`,
        behind_nudge: settings.behindNudge,
        tz: userTimeZone(),
      })
      .select('*')
      .maybeSingle(),
  )
  if (error) throw new Error(error.message)
  if (!data) throw new Error('no se ha guardado')
  return toSettings(data)
}

// Horas del selector: tramos de 15 min.
export const REMINDER_TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0')
  const m = String((i % 4) * 15).padStart(2, '0')
  return `${h}:${m}`
})

// ── Servidor ────────────────────────────────────────────────

export function usePushServerStatus() {
  return useQuery({
    queryKey: ['push-status'],
    queryFn: () => getPushServerStatus(),
    staleTime: 10 * 60_000,
    retry: 1,
  })
}

export function sendTestNotification() {
  return sendTestPush()
}

// Avisos a la otra persona: nunca bloquean ni muestran error (la acción principal ya se hizo).
export function pushPairInvite(inviteId: string) {
  if (!isOnline()) return
  notifyPairInvite({ data: { inviteId } }).catch((error: unknown) =>
    console.warn('[push] invitación', error),
  )
}

export function pushReaction(to: string, kind: ReactionKind, key: string, emoji: ReactionEmoji) {
  if (!isOnline()) return
  notifyReaction({ data: { to, kind, key, emoji } }).catch((error: unknown) =>
    console.warn('[push] reacción', error),
  )
}

// ── Claves (herramienta del admin) ──────────────────────────

// Genera un par de claves VAPID en el navegador (P-256), en el formato de web-push.
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: bytesToBase64Url(publicRaw), privateKey: privateJwk.d ?? '' }
}

export function randomSecret(bytes = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}
