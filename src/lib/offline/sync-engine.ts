// Motor de sincronización (solo navegador): vacía la cola al cambiar algo, al volver la
// conexión, al volver a la app y periódicamente mientras quede algo pendiente.
import { deleteSessionRemote, saveSessionRemote } from '@/lib/workout/api'
import { flushOutbox, listOutbox, makeAllDue } from './outbox'

export type SyncStatus = {
  online: boolean
  pending: number
  syncing: boolean
  lastError: string | null
  lastSyncedAt: number | null
}

let status: SyncStatus = {
  online: true,
  pending: 0,
  syncing: false,
  lastError: null,
  lastSyncedAt: null,
}
const listeners = new Set<() => void>()
const syncedListeners = new Set<(sessionIds: string[]) => void>()

let userId: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let rerun = false
let started = false

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const l of listeners) l()
}

export function getSyncStatus() {
  return status
}

export function subscribeSyncStatus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function onSessionsSynced(listener: (sessionIds: string[]) => void) {
  syncedListeners.add(listener)
  return () => {
    syncedListeners.delete(listener)
  }
}

const transport = { save: saveSessionRemote, remove: deleteSessionRemote }

async function runOnce() {
  if (!userId) return
  const uid = userId
  setStatus({ syncing: true })
  try {
    const result = await flushOutbox(transport, uid)
    const remaining = await listOutbox(uid)
    setStatus({
      pending: remaining.length,
      lastError: result.failed[0]?.error ?? (remaining.length > 0 ? status.lastError : null),
      lastSyncedAt: result.sent.length > 0 ? Date.now() : status.lastSyncedAt,
    })
    if (result.sent.length > 0) for (const l of syncedListeners) l(result.sent)

    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    if (remaining.length > 0) {
      const nextAt = Math.min(...remaining.map((i) => i.nextAttemptAt))
      retryTimer = setTimeout(() => void syncNow(), Math.max(1000, nextAt - Date.now()))
    }
  } catch (error) {
    console.error('[sync] error inesperado', error)
    setStatus({ lastError: error instanceof Error ? error.message : String(error) })
  } finally {
    setStatus({ syncing: false })
  }
}

export function syncNow(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      await runOnce()
    } while (rerun)
  })().finally(() => {
    running = null
  })
  return running
}

// Tras cada cambio: agrupa escrituras seguidas (p. ej. varios toques rápidos).
export function requestSync(delayMs = 800) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void syncNow(), delayMs)
  void refreshPending()
}

export async function refreshPending() {
  if (!userId) return
  setStatus({ pending: (await listOutbox(userId)).length })
}

export function startSyncEngine(currentUserId: string) {
  userId = currentUserId
  setStatus({ online: navigator.onLine })
  if (started) {
    void syncNow()
    return
  }
  started = true

  window.addEventListener('online', () => {
    setStatus({ online: true })
    if (userId) void makeAllDue(userId).then(() => syncNow())
  })
  window.addEventListener('offline', () => setStatus({ online: false }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  void syncNow()
}
