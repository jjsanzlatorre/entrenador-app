import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { idbGet, idbPut } from '@/lib/offline/idb'
import { listOutbox } from '@/lib/offline/outbox'
import { listLocalFinishedSessions } from '@/lib/workout/active-session'
import { fetchCommitments, fetchPartnerAdherence, fetchPartnerLinks, fetchSessionLog } from './api'
import { activityDaysFromSessions, sessionMinutes } from './adherence'
import type { Commitment, SessionLogEntry } from './types'

export const sessionLogKey = (userId: string) => ['session-log', userId] as const
export const commitmentsKey = (userId: string) => ['commitments', userId] as const
export const partnersKey = (userId: string) => ['partners', userId] as const

// Sesiones terminadas: las del servidor + las terminadas en el móvil pendientes de subir,
// para que la barra de la semana se actualice al momento aunque no haya conexión.
export function useSessionLog(userId: string) {
  return useQuery({
    queryKey: sessionLogKey(userId),
    networkMode: 'always',
    // Se recalcula al volver a «Hoy» tras terminar una sesión (aunque sea sin conexión).
    staleTime: 0,
    queryFn: async () => {
      const [pending, local] = await Promise.all([
        listOutbox(userId),
        listLocalFinishedSessions(userId),
      ])
      const pendingIds = new Set(pending.filter((i) => i.kind === 'save').map((i) => i.sessionId))
      const deletedIds = new Set(pending.filter((i) => i.kind === 'delete').map((i) => i.sessionId))
      let server: SessionLogEntry[] = []
      let offline = false
      try {
        server = await fetchSessionLog(userId)
      } catch {
        offline = true
      }
      const byId = new Map(server.map((s) => [s.id, s]))
      for (const s of local) {
        if (!s.endedAt || (!offline && !pendingIds.has(s.id))) continue
        const entry: SessionLogEntry = {
          id: s.id,
          sessionType: s.sessionType,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMin: s.durationMin,
          rpe: s.rpe,
          distanceM: s.distanceM ?? null,
        }
        byId.set(s.id, { ...entry, durationMin: sessionMinutes(entry) })
      }
      const sessions = [...byId.values()]
        .filter((s) => !deletedIds.has(s.id))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      return { sessions, offline }
    },
  })
}

// Con copia en el dispositivo para que la barra de «Hoy» funcione sin conexión.
export function useCommitments(userId: string) {
  return useQuery({
    queryKey: commitmentsKey(userId),
    networkMode: 'always',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const key = `commitments:${userId}`
      try {
        const commitments = await fetchCommitments(userId)
        await idbPut('kv', key, commitments)
        return commitments
      } catch (error) {
        const cached = await idbGet<Commitment[]>('kv', key)
        if (cached) return cached
        throw error
      }
    },
  })
}

// Mis datos de cumplimiento: compromisos + días con actividad.
export function useMyAdherenceData(userId: string) {
  const log = useSessionLog(userId)
  const commitments = useCommitments(userId)
  const days = useMemo(() => activityDaysFromSessions(log.data?.sessions ?? []), [log.data])
  return {
    days,
    commitments: commitments.data ?? [],
    isPending: log.isPending || commitments.isPending,
    error: commitments.error,
    offline: log.data?.offline ?? false,
  }
}

export function usePartnerLinks(userId: string) {
  return useQuery({
    queryKey: partnersKey(userId),
    queryFn: fetchPartnerLinks,
    staleTime: 60_000,
  })
}

export function usePartnerAdherence(partnerId: string, enabled = true) {
  return useQuery({
    queryKey: ['partner-adherence', partnerId],
    queryFn: () => fetchPartnerAdherence(partnerId),
    staleTime: 60_000,
    enabled,
  })
}
