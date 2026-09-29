import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { idbGet, idbPut } from '@/lib/offline/idb'
import { listOutbox } from '@/lib/offline/outbox'
import { listLocalFinishedSessions } from '@/lib/workout/active-session'
import { sessionStats } from '@/lib/workout/calc'
import { totalDistanceM } from '@/lib/workout/session-ops'
import {
  fetchCommitments,
  fetchEquivalenceCatalog,
  fetchPartnerAdherence,
  fetchPartnerLinks,
  fetchSessionExerciseSets,
  fetchSessionLog,
  fetchSessionTotals,
} from './api'
import { activityDaysFromSessions, sessionMinutes } from './adherence'
import type { EquivalenceCatalog } from './equivalences'
import { addDays, type DateKey } from './dates'
import { loadShownMilestones } from './milestones-store'
import { localSetCounts, type ExerciseSetCount } from './muscle-volume'
import type { Commitment, SessionLogEntry } from './types'

export const sessionLogKey = (userId: string) => ['session-log', userId] as const
export const commitmentsKey = (userId: string) => ['commitments', userId] as const
export const partnersKey = (userId: string) => ['partners', userId] as const
export const milestonesKey = (userId: string) => ['milestones', userId] as const

type Totals = Record<string, { tonnageKg: number; totalReps: number }>

// Tonelaje y reps por sesión del servidor, con copia en el dispositivo.
async function loadSessionTotals(userId: string): Promise<Totals> {
  const key = `session-totals:${userId}`
  try {
    const totals = await fetchSessionTotals()
    await idbPut('kv', key, totals)
    return totals
  } catch {
    return (await idbGet<Totals>('kv', key)) ?? {}
  }
}

// Sesiones terminadas: las del servidor + las terminadas en el móvil pendientes de subir,
// para que la barra de la semana se actualice al momento aunque no haya conexión.
export function useSessionLog(userId: string, enabled = true) {
  return useQuery({
    queryKey: sessionLogKey(userId),
    enabled,
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
      const totalsPromise = loadSessionTotals(userId)
      try {
        server = await fetchSessionLog(userId)
      } catch {
        offline = true
      }
      const totals = await totalsPromise
      const byId = new Map<string, SessionLogEntry>(
        server.map((s) => [s.id, { ...s, tonnageKg: 0, totalReps: 0, ...totals[s.id] }]),
      )
      for (const s of local) {
        if (!s.endedAt || (!offline && !pendingIds.has(s.id))) continue
        const stats = sessionStats(s)
        const entry: SessionLogEntry = {
          id: s.id,
          sessionType: s.sessionType,
          activityTypeId: s.activityTypeId ?? null,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMin: s.durationMin,
          rpe: s.rpe,
          distanceM: s.distanceM ?? totalDistanceM(s),
          plannedSessionId: s.plannedSessionId ?? null,
          tonnageKg: stats.tonnageKg,
          totalReps: stats.totalReps,
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

// Catálogo de objetos y destinos (global), con copia en el dispositivo.
export function useEquivalenceCatalog() {
  return useQuery({
    queryKey: ['equivalence-catalog'],
    networkMode: 'always',
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const key = 'equivalence-catalog'
      try {
        const catalog = await fetchEquivalenceCatalog()
        await idbPut('kv', key, catalog)
        return catalog
      } catch (error) {
        const cached = await idbGet<EquivalenceCatalog>('kv', key)
        if (cached) return cached
        throw error
      }
    },
  })
}

export function useShownMilestones(userId: string) {
  return useQuery({
    queryKey: milestonesKey(userId),
    networkMode: 'always',
    staleTime: 0,
    queryFn: () => loadShownMilestones(userId),
  })
}

export const localMidnight = (key: DateKey) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

// Series efectivas por sesión y ejercicio de las sesiones empezadas entre `from` y `to`
// (días incluidos). Del servidor, con copia en el dispositivo, y las sesiones terminadas en el
// móvil pendientes de subir (o todas las locales si no hay conexión) sustituyen a las del servidor.
export function useExerciseSetCounts(userId: string, from: DateKey, to: DateKey, enabled = true) {
  return useQuery({
    queryKey: ['exercise-set-counts', userId, from, to],
    enabled,
    networkMode: 'always',
    staleTime: 0,
    queryFn: async () => {
      const key = `exercise-set-counts:${userId}:${from}:${to}`
      const [pending, local] = await Promise.all([
        listOutbox(userId),
        listLocalFinishedSessions(userId),
      ])
      const pendingIds = new Set(pending.filter((i) => i.kind === 'save').map((i) => i.sessionId))
      let server: ExerciseSetCount[]
      let offline = false
      try {
        server = await fetchSessionExerciseSets(localMidnight(from), localMidnight(addDays(to, 1)))
        await idbPut('kv', key, server)
      } catch {
        offline = true
        server = (await idbGet<ExerciseSetCount[]>('kv', key)) ?? []
      }
      const replaced = local.filter((s) => offline || pendingIds.has(s.id))
      const replacedIds = new Set(replaced.map((s) => s.id))
      const counts = [
        ...server.filter((c) => !replacedIds.has(c.sessionId)),
        ...replaced.flatMap(localSetCounts),
      ]
      return { counts, offline }
    },
  })
}
