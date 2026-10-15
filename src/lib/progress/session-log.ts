// Entrada del registro de sesiones (cumplimiento, carga, logros, plan) a partir de una sesión
// guardada en el móvil y pendiente de subir. Usa su fecha real (también la de un entreno
// registrado a posteriori o movido de día).
import { sessionStats } from '@/lib/workout/calc'
import { totalDistanceM } from '@/lib/workout/session-ops'
import type { LocalSession } from '@/lib/workout/types'
import { sessionMinutes } from './adherence'
import type { SessionLogEntry } from './types'

export function logEntryFromLocal(s: LocalSession & { endedAt: string }): SessionLogEntry {
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
  return { ...entry, durationMin: sessionMinutes(entry) }
}
