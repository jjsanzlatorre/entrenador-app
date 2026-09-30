import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles, Undo2, X } from 'lucide-react'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Button } from '@/components/ui/button'
import {
  aiStatusKey,
  applyTodayAdjust,
  discardProposal,
  revertTodayAdjust,
  useAiRequests,
  useAiStatus,
} from '@/lib/ai/client'
import { ADJUST_LABELS, toPlanBlocks, type AdjustProposal } from '@/lib/ai/schemas'
import { useCheckin } from '@/lib/checkin'
import { notifyError, notifySaved } from '@/lib/notify'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { refreshPlan } from '@/lib/plan/hooks'
import type { DateKey } from '@/lib/progress/dates'
import type { Sex } from '@/types/database'

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; interactionId: string; proposal: AdjustProposal }

// Check-in que sugiere ajustar: energía o sueño muy bajos, muchas agujetas o estrés alto.
export function checkinSuggestsAdjust(
  c:
    | {
        sleep: number | null
        energy: number | null
        soreness: number | null
        stress: number | null
      }
    | null
    | undefined,
) {
  if (!c) return false
  return (
    (c.energy !== null && c.energy <= 2) ||
    (c.sleep !== null && c.sleep <= 2) ||
    (c.soreness !== null && c.soreness >= 4) ||
    (c.stress !== null && c.stress >= 5)
  )
}

const DONE_TEXT = {
  keep: 'Se mantiene la sesión de hoy',
  reduce: 'Sesión de hoy ajustada',
  change: 'Sesión de hoy cambiada',
  rest: 'Hoy toca descanso',
} as const

// «¿Ajusto el entreno de hoy?» en la tarjeta de la sesión planificada: la IA propone mantener,
// reducir, cambiar o descansar; solo se aplica al pulsar «Aceptar».
export function AiAdjust({
  userId,
  today,
  plannedId,
  sex,
  name,
}: {
  userId: string
  today: DateKey
  plannedId: string
  sex: Sex | null
  name: (id: string) => string
}) {
  const status = useAiStatus()
  const checkin = useCheckin(userId, today)
  const ai = useAiRequests()
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [busy, setBusy] = useState(false)

  if (!status.data?.configured) return null
  const left = status.data.limit - status.data.usedToday
  const tired = checkinSuggestsAdjust(checkin.data?.checkin)

  async function ask() {
    setState({ phase: 'loading' })
    const res = await ai.proposeAdjust(plannedId)
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    if (!res.ok) return setState({ phase: 'error', message: res.message })
    if (res.proposal.plannedSessionId !== plannedId) {
      return setState({ phase: 'error', message: 'La sesión de hoy ha cambiado. Prueba de nuevo.' })
    }
    setState({ phase: 'ready', interactionId: res.interactionId, proposal: res.proposal })
  }

  async function accept(interactionId: string, proposal: AdjustProposal) {
    setBusy(true)
    try {
      await applyTodayAdjust(interactionId, proposal.plannedSessionId)
      await refreshPlan(queryClient, userId)
      notifySaved(DONE_TEXT[proposal.adjust.decision])
      setState({ phase: 'idle' })
    } catch (error) {
      notifyError(error, 'aplicar el ajuste')
    } finally {
      setBusy(false)
    }
  }

  async function discard(interactionId: string) {
    setBusy(true)
    try {
      await discardProposal(interactionId)
    } catch (error) {
      console.error('[ai] descartar', error)
    } finally {
      setBusy(false)
      setState({ phase: 'idle' })
    }
  }

  if (state.phase === 'idle') {
    return (
      <div className="flex flex-col gap-1">
        {tired && (
          <p className="text-muted-foreground text-xs">
            Tu check-in de hoy indica cansancio: la IA puede proponerte un ajuste.
          </p>
        )}
        <Button
          variant={tired ? 'secondary' : 'ghost'}
          size="sm"
          disabled={left <= 0}
          onClick={() => void ask()}
        >
          <Sparkles /> {left <= 0 ? 'Sin consultas a la IA hoy' : '¿Ajusto el entreno de hoy?'}
        </Button>
      </div>
    )
  }

  if (state.phase === 'loading') {
    return (
      <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Sparkles className="text-primary size-4 animate-pulse" /> La IA está mirando tu check-in y
        tu carga…
      </p>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="bg-muted flex items-start gap-2 rounded-lg p-3 text-sm">
        <p className="flex-1">{state.message}</p>
        <Button variant="ghost" size="sm" onClick={() => setState({ phase: 'idle' })}>
          Cerrar
        </Button>
      </div>
    )
  }

  return (
    <AdjustProposalView
      adjust={state.proposal.adjust}
      busy={busy}
      sex={sex}
      name={name}
      onAccept={() => void accept(state.interactionId, state.proposal)}
      onDiscard={() => void discard(state.interactionId)}
    />
  )
}

export const ADJUST_DONE_TEXT = DONE_TEXT

// Propuesta de ajuste del día (también la del chat): decisión, motivo y sesión propuesta.
export function AdjustProposalView({
  adjust,
  busy,
  sex,
  name,
  onAccept,
  onDiscard,
}: {
  adjust: AdjustProposal['adjust']
  busy: boolean
  sex: Sex | null
  name: (id: string) => string
  onAccept: () => void
  onDiscard: () => void
}) {
  const label = ADJUST_LABELS[adjust.decision]
  return (
    <section
      aria-label="Propuesta de la IA"
      className="border-primary/40 bg-primary/5 flex flex-col gap-3 rounded-xl border p-3"
    >
      <p className="text-primary flex items-center gap-1 text-xs font-medium uppercase">
        <Sparkles className="size-3" /> Propuesta de la IA
      </p>
      <p className="text-lg font-bold">
        <span aria-hidden>{label.emoji} </span>
        {label.label}
      </p>
      <p className="text-sm">{adjust.reason}</p>
      {adjust.session && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">
            {adjust.session.title}{' '}
            <span className="text-muted-foreground font-normal">
              · {adjust.session.duration_min} min · {INTENSITY_LABELS[adjust.session.intensity]}
            </span>
          </p>
          <PlannedBlocks blocks={toPlanBlocks(adjust.session.blocks)} name={name} sex={sex} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={onAccept}>
          <Check /> Aceptar
        </Button>
        <Button variant="outline" disabled={busy} onClick={onDiscard}>
          <X /> Descartar
        </Button>
      </div>
    </section>
  )
}

// Sesión ajustada por la IA: aviso y «Deshacer».
export function AdjustedNotice({ userId, plannedId }: { userId: string; plannedId: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function undo() {
    setBusy(true)
    try {
      await revertTodayAdjust(plannedId)
      await refreshPlan(queryClient, userId)
      notifySaved('Ajuste deshecho: vuelve la sesión original')
    } catch (error) {
      notifyError(error, 'deshacer el ajuste')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <Sparkles className="text-primary size-3.5 shrink-0" />
      <span className="text-muted-foreground flex-1">Cambio de la IA aceptado</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void undo()}>
        <Undo2 /> Deshacer
      </Button>
    </div>
  )
}
