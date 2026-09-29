// Fila de commitments → Commitment (lo usan el cliente y el servidor de recordatorios).
import type { Json, SessionType } from '@/types/database'
import type { Commitment } from './types'

export type CommitmentRowLite = {
  id: string
  valid_from: string
  valid_to: string | null
  sessions_per_week: number
  minutes_per_week: number | null
  by_type: Json | null
  counts_free_activities: boolean
}

export function toCommitment(r: CommitmentRowLite): Commitment {
  return {
    id: r.id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    sessionsPerWeek: r.sessions_per_week,
    minutesPerWeek: r.minutes_per_week,
    byType:
      r.by_type && typeof r.by_type === 'object' && !Array.isArray(r.by_type)
        ? (r.by_type as Partial<Record<SessionType, number>>)
        : null,
    countsFreeActivities: r.counts_free_activities,
  }
}
