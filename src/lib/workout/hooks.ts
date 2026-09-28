import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSyncStatus, subscribeSyncStatus } from '@/lib/offline/sync-engine'
import { listOutbox } from '@/lib/offline/outbox'
import { listLocalFinishedSessions } from './active-session'
import {
  fetchCatalog,
  fetchEquipment,
  fetchHistory,
  getLastPerformance,
  type HistoryItem,
} from './api'
import { sessionStats } from './calc'
import type { Exercise } from './types'

export const catalogQueryKey = (userId: string) => ['catalog', userId] as const

export function useCatalog(userId: string) {
  const query = useQuery({
    queryKey: catalogQueryKey(userId),
    queryFn: () => fetchCatalog(userId),
    staleTime: 5 * 60_000,
    networkMode: 'always',
    retry: 1,
  })
  const byId = useMemo(
    () => new Map<string, Exercise>((query.data ?? []).map((e) => [e.id, e])),
    [query.data],
  )
  return { ...query, byId }
}

export function useEquipment(userId: string) {
  return useQuery({
    queryKey: ['equipment', userId],
    queryFn: () => fetchEquipment(userId),
    staleTime: 10 * 60_000,
    networkMode: 'always',
  })
}

export function useLastPerformance(
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string | null,
) {
  const ids = [...new Set(exerciseIds)].sort()
  return useQuery({
    queryKey: ['last', userId, ids, excludeSessionId],
    queryFn: () => getLastPerformance(userId, ids, excludeSessionId),
    staleTime: 5 * 60_000,
    networkMode: 'always',
    enabled: ids.length > 0,
  })
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
}

// Reloj que se actualiza cada `intervalMs` (para cronómetros basados en timestamps).
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs, enabled])
  return now
}

// Mantiene la pantalla encendida mientras la sesión está abierta (si el navegador lo permite).
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      try {
        if (document.visibilityState !== 'visible') return
        lock = await navigator.wakeLock.request('screen')
        if (cancelled) void lock.release()
      } catch {
        // denegado (batería baja, etc.): no pasa nada
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release()
    }
  }, [enabled])
}

// Historial: lo del servidor + lo terminado en el móvil que aún no se ha sincronizado.
export type HistoryEntry = HistoryItem & { pendingSync: boolean; localOnly: boolean }

export const historyQueryKey = (userId: string) => ['history', userId] as const

export function useHistory(userId: string) {
  return useQuery({
    queryKey: historyQueryKey(userId),
    networkMode: 'always',
    staleTime: 30_000,
    queryFn: async () => {
      const [pending, local] = await Promise.all([
        listOutbox(userId),
        listLocalFinishedSessions(userId),
      ])
      const pendingIds = new Set(pending.filter((i) => i.kind === 'save').map((i) => i.sessionId))
      const deletedIds = new Set(pending.filter((i) => i.kind === 'delete').map((i) => i.sessionId))

      let server: HistoryItem[] = []
      let offline = false
      try {
        server = await fetchHistory()
      } catch {
        offline = true
      }

      const byId = new Map<string, HistoryEntry>()
      for (const item of server) {
        byId.set(item.id, { ...item, pendingSync: pendingIds.has(item.id), localOnly: false })
      }
      // Sin conexión se muestran todas las copias locales; con conexión, solo las pendientes.
      for (const s of local) {
        if (!offline && !pendingIds.has(s.id)) continue
        const stats = sessionStats(s)
        byId.set(s.id, {
          id: s.id,
          title: s.title || 'Entreno',
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMin: s.durationMin,
          rpe: s.rpe,
          completedSets: stats.completedSets,
          tonnageKg: stats.tonnageKg,
          exerciseIds: [...new Set(s.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)))],
          pendingSync: pendingIds.has(s.id),
          localOnly: !byId.has(s.id),
        })
      }
      const items = [...byId.values()]
        .filter((i) => !deletedIds.has(i.id))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      return { items, offline }
    },
  })
}
