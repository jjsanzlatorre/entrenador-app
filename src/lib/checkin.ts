// Check-in diario (CLAUDE.md §4 daily_checkins, fase 5B): sueño, energía, agujetas y estrés
// (1–5). Local-first: se guarda en IndexedDB al momento y se sube cuando hay conexión
// (reintento al volver la conexión o al abrir «Hoy»).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { idbDelete, idbGet, idbPut } from '@/lib/offline/idb'
import { isOnline, withTimeout } from '@/lib/workout/api'
import type { DateKey } from '@/lib/progress/dates'

export const CHECKIN_FIELDS = ['sleep', 'energy', 'soreness', 'stress'] as const
export type CheckinField = (typeof CHECKIN_FIELDS)[number]

export type Checkin = { date: DateKey } & Record<CheckinField, number | null>

type Stored = Checkin & { pending: boolean }

export const CHECKIN_LABELS: Record<CheckinField, { label: string; low: string; high: string }> = {
  sleep: { label: 'Sueño', low: 'Fatal', high: 'Genial' },
  energy: { label: 'Energía', low: 'Sin pilas', high: 'A tope' },
  soreness: { label: 'Agujetas', low: 'Nada', high: 'Muchas' },
  stress: { label: 'Estrés', low: 'Tranqui', high: 'Mucho' },
}

const key = (userId: string, date: DateKey) => `checkin:${userId}:${date}`
const pendingKey = (userId: string) => `checkins-pending:${userId}`
const dismissedKey = (userId: string) => `checkin-dismissed:${userId}`

export const checkinQueryKey = (userId: string, date: DateKey) => ['checkin', userId, date] as const

export function isComplete(c: Partial<Checkin> | null | undefined) {
  return Boolean(c && CHECKIN_FIELDS.every((f) => typeof c[f] === 'number'))
}

function db() {
  return getSupabaseBrowserClient()
}

// El del día: copia local si la hay; si no, el servidor (y se copia).
export async function fetchCheckin(userId: string, date: DateKey): Promise<Stored | null> {
  const local = await idbGet<Stored>('kv', key(userId, date))
  if (local) return local
  if (!isOnline()) return null
  try {
    const { data, error } = await withTimeout(
      db()
        .from('daily_checkins')
        .select('date, sleep, energy, soreness, stress')
        .eq('user_id', userId)
        .eq('date', date)
        .maybeSingle(),
    )
    if (error) throw new Error(error.message)
    if (!data) return null
    const stored: Stored = { ...data, pending: false }
    await idbPut('kv', key(userId, date), stored)
    return stored
  } catch (error) {
    console.error('[checkin] sin datos del servidor', error)
    return null
  }
}

async function upload(userId: string, c: Checkin) {
  const { error } = await withTimeout(
    db().from('daily_checkins').upsert(
      {
        user_id: userId,
        date: c.date,
        sleep: c.sleep,
        energy: c.energy,
        soreness: c.soreness,
        stress: c.stress,
      },
      { onConflict: 'user_id,date' },
    ),
  )
  if (error) throw new Error(error.message)
}

// Sube los pendientes. No lanza: lo que falle se queda para el siguiente intento.
export async function syncCheckins(userId: string) {
  if (!isOnline()) return
  const dates = (await idbGet<DateKey[]>('kv', pendingKey(userId))) ?? []
  const left: DateKey[] = []
  for (const date of dates) {
    const stored = await idbGet<Stored>('kv', key(userId, date))
    if (!stored) continue
    try {
      await upload(userId, stored)
      await idbPut('kv', key(userId, date), { ...stored, pending: false })
    } catch (error) {
      console.error('[checkin] se reintentará', error)
      left.push(date)
    }
  }
  if (left.length > 0) await idbPut('kv', pendingKey(userId), left)
  else await idbDelete('kv', pendingKey(userId))
}

// Guarda en el dispositivo y lo intenta subir. Devuelve si quedó subido.
export async function saveCheckin(userId: string, c: Checkin): Promise<boolean> {
  await idbPut<Stored>('kv', key(userId, c.date), { ...c, pending: true })
  const dates = (await idbGet<DateKey[]>('kv', pendingKey(userId))) ?? []
  if (!dates.includes(c.date)) await idbPut('kv', pendingKey(userId), [...dates, c.date])
  await syncCheckins(userId)
  return !(await idbGet<Stored>('kv', key(userId, c.date)))?.pending
}

// «Ahora no»: se oculta hasta mañana.
export async function dismissCheckin(userId: string, date: DateKey) {
  await idbPut('kv', dismissedKey(userId), date)
}

export async function isCheckinDismissed(userId: string, date: DateKey) {
  return (await idbGet<DateKey>('kv', dismissedKey(userId))) === date
}

export function useCheckin(userId: string, date: DateKey) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const sync = () =>
      void syncCheckins(userId).then(() =>
        queryClient.invalidateQueries({ queryKey: checkinQueryKey(userId, date) }),
      )
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [userId, date, queryClient])

  return useQuery({
    queryKey: checkinQueryKey(userId, date),
    queryFn: async () => ({
      checkin: await fetchCheckin(userId, date),
      dismissed: await isCheckinDismissed(userId, date),
    }),
    networkMode: 'always',
    staleTime: 60_000,
  })
}
