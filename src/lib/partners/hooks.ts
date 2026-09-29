// Hooks de la fase 7A. «Owner» = de quién son los datos que se pintan: yo (con la copia local
// y las sesiones pendientes de subir) o una persona vinculada (solo del servidor, sin copia en
// el móvil: si deja de compartir, desaparece en la siguiente consulta).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  localMidnight,
  useExerciseSetCounts,
  usePartnerLinks,
  useSessionLog,
} from '@/lib/progress/hooks'
import { addDays, type DateKey } from '@/lib/progress/dates'
import { useCatalog } from '@/lib/workout/hooks'
import type { Exercise } from '@/lib/workout/types'
import {
  fetchPairInvites,
  fetchPartnerExercises,
  fetchPartnerSessionLog,
  fetchPartnerSetCounts,
  fetchPendingPairInvites,
  fetchReactions,
} from './api'

export type DataOwner = {
  // Usuario que mira.
  viewerId: string
  // Dueño de los datos (= viewerId si son los míos).
  userId: string
}

export const isPartnerOwner = (owner: DataOwner) => owner.userId !== owner.viewerId

export const partnerLogKey = (partnerId: string) => ['partner-log', partnerId] as const

export function useOwnerSessionLog(owner: DataOwner) {
  const partner = isPartnerOwner(owner)
  const own = useSessionLog(owner.viewerId, !partner)
  const theirs = useQuery({
    queryKey: partnerLogKey(owner.userId),
    queryFn: async () => ({ sessions: await fetchPartnerSessionLog(owner.userId), offline: false }),
    enabled: partner,
    staleTime: 30_000,
  })
  return partner ? theirs : own
}

export function useOwnerSetCounts(owner: DataOwner, from: DateKey, to: DateKey) {
  const partner = isPartnerOwner(owner)
  const own = useExerciseSetCounts(owner.viewerId, from, to, !partner)
  const theirs = useQuery({
    queryKey: ['partner-set-counts', owner.userId, from, to],
    queryFn: async () => ({
      counts: await fetchPartnerSetCounts(
        owner.userId,
        localMidnight(from),
        localMidnight(addDays(to, 1)),
      ),
      offline: false,
    }),
    enabled: partner,
    staleTime: 30_000,
  })
  return partner ? theirs : own
}

// Mi catálogo (globales + propios) y, si miro a otra persona, también sus ejercicios propios.
export function useOwnerCatalog(owner: DataOwner) {
  const partner = isPartnerOwner(owner)
  const mine = useCatalog(owner.viewerId)
  const theirs = useQuery({
    queryKey: ['partner-exercises', owner.userId],
    queryFn: () => fetchPartnerExercises(owner.userId),
    enabled: partner,
    staleTime: 5 * 60_000,
  })
  const byId = useMemo(() => {
    if (!partner) return mine.byId
    const map = new Map<string, Exercise>(mine.byId)
    for (const e of theirs.data ?? []) map.set(e.id, e)
    return map
  }, [partner, mine.byId, theirs.data])
  return {
    byId,
    isPending: mine.isPending || (partner && theirs.isPending),
  }
}

export function usePartnerLink(userId: string, partnerId: string) {
  const links = usePartnerLinks(userId)
  const link = links.data?.find((l) => l.partnerId === partnerId && l.status === 'accepted')
  return { link: link ?? null, isPending: links.isPending, error: links.error }
}

// ── Entreno en pareja ───────────────────────────────────────

export const pairInvitesKey = (userId: string) => ['pair-invites', userId] as const

export function usePendingPairInvites(userId: string) {
  return useQuery({
    queryKey: pairInvitesKey(userId),
    queryFn: () => fetchPendingPairInvites(userId),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

export function usePairInvites(pairGroupId: string | null | undefined, refetch = false) {
  return useQuery({
    queryKey: ['pair-group', pairGroupId],
    queryFn: () => fetchPairInvites(pairGroupId!),
    enabled: Boolean(pairGroupId),
    staleTime: 15_000,
    refetchInterval: refetch ? 30_000 : false,
    retry: false,
  })
}

// ── Reacciones ──────────────────────────────────────────────

export const reactionsKey = (userId: string) => ['reactions', userId] as const

export function useReactions(userId: string) {
  return useQuery({
    queryKey: reactionsKey(userId),
    queryFn: () => fetchReactions(),
    staleTime: 30_000,
    retry: false,
  })
}
