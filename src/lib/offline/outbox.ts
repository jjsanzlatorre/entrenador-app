// Cola de escritura persistente (IndexedDB) con reintentos y backoff exponencial.
// Una entrada por sesión: guardar una sesión reemplaza a la copia pendiente anterior,
// y borrarla reemplaza a cualquier guardado pendiente.
import { idbDelete, idbGet, idbGetAll, idbPut } from './idb'
import type { SessionPayload } from '@/lib/workout/payload'

export type OutboxItem =
  | {
      key: string
      kind: 'save'
      sessionId: string
      userId: string
      rev: number
      payload: SessionPayload
      attempts: number
      nextAttemptAt: number
      lastError: string | null
      createdAt: number
    }
  | {
      key: string
      kind: 'delete'
      sessionId: string
      userId: string
      rev: number
      attempts: number
      nextAttemptAt: number
      lastError: string | null
      createdAt: number
    }

export type Transport = {
  save: (payload: SessionPayload) => Promise<void>
  remove: (sessionId: string) => Promise<void>
}

const MAX_BACKOFF_MS = 60_000

export function outboxKey(sessionId: string) {
  return `session:${sessionId}`
}

export function backoffMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1))
}

export async function enqueueSave(
  sessionId: string,
  userId: string,
  rev: number,
  payload: SessionPayload,
  now = Date.now(),
) {
  const key = outboxKey(sessionId)
  const existing = await idbGet<OutboxItem>('outbox', key)
  await idbPut<OutboxItem>('outbox', key, {
    key,
    kind: 'save',
    sessionId,
    userId,
    rev,
    payload,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: existing?.createdAt ?? now,
  })
}

export async function enqueueDelete(sessionId: string, userId: string, now = Date.now()) {
  const key = outboxKey(sessionId)
  const existing = await idbGet<OutboxItem>('outbox', key)
  await idbPut<OutboxItem>('outbox', key, {
    key,
    kind: 'delete',
    sessionId,
    userId,
    rev: now,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: existing?.createdAt ?? now,
  })
}

export async function listOutbox(userId?: string) {
  const items = await idbGetAll<OutboxItem>('outbox')
  return items
    .filter((i) => !userId || i.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export type FlushResult = { sent: string[]; failed: { sessionId: string; error: string }[] }

// Envía lo que toca. Solo borra una entrada si no ha cambiado mientras se enviaba.
export async function flushOutbox(
  transport: Transport,
  userId: string,
  now = Date.now(),
): Promise<FlushResult> {
  const result: FlushResult = { sent: [], failed: [] }
  for (const item of await listOutbox(userId)) {
    if (item.nextAttemptAt > now) continue
    try {
      if (item.kind === 'save') await transport.save(item.payload)
      else await transport.remove(item.sessionId)

      const current = await idbGet<OutboxItem>('outbox', item.key)
      if (current && current.kind === item.kind && current.rev === item.rev) {
        await idbDelete('outbox', item.key)
      }
      result.sent.push(item.sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const current = await idbGet<OutboxItem>('outbox', item.key)
      if (current && current.rev === item.rev && current.kind === item.kind) {
        const attempts = current.attempts + 1
        await idbPut<OutboxItem>('outbox', item.key, {
          ...current,
          attempts,
          nextAttemptAt: now + backoffMs(attempts),
          lastError: message,
        })
      }
      result.failed.push({ sessionId: item.sessionId, error: message })
    }
  }
  return result
}

// Permite reintentar ya (p. ej. al volver la conexión).
export async function makeAllDue(userId: string) {
  for (const item of await listOutbox(userId)) {
    if (item.nextAttemptAt > 0) await idbPut('outbox', item.key, { ...item, nextAttemptAt: 0 })
  }
}
