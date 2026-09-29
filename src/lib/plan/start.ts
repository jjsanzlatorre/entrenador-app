// Empezar una sesión planificada (desde Plan o desde «Hoy»): la convierte en sesión en curso
// prellenada con la prescripción, la sugerencia de peso y la última vez.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { notifyError } from '@/lib/notify'
import { startPreparedSession } from '@/lib/workout/active-session'
import { getExerciseHistory, getLastPerformance } from '@/lib/workout/api'
import { useCatalog } from '@/lib/workout/hooks'
import type { Exercise, LastPerformance, LocalSession } from '@/lib/workout/types'
import type { PlannedSession } from './api'
import { plannedToLocalSession } from './to-session'

type Startable = Pick<PlannedSession, 'id' | 'sessionType' | 'title' | 'blocks'>

export async function preparePlannedSession(
  planned: Startable,
  userId: string,
  catalog: Map<string, Exercise>,
  now = Date.now(),
): Promise<LocalSession> {
  const ids = [...new Set(planned.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id)))]
  let last = new Map<string, LastPerformance>()
  let history = new Map<string, LastPerformance[]>()
  try {
    ;[last, history] = await Promise.all([
      getLastPerformance(userId, ids, null),
      getExerciseHistory(userId, ids, null),
    ])
  } catch {
    // sin conexión ni copia: sin precarga de pesos
  }
  return plannedToLocalSession(
    {
      id: planned.id,
      session_type: planned.sessionType,
      title: planned.title,
      blocks: planned.blocks,
    },
    userId,
    catalog,
    last,
    now,
    undefined,
    history,
  )
}

export function useStartPlanned(userId: string) {
  const navigate = useNavigate()
  const catalog = useCatalog(userId)
  const [busy, setBusy] = useState(false)

  async function start(planned: Startable) {
    setBusy(true)
    try {
      const session = await preparePlannedSession(planned, userId, catalog.byId)
      const { started } = await startPreparedSession(session)
      if (!started)
        notifyError('ya tienes una sesión en curso; termínala o descártala antes', 'empezar')
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'empezar la sesión')
    } finally {
      setBusy(false)
    }
  }

  return { start, busy }
}
