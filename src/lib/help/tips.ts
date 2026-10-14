// Consejos de primera vez (usabilidad 3/3): un consejo breve por pantalla clave que, una vez
// cerrado, no vuelve a salir. Se guarda en el móvil (localStorage, para no parpadear y funcionar
// sin conexión) y en la base de datos (dismissed_tips, para el resto de dispositivos).
import { useSyncExternalStore } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

// Pantallas con consejo (y su texto en «Cómo funciona»).
export const TIP_IDS = [
  'today',
  'train',
  'session-sets',
  'plan',
  'progress',
  'muscles',
  'coach',
  'timer-tool',
  'activity',
] as const
export type TipId = (typeof TIP_IDS)[number]

type State = { userId: string | null; dismissed: Set<string>; ready: boolean }
let state: State = { userId: null, dismissed: new Set(), ready: false }
const listeners = new Set<() => void>()

const storageKey = (userId: string) => `tips-dismissed:${userId}`

function emit(next: State) {
  state = next
  for (const l of listeners) l()
}

function readLocal(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeLocal(userId: string, dismissed: Set<string>) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...dismissed]))
  } catch {
    // sin almacenamiento: el consejo se cierra hasta recargar
  }
}

// Al entrar en la app: copia local y, con conexión, lo cerrado en otros dispositivos.
export async function initTips(userId: string) {
  if (state.userId !== userId) {
    emit({ userId, dismissed: readLocal(userId), ready: true })
  }
  try {
    const { data, error } = await getSupabaseBrowserClient()
      .from('dismissed_tips')
      .select('tip_id')
      .eq('user_id', userId)
    if (error || !data) return
    if (state.userId !== userId) return
    const merged = new Set([...state.dismissed, ...data.map((r) => r.tip_id)])
    // Lo cerrado sin conexión se sube ahora.
    const missing = [...state.dismissed].filter((id) => !data.some((r) => r.tip_id === id))
    if (missing.length > 0) {
      void getSupabaseBrowserClient()
        .from('dismissed_tips')
        .upsert(
          missing.map((tip_id) => ({ tip_id })),
          { onConflict: 'user_id,tip_id', ignoreDuplicates: true },
        )
    }
    if (merged.size !== state.dismissed.size) {
      writeLocal(userId, merged)
      emit({ ...state, dismissed: merged })
    }
  } catch {
    // sin conexión: vale la copia local
  }
}

export function dismissTip(id: string) {
  const { userId } = state
  if (!userId || state.dismissed.has(id)) return
  const dismissed = new Set([...state.dismissed, id])
  writeLocal(userId, dismissed)
  emit({ ...state, dismissed })
  void Promise.resolve(
    getSupabaseBrowserClient()
      .from('dismissed_tips')
      .upsert({ tip_id: id }, { onConflict: 'user_id,tip_id', ignoreDuplicates: true }),
  ).catch(() => undefined)
}

// «Volver a ver los consejos» (Cómo funciona).
export async function resetTips() {
  const { userId } = state
  if (!userId) return
  writeLocal(userId, new Set())
  emit({ ...state, dismissed: new Set() })
  const { error } = await getSupabaseBrowserClient()
    .from('dismissed_tips')
    .delete()
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state
const serverSnapshot: State = { userId: null, dismissed: new Set(), ready: false }

// true si el consejo debe verse (solo en el navegador y cuando ya se sabe qué está cerrado).
export function useTipVisible(id: string) {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot)
  return s.ready && !s.dismissed.has(id)
}

export function __resetTipsForTests() {
  state = { userId: null, dismissed: new Set(), ready: false }
}
