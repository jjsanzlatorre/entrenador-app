// «Copiar bloque de otra sesión» (§7): elegir una sesión del historial → elegir un bloque → se
// añade a la sesión en curso (o al entreno pasado) con sus ejercicios, valores y rondas.
import { useState } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useHistory } from '@/lib/workout/hooks'
import { blockRounds, isRoundBlock, roundBlockLabel } from '@/lib/workout/rounds'
import { loadSessionForRepeat } from '@/lib/workout/templates-api'
import { isTimedBlock } from '@/lib/workout/timed-blocks'
import type { Exercise, LocalBlock, LocalSession } from '@/lib/workout/types'
import { BLOCK_LABELS } from './timed-block-card'
import { shortSetValues } from './round-block-card'

function blockTitle(block: LocalBlock) {
  if (isTimedBlock(block)) return BLOCK_LABELS[block.blockType] ?? 'Bloque'
  if (isRoundBlock(block) && block.exercises.length > 1) {
    const rounds = blockRounds(block).length
    return `${roundBlockLabel(block)} · ${rounds} ${rounds === 1 ? 'ronda' : 'rondas'}`
  }
  const sets = block.sets.length
  return `${sets} ${sets === 1 ? 'serie' : 'series'}`
}

function blockLines(block: LocalBlock, byId: Map<string, Exercise>) {
  return block.exercises.map((e) => {
    const exercise = byId.get(e.exerciseId)
    const ref =
      block.sets.find((s) => s.exerciseId === e.exerciseId && s.completed) ??
      block.sets.find((s) => s.exerciseId === e.exerciseId)
    const values = ref && !isTimedBlock(block) ? shortSetValues(ref, exercise, e.perSide) : ''
    return `${exercise?.name ?? e.exerciseId}${values && values !== '—' ? ` · ${values}` : ''}`
  })
}

export function CopyBlockSheet({
  open,
  userId,
  excludeSessionId,
  exercisesById,
  onClose,
  onCopy,
}: {
  open: boolean
  userId: string
  // La sesión en curso no sale en la lista.
  excludeSessionId: string
  exercisesById: Map<string, Exercise>
  onClose: () => void
  onCopy: (block: LocalBlock) => void
}) {
  const history = useHistory(userId)
  const [picked, setPicked] = useState<LocalSession | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = (history.data?.items ?? [])
    .filter((i) => i.endedAt && i.exerciseIds.length > 0 && i.id !== excludeSessionId)
    .slice(0, 30)

  function close() {
    setPicked(null)
    setError(null)
    onClose()
  }

  async function choose(id: string) {
    setLoading(id)
    setError(null)
    try {
      const session = await loadSessionForRepeat(id)
      if (!session) setError('No se ha podido abrir esa sesión (¿sin conexión?).')
      else setPicked(session)
    } catch {
      setError('No se ha podido abrir esa sesión (¿sin conexión?).')
    } finally {
      setLoading(null)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      className="h-[92dvh]"
      title={
        picked ? (
          <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1">
            <ChevronLeft className="size-5" /> {picked.title || 'Entreno'}
          </button>
        ) : (
          'Copiar bloque de otra sesión'
        )
      }
    >
      {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
      {!picked && (
        <div className="flex flex-col gap-2 pb-4">
          {history.isPending && (
            <p className="text-muted-foreground py-4 text-center text-sm">Cargando…</p>
          )}
          {!history.isPending && items.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Aún no hay sesiones con ejercicios en el historial.
            </p>
          )}
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void choose(item.id)}
                  className="flex min-h-14 w-full flex-col items-start justify-center py-2 text-left"
                >
                  <span className="font-semibold">{item.title || 'Entreno'}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(item.startedAt).toLocaleDateString('es-ES', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' · '}
                    {item.exerciseIds
                      .slice(0, 3)
                      .map((id) => exercisesById.get(id)?.name ?? id)
                      .join(', ')}
                    {item.exerciseIds.length > 3 ? '…' : ''}
                    {loading === item.id ? ' · abriendo…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {picked && (
        <ul className="flex flex-col gap-2 pb-4" aria-label="Bloques de la sesión">
          {picked.blocks
            .filter((b) => b.exercises.length > 0)
            .map((block, i) => (
              <li key={block.id} className="rounded-xl border p-3">
                <p className="text-primary text-xs font-semibold uppercase">
                  Bloque {String.fromCharCode(65 + i)} · {blockTitle(block)}
                </p>
                <ul className="mt-1 text-sm">
                  {blockLines(block, exercisesById).map((line, j) => (
                    <li key={j} className="truncate">
                      {line}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-2 w-full"
                  onClick={() => {
                    onCopy(block)
                    close()
                  }}
                >
                  <Plus /> Añadir este bloque
                </Button>
              </li>
            ))}
        </ul>
      )}
    </Sheet>
  )
}
