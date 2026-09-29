import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { primaryMusclesText } from '@/components/workout/exercise-list-item'
import { Button } from '@/components/ui/button'
import { aiStatusKey, markSwapAccepted, useAiRequests, useAiStatus } from '@/lib/ai/client'
import type { SwapProposal } from '@/lib/ai/schemas'
import type { Exercise } from '@/lib/workout/types'

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; interactionId: string; proposal: SwapProposal }

// Sustituir con IA (§11.6): solo aparece cuando las reglas no encuentran alternativa con los
// mismos músculos y el material disponible. Elegir una alternativa es la confirmación.
export function AiSwap({
  exercise,
  exercises,
  onPick,
}: {
  exercise: Exercise
  exercises: Exercise[]
  onPick: (exercise: Exercise) => void
}) {
  const status = useAiStatus()
  const ai = useAiRequests()
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>({ phase: 'idle' })

  if (!status.data?.configured) return null
  const left = status.data.limit - status.data.usedToday
  const byId = new Map(exercises.map((e) => [e.id, e]))

  async function ask() {
    setState({ phase: 'loading' })
    const res = await ai.proposeSwap(exercise.id)
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    setState(
      res.ok
        ? { phase: 'ready', interactionId: res.interactionId, proposal: res.proposal }
        : { phase: 'error', message: res.message },
    )
  }

  if (state.phase === 'idle') {
    return (
      <Button variant="secondary" disabled={left <= 0} onClick={() => void ask()}>
        <Sparkles /> {left <= 0 ? 'Sin consultas a la IA hoy' : 'Pedir una alternativa a la IA'}
      </Button>
    )
  }
  if (state.phase === 'loading') {
    return (
      <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Sparkles className="text-primary size-4 animate-pulse" /> Buscando una alternativa…
      </p>
    )
  }
  if (state.phase === 'error') {
    return <p className="bg-muted rounded-lg p-3 text-sm">{state.message}</p>
  }

  const options = state.proposal.alternatives.flatMap((a) => {
    const e = byId.get(a.exercise_id)
    return e ? [{ exercise: e, reason: a.reason }] : []
  })
  return (
    <section aria-label="Alternativas de la IA" className="flex flex-col gap-1">
      <p className="text-primary flex items-center gap-1 text-xs font-medium uppercase">
        <Sparkles className="size-3" /> Propuesta de la IA · toca una para usarla
      </p>
      <ul className="divide-y">
        {options.map(({ exercise: e, reason }) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => {
                markSwapAccepted(state.interactionId)
                onPick(e)
              }}
              className="hover:bg-accent active:bg-accent flex min-h-14 w-full flex-col rounded-lg px-2 py-2 text-left"
            >
              <span className="font-medium">{e.name}</span>
              <span className="text-muted-foreground text-sm">{primaryMusclesText(e)}</span>
              <span className="text-xs">{reason}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
