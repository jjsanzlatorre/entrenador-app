// Textos de resumen de una sesión para el historial.
import type { SessionType } from '@/types/database'
import { formatInt } from './format'
import { formatDistance, formatPace, paceKindForSession } from './pace'
import { CARDIO_TYPES } from './session-kinds'

export type HistorySummaryInput = {
  sessionType: SessionType
  endedAt: string | null
  durationMin: number | null
  rpe: number | null
  distanceM: number | null
  completedSets: number
  tonnageKg: number
  exerciseIds: string[]
}

const QUICK = new Set<SessionType>(['yoga', 'surf', 'padel_fronton', 'other'])

export function historySummary(item: HistorySummaryInput, exerciseName: (id: string) => string) {
  const parts: string[] = []
  if (!item.endedAt) parts.push('Sin terminar')
  else if (item.durationMin !== null) parts.push(`${item.durationMin} min`)

  const pace = paceKindForSession(item.sessionType)
  if (CARDIO_TYPES.has(item.sessionType) && item.distanceM) {
    parts.push(formatDistance(item.distanceM, pace))
    if (pace && item.durationMin) {
      const p = formatPace(pace, item.distanceM, item.durationMin * 60)
      if (p) parts.push(p)
    }
    return parts.join(' · ')
  }
  if (QUICK.has(item.sessionType)) {
    if (item.rpe) parts.push(`RPE ${item.rpe}`)
    return parts.join(' · ')
  }
  parts.push(`${item.completedSets} series`)
  if (item.tonnageKg > 0) parts.push(`${formatInt(item.tonnageKg)} kg`)
  if (item.exerciseIds.length > 0) {
    parts.push(item.exerciseIds.slice(0, 3).map(exerciseName).join(', '))
  }
  return parts.join(' · ')
}
