// Superserie o circuito por rondas (§7): cada ronda es una tarjeta compacta. La ronda en curso
// va abierta (una fila por ejercicio, con ✓ o deslizar como siempre) y las demás en una línea
// con su resumen; «✓ Ronda» completa la ronda entera de un toque. Debajo: «+1 ronda», «Quitar
// ronda» y «Duplicar bloque».
import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Info,
  Link2,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { describeDistance } from '@/lib/input/quantity'
import { distanceUnit, fieldSpecs } from '@/lib/workout/fields'
import { formatClock, formatKg } from '@/lib/workout/format'
import {
  blockRounds,
  currentRoundIndex,
  followingDiffer,
  roundBlockLabel,
  roundSettings,
} from '@/lib/workout/rounds'
import type { SetPatch } from '@/lib/workout/session-ops'
import type { Exercise, LocalBlock, SetEntry } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { ExerciseMenuSheet, MenuButton, type BlockActions, type BlockDrag } from './block-card'
import { ExerciseTechniqueSheet } from './exercise-technique'
import { SetRow } from './set-row'

export type RoundActions = {
  onCompleteRound: (blockId: string, roundIndex: number) => void
  onUncompleteRound: (blockId: string, roundIndex: number) => void
  onAddRound: (blockId: string) => void
  onRemoveRound: (blockId: string) => void
  onDuplicate: (blockId: string) => void
  onEdit: (blockId: string) => void
  onRemoveBlock: (blockId: string) => void
  onApplyFollowing: (setId: string) => void
  // Cambiar un valor solo en esa ronda (las siguientes, con «Aplicar a las rondas siguientes»).
  onChangeSet: (setId: string, patch: SetPatch) => void
}

// «45 s/lado», «40 kg × 20», «5», «500 m», «20 cal».
export function shortSetValues(
  set: SetEntry,
  exercise: Exercise | undefined,
  perSide = false,
): string {
  const parts = fieldSpecs(exercise).flatMap((spec) => {
    const v = set[spec.field]
    if (v === null) return []
    if (spec.field === 'weightKg') return [`${formatKg(v)} kg`]
    if (spec.field === 'durationS') return [formatClock(v)]
    if (spec.field === 'distanceM') return [describeDistance(v, distanceUnit(exercise))]
    if (spec.field === 'calories') return [`${v} cal`]
    return [String(v)]
  })
  const text = parts.join(' × ') || '—'
  return perSide ? `${text}/lado` : text
}

function restText(seconds: number) {
  return seconds > 0 ? formatClock(seconds) : 'sin descanso'
}

