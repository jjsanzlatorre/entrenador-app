// Empezar una sesión planificada (desde Plan o desde «Hoy»): la convierte en sesión en curso
// prellenada con la prescripción, la sugerencia de peso y la última vez.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { notifyError } from '@/lib/notify'
import { asPastSession, startPreparedSession } from '@/lib/workout/active-session'
import { whenToMs } from '@/lib/workout/when'
import { getExerciseHistory, getLastPerformance } from '@/lib/workout/api'
import { useCatalog } from '@/lib/workout/hooks'
import type { Exercise, LastPerformance, LocalSession } from '@/lib/workout/types'
import type { PlannedSession } from './api'
import { plannedToLocalSession } from './to-session'

type Startable = Pick<PlannedSession, 'id' | 'sessionType' | 'title' | 'blocks'>

// Hora por defecto de una planificada que se registra a posteriori: las 18:00 de ese día (sin
// pasar de ahora). Se puede cambiar al guardar.
export function pastStartFor(date: string, now = Date.now()) {
  return Math.min(whenToMs({ date, time: '18:00' }) ?? now, now)
}

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

  // «Registrar como hecha» (planificada de un día pasado): modo «entreno pasado» con la
  // estructura del plan, la fecha de ese día y enlazada a la planificada.
  async function logPast(planned: Startable & { date: string }) {
    setBusy(true)
    try {
      const prepared = await preparePlannedSession(planned, userId, catalog.byId)
      const session = asPastSession(prepared, pastStartFor(planned.date))
      const { started } = await startPreparedSession(session)
      if (!started)
        notifyError('ya tienes una sesión en curso; termínala o descártala antes', 'registrar')
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'registrar la sesión')
    } finally {
      setBusy(false)
    }
  }

  return { start, logPast, busy }
}
