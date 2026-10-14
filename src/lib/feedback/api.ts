// Envío y lectura del feedback. Si no hay conexión, el comentario se guarda en el móvil y se
// manda al volver (no se pierde en el gimnasio sin cobertura).
import { useQuery } from '@tanstack/react-query'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, withTimeout } from '@/lib/workout/api'
import type { FeedbackKind, FeedbackRow, FeedbackStatus } from '@/types/database'
import type { FeedbackItem } from './feedback'

const db = () => getSupabaseBrowserClient()
const OUTBOX_KEY = 'feedback-outbox'

export type FeedbackInput = {
  kind: FeedbackKind
  message: string
  route: string | null
  device: string | null
}

function readOutbox(): FeedbackInput[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const list = raw ? (JSON.parse(raw) as FeedbackInput[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeOutbox(list: FeedbackInput[]) {
  try {
    if (list.length === 0) localStorage.removeItem(OUTBOX_KEY)
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-20)))
  } catch {
    // sin almacenamiento: no se puede guardar para luego
  }
}

async function insert(input: FeedbackInput) {
  const { error } = await withTimeout(
    db()
      .from('feedback')
      .insert({
        kind: input.kind,
        message: input.message.trim().slice(0, 2000),
        route: input.route?.slice(0, 300) ?? null,
        device: input.device?.slice(0, 500) ?? null,
      }),
  )
  if (error) throw new Error(error.message)
}

// Devuelve 'sent' o 'queued' (sin conexión: se enviará solo).
export async function sendFeedback(input: FeedbackInput): Promise<'sent' | 'queued'> {
  if (!isOnline()) {
    writeOutbox([...readOutbox(), input])
    return 'queued'
  }
  try {
    await insert(input)
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/failed to fetch|network|load failed|timeout|tiempo/i.test(message)) {
      writeOutbox([...readOutbox(), input])
      return 'queued'
    }
    throw error
  }
}

// Al abrir la app o al volver la conexión.
export async function flushFeedbackOutbox() {
  if (!isOnline()) return
  const pending = readOutbox()
  if (pending.length === 0) return
  const left: FeedbackInput[] = []
  for (const item of pending) {
    try {
      await insert(item)
    } catch (error) {
      console.error('[feedback] reintento', error)
      left.push(item)
    }
  }
  writeOutbox(left)
}

function toItem(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    message: row.message,
    route: row.route,
    device: row.device,
    appVersion: row.app_version,
    status: row.status,
    createdAt: row.created_at,
  }
}

// Admin: todos (la RLS ya lo limita); el resto, los suyos.
export async function fetchFeedback(): Promise<FeedbackItem[]> {
  const { data, error } = await withTimeout(
    db().from('feedback').select('*').order('created_at', { ascending: false }).limit(500),
  )
  if (error) throw new Error(error.message)
  return (data ?? []).map(toItem)
}

export const feedbackQueryKey = ['feedback'] as const

export function useFeedbackList(enabled = true) {
  return useQuery({ queryKey: feedbackQueryKey, queryFn: fetchFeedback, enabled })
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  const { data, error } = await withTimeout(
    db()
      .from('feedback')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id'),
  )
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('no tienes permiso para hacer este cambio')
}