export function RoundBlockCard({
  block,
  letter,
  isFirst,
  isLast,
  exercisesById,
  selectedSetId,
  actions,
  roundActions,
  canMergeNext = false,
  drag,
}: {
  block: LocalBlock
  letter: string
  isFirst: boolean
  isLast: boolean
  exercisesById: Map<string, Exercise>
  selectedSetId: string | null
  actions: BlockActions
  roundActions: RoundActions
  canMergeNext?: boolean
  drag?: BlockDrag
}) {
  const rounds = blockRounds(block)
  const current = currentRoundIndex(block)
  const settings = roundSettings(block)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [edited, setEdited] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [blockMenu, setBlockMenu] = useState(false)
  const [techniqueFor, setTechniqueFor] = useState<string | null>(null)
  const label = roundBlockLabel(block)
  const done = rounds.filter((r) => r.complete).length

  const toggleOpen = (index: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <section
      className={cn(
        'bg-card border-primary/40 rounded-2xl border p-3 shadow-xs transition-shadow',
        drag?.dragging &&
          drag.dragging !== block.id &&
          drag.over === block.id &&
          'ring-primary ring-4',
        drag?.dragging === block.id && 'opacity-60',
      )}
      aria-label={`Bloque ${letter}`}
      data-drop-block={block.id}
      data-round-block={block.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-primary flex items-center gap-1 text-xs font-semibold uppercase">
            <Link2 className="size-3.5" /> {label} {letter}
          </p>
          <h3 className="text-lg leading-tight font-semibold" data-testid="round-title">
            {rounds.length} {rounds.length === 1 ? 'ronda' : 'rondas'}
            <span className="text-muted-foreground text-sm font-normal"> · {done} hechas</span>
          </h3>
          <p className="text-muted-foreground text-xs">
            Entre ejercicios: {restText(settings.restBetweenExercisesS)} · entre rondas:{' '}
            {restText(settings.restBetweenRoundsS)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setBlockMenu(true)}
          aria-label={`Opciones del bloque ${letter}`}
          className="hover:bg-accent -mr-1 rounded-full p-2"
        >
          <MoreVertical className="size-5" />
        </button>
      </div>

      <ol className="mt-2 flex flex-col gap-0.5">
        {block.exercises.map((be, i) => {
          const exercise = exercisesById.get(be.exerciseId)
          return (
            <li
              key={be.exerciseId}
              className="flex items-center gap-2 select-none"
              {...(drag ? drag.bind(block.id, exercise?.name ?? be.exerciseId) : {})}
            >
              <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-xs font-bold">
                {letter}
                {i + 1}
              </span>
              <button
                type="button"
                disabled={!exercise}
                onClick={() => setTechniqueFor(be.exerciseId)}
                title="Ver técnica"
                className="inline-flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium"
              >
                <span className="truncate">{exercise?.name ?? be.exerciseId}</span>
                {be.perSide && (
                  <span className="text-muted-foreground shrink-0 text-xs">· cada lado</span>
                )}
                <Info className="text-muted-foreground size-3.5 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => setMenuFor(be.exerciseId)}
                aria-label={`Opciones de ${exercise?.name ?? be.exerciseId}`}
                className="hover:bg-accent rounded-full p-1.5"
              >
                <MoreVertical className="size-4" />
              </button>
            </li>
          )
        })}
      </ol>

      <div className="mt-3 flex flex-col gap-2">
        {rounds.map((round) => {
          const expanded = round.index === current || open.has(round.index)
          const title = `Ronda ${round.index + 1} de ${rounds.length}`
          if (!expanded) {
            return (
              <div
                key={round.index}
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-2 py-1.5',
                  round.complete && 'bg-emerald-500/10',
                )}
                data-testid="round-row"
              >
                <button
                  type="button"
                  onClick={() => toggleOpen(round.index)}
                  aria-expanded={false}
                  aria-label={`${title}${round.complete ? ' (hecha)' : ''}. Abrir`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  <span className="shrink-0 text-sm font-semibold">R{round.index + 1}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {round.sets
                      .map((s, i) =>
                        s
                          ? shortSetValues(
                              s,
                              exercisesById.get(block.exercises[i]!.exerciseId),
                              block.exercises[i]!.perSide,
                            )
                          : '—',
                      )
                      .join(' · ')}
                  </span>
                </button>
                {round.complete ? (
                  <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    <Check className="size-4" strokeWidth={3} /> Hecha
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-primary text-primary"
                    onClick={() => roundActions.onCompleteRound(block.id, round.index)}
                    aria-label={`Completar ronda ${round.index + 1}`}
                  >
                    <Check strokeWidth={3} /> Ronda
                  </Button>
                )}
              </div>
            )
          }
          return (
            <div
              key={round.index}
              className={cn(
                'rounded-xl border p-2',
                round.complete ? 'bg-emerald-500/5' : 'border-primary/50',
              )}
              data-testid="round-card"
              aria-label={title}
              role="group"
            >
              <div className="mb-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => round.index !== current && toggleOpen(round.index)}
                  aria-expanded
                  className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold"
                >
                  {round.index !== current && <ChevronDown className="size-4" />}
                  {title}
                </button>
                {round.complete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => roundActions.onUncompleteRound(block.id, round.index)}
                  >
                    Desmarcar
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="h-11"
                    onClick={() => roundActions.onCompleteRound(block.id, round.index)}
                    aria-label={`Completar ronda ${round.index + 1}`}
                  >
                    <Check strokeWidth={3} /> Ronda
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {round.sets.map((set, i) => {
                  const be = block.exercises[i]!
                  if (!set) return null
                  const exercise = exercisesById.get(be.exerciseId)
                  const code = `${letter}${i + 1}`
                  const differ =
                    edited === set.id && !set.completed
                      ? followingDiffer({ blocks: [block] }, set.id)
                      : 0
                  return (
                    <div key={set.id}>
                      <p className="text-muted-foreground truncate px-1 text-xs">
                        {code} · {exercise?.name ?? be.exerciseId}
                      </p>
                      <SetRow
                        set={set}
                        specs={fieldSpecs(exercise, be.perSide)}
                        label={code}
                        selected={selectedSetId === set.id}
                        onSelect={() => actions.onSelectSet(set.id)}
                        onChange={(patch) => {
                          setEdited(set.id)
                          roundActions.onChangeSet(set.id, patch)
                        }}
                        onToggleComplete={() => actions.onToggleComplete(set.id)}
                        onToggleWarmup={() => actions.onToggleWarmup(set.id)}
                        onRemove={() => actions.onRemoveSet(set.id)}
                        onCompleteHold={
                          exercise?.trackingType === 'time' && actions.onCompleteHold
                            ? (durationS) => actions.onCompleteHold?.(set.id, durationS)
                            : undefined
                        }
                        perSide={Boolean(be.perSide)}
                      />
                      {differ > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            roundActions.onApplyFollowing(set.id)
                            setEdited(null)
                          }}
                          className="text-primary mt-0.5 flex h-9 w-full items-center justify-center gap-1 rounded-lg text-sm font-medium underline"
                        >
                          <CopyPlus className="size-4" /> Aplicar a las rondas siguientes ({differ})
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Button
          variant="ghost"
          className="text-primary h-11"
          onClick={() => roundActions.onAddRound(block.id)}
          aria-label="Añadir una ronda"
        >
          <Plus /> 1 ronda
        </Button>
        <Button
          variant="ghost"
          className="h-11"
          disabled={rounds.length <= 1}
          onClick={() => roundActions.onRemoveRound(block.id)}
          aria-label="Quitar la última ronda"
        >
          <Minus /> Ronda
        </Button>
        <Button
          variant="ghost"
          className="h-11"
          onClick={() => roundActions.onDuplicate(block.id)}
          aria-label="Duplicar bloque"
        >
          <Copy /> Duplicar
        </Button>
      </div>

      <Sheet open={blockMenu} onClose={() => setBlockMenu(false)} title={`${label} ${letter}`}>
        <div className="flex flex-col gap-2 pb-2">
          <MenuButton
            icon={Pencil}
            onClick={() => {
              setBlockMenu(false)
              roundActions.onEdit(block.id)
            }}
          >
            Editar bloque (ejercicios, rondas y descansos)
          </MenuButton>
          <MenuButton
            icon={Copy}
            onClick={() => {
              setBlockMenu(false)
              roundActions.onDuplicate(block.id)
            }}
          >
            Duplicar bloque
          </MenuButton>
          <MenuButton
            icon={ArrowUp}
            disabled={isFirst}
            onClick={() => {
              setBlockMenu(false)
              actions.onMove(block.id, -1)
            }}
          >
            Subir bloque
          </MenuButton>
          <MenuButton
            icon={ArrowDown}
            disabled={isLast}
            onClick={() => {
              setBlockMenu(false)
              actions.onMove(block.id, 1)
            }}
          >
            Bajar bloque
          </MenuButton>
          <MenuButton
            icon={Trash2}
            destructive
            onClick={() => {
              setBlockMenu(false)
              if (confirm('¿Quitar el bloque y todas sus rondas?'))
                roundActions.onRemoveBlock(block.id)
            }}
          >
            Quitar bloque
          </MenuButton>
        </div>
      </Sheet>
      <ExerciseMenuSheet
        block={block}
        exerciseId={menuFor}
        exercise={menuFor ? exercisesById.get(menuFor) : undefined}
        isFirst={isFirst}
        isLast={isLast}
        canMergeNext={canMergeNext}
        actions={actions}
        onTechnique={setTechniqueFor}
        onClose={() => setMenuFor(null)}
      />
      <ExerciseTechniqueSheet
        exercise={techniqueFor ? exercisesById.get(techniqueFor) : null}
        onClose={() => setTechniqueFor(null)}
      />
    </section>
  )
}
