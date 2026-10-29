// «Escribir entreno» (§7): texto libre → vista previa editable → «Añadir». Primero el parser de
// la app (src/lib/workout/text-parse.ts); si no lo entiende del todo, la IA (modelo normal,
// 1 consulta). Los ejercicios que no se reconocen quedan marcados para elegirlos o crearlos.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { aiStatusKey, useAiRequests, useAiStatus } from '@/lib/ai/client'
import { WORKOUT_TEXT_MAX } from '@/lib/ai/schemas'
import { isOnline } from '@/lib/workout/api'
import {
  draftFromParsed,
  draftProblems,
  draftToInput,
  type RoundDraft,
} from '@/lib/workout/round-draft'
import type { RoundBlockInput } from '@/lib/workout/rounds'
import { parsedFromAi, parseWorkoutText } from '@/lib/workout/text-parse'
import type { Exercise, LastPerformance } from '@/lib/workout/types'
import { RoundBlockEditor } from './round-block-editor'

const EXAMPLE =
  'plancha lateral 45s/lado + hip thrust 20 + dominadas 5 + plancha 45s + flexiones 25, x4'

type Phase =
  | { kind: 'text' }
  | { kind: 'thinking' }
  | { kind: 'preview'; drafts: RoundDraft[]; note: string | null }

export function WriteWorkoutSheet({
  open,
  exercises,
  equipment,
  userId,
  loadLast,
  onClose,
  onAdd,
}: {
  open: boolean
  exercises: Exercise[]
  equipment: string[]
  userId: string
  loadLast?: (exercise: Exercise) => Promise<LastPerformance | null>
  onClose: () => void
  onAdd: (blocks: RoundBlockInput[]) => void
}) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'text' })
  const [error, setError] = useState<string | null>(null)
  const ai = useAiRequests()
  const status = useAiStatus()
  const queryClient = useQueryClient()
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const aiLeft = status.data?.configured ? status.data.limit - status.data.usedToday : 0

  function close() {
    setPhase({ kind: 'text' })
    setError(null)
    onClose()
  }

  async function interpret() {
    setError(null)
    const parsed = parseWorkoutText(text, exercises)
    const local = parsed.blocks.map((b) => draftFromParsed(b, byId))
    if (parsed.understood) {
      setPhase({ kind: 'preview', drafts: local, note: null })
      return
    }
    // No lo ha entendido del todo: la IA, si está disponible.
    if (aiLeft > 0 && isOnline()) {
      setPhase({ kind: 'thinking' })
      const res = await ai.parseWorkout(text.slice(0, WORKOUT_TEXT_MAX))
      void queryClient.invalidateQueries({ queryKey: aiStatusKey })
      if (res.ok) {
        const fromAi = parsedFromAi(res.parse.blocks, exercises)
        setPhase({
          kind: 'preview',
          drafts: fromAi.blocks.map((b) => draftFromParsed(b, byId)),
          note: 'Interpretado con la IA (1 consulta). Revísalo antes de añadirlo.',
        })
        return
      }
      if (local.length === 0) {
        setPhase({ kind: 'text' })
        setError(res.message)
        return
      }
      setPhase({
        kind: 'preview',
        drafts: local,
        note: `La IA no ha podido ayudar (${res.message}). Revisa lo marcado.`,
      })
      return
    }
    if (local.length === 0) {
      setError(`No lo he entendido. Prueba así: «${EXAMPLE}».`)
      return
    }
    setPhase({ kind: 'preview', drafts: local, note: null })
  }

  const drafts = phase.kind === 'preview' ? phase.drafts : []
  const setDraft = (index: number, draft: RoundDraft) =>
    phase.kind === 'preview' &&
    setPhase({ ...phase, drafts: phase.drafts.map((d, i) => (i === index ? draft : d)) })
  const problems = drafts.flatMap((d) => draftProblems(d, byId))
  const inputs = drafts.map((d) => draftToInput(d, byId))
  const ready = inputs.length > 0 && inputs.every((i) => i !== null)

  return (
    <Sheet open={open} onClose={close} title="Escribir entreno" className="h-[92dvh]">
      {phase.kind !== 'preview' && (
        <div className="flex flex-col gap-3 pb-4">
          <label htmlFor="workout-text" className="text-sm font-medium">
            Escribe el entreno como lo apuntarías en una libreta
          </label>
          <Textarea
            id="workout-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={WORKOUT_TEXT_MAX}
            rows={5}
            placeholder={EXAMPLE}
            className="text-base"
          />
          <ul className="text-muted-foreground list-disc pl-5 text-xs">
            <li>«+» une ejercicios en una superserie o circuito; «x4» = 4 rondas.</li>
            <li>«3x10» = 3 series de 10 · «45s», «1:30», «2 min» · «@20kg» · «400m» · «20 cal».</li>
            <li>«/lado» o «cada lado» en unilaterales · un bloque por línea o «;».</li>
          </ul>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button
            size="lg"
            className="h-14 text-lg"
            disabled={!text.trim() || phase.kind === 'thinking'}
            onClick={() => void interpret()}
          >
            {phase.kind === 'thinking' ? (
              <>
                <Sparkles className="animate-pulse" /> Interpretando con la IA…
              </>
            ) : (
              <>
                <Wand2 /> Interpretar
              </>
            )}
          </Button>
        </div>
      )}
      {phase.kind === 'preview' && (
        <div className="flex flex-col gap-3 pb-4">
          {phase.note && <p className="bg-muted rounded-lg p-2 text-sm">{phase.note}</p>}
          {drafts.map((draft, i) => (
            <section
              key={i}
              className="rounded-2xl border p-2"
              aria-label={`Bloque ${i + 1} de la vista previa`}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-primary text-sm font-semibold uppercase">
                  Bloque {String.fromCharCode(65 + i)}
                </h3>
                <button
                  type="button"
                  aria-label={`Quitar el bloque ${i + 1}`}
                  onClick={() =>
                    setPhase({ ...phase, drafts: phase.drafts.filter((_, j) => j !== i) })
                  }
                  className="text-destructive p-2"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <RoundBlockEditor
                idPrefix={`write-${i}`}
                draft={draft}
                onChange={(d) => setDraft(i, d)}
                exercises={exercises}
                equipment={equipment}
                userId={userId}
                loadLast={loadLast}
                compact
              />
            </section>
          ))}
          {problems.length > 0 && (
            <ul className="text-destructive text-sm" aria-label="Por revisar">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
          <Button
            size="lg"
            className="h-14 text-lg"
            disabled={!ready}
            onClick={() => {
              onAdd(inputs.filter((x): x is RoundBlockInput => x !== null))
              setText('')
              close()
            }}
          >
            <Plus /> Añadir {drafts.length === 1 ? 'el bloque' : `${drafts.length} bloques`}
          </Button>
          <Button variant="ghost" onClick={() => setPhase({ kind: 'text' })}>
            Volver a editar el texto
          </Button>
        </div>
      )}
    </Sheet>
  )
}
