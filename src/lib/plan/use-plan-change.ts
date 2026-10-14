import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { notifyError, notifySaved, notifyUndoable, notifyWarning } from '@/lib/notify'
import { applyPlanChange, undoPlanChange } from './api'
import { refreshPlan } from './hooks'
import type { PlanChange } from './reschedule'

// Aplica un cambio de fechas del plan con aviso y «Deshacer» en el propio toast.
export function usePlanChange(userId: string) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function undo(changeId: string) {
    setBusy(true)
    try {
      await undoPlanChange(changeId)
      await refreshPlan(queryClient, userId)
      notifySaved('Cambio deshecho')
    } catch (error) {
      notifyError(error, 'deshacer')
    } finally {
      setBusy(false)
    }
  }

  async function apply(
    planId: string,
    change: PlanChange,
    success: string,
    warnings: string[] = [],
  ): Promise<boolean> {
    setBusy(true)
    try {
      const changeId = await applyPlanChange(planId, change)
      await refreshPlan(queryClient, userId)
      notifyUndoable(success, () => void undo(changeId))
      for (const w of warnings) notifyWarning(w)
      return true
    } catch (error) {
      notifyError(error, 'cambiar el plan')
      return false
    } finally {
      setBusy(false)
    }
  }

  return { apply, undo, busy }
}
