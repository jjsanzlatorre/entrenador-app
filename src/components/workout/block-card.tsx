import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Info,
  Lightbulb,
  Link2,
  MoreVertical,
  Plus,
  Replace,
  Trash2,
  Unlink,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { fieldSpecs, formatSetValues } from '@/lib/workout/fields'
import { formatClock, formatKg } from '@/lib/workout/format'
import type { SetPatch } from '@/lib/workout/session-ops'
import type { Exercise, LastPerformance, LocalBlock } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { primaryMusclesText } from './exercise-list-item'
import { ExerciseTechniqueSheet } from './exercise-technique'
import { SetRow } from './set-row'

export type BlockActions = {
  onSelectSet: (setId: string) => void
  onChangeSet: (setId: string, patch: SetPatch) => void
  onToggleComplete: (setId: string) => void
  onToggleWarmup: (setId: string) => void
  onRemoveSet: (setId: string) => void
  onAddSet: (blockId: string, exerciseId: string) => void
  onMove: (blockId: string, direction: -1 | 1) => void
  onAddSuperset: (blockId: string) => void
  onSubstitute: (blockId: string, exercise: Exercise) => void
  onRemoveExercise: (blockId: string, exerciseId: string) => void
  onRevertSuggestion: (blockId: string, exerciseId: string) => void
  // Serie isométrica cronometrada: guarda el tiempo y la completa (arranca el descanso).
  // Sin él (entreno pasado) no hay cronómetro de serie isométrica.
  onCompleteHold?: (setId: string, durationS: number) => void
  // Superseries (usabilidad 3/3): «Unir con el siguiente» y «Separar de la superserie».
  onMergeNext: (blockId: string) => void
  onSplit: (blockId: string, exerciseId: string) => void
}

// Arrastre (mantener pulsado el nombre y soltar sobre otro bloque) para unir en superserie.
export type BlockDrag = {
  bind: (id: string, label: string) => Record<string, unknown>
  // Bloque bajo el dedo mientras se arrastra (resaltado como destino).
  over: string | null
  dragging: string | null
}

function lastSummary(last: LastPerformance | undefined, exercise: Exercise | undefined) {
  if (!last) return null
  const sets = last.sets.filter((s) => !s.isWarmup)
  if (sets.length === 0) return null
  const parts = sets.slice(0, 5).map((s) => {
    if (exercise?.trackingType === 'weight_reps' && s.weightKg !== null)
      return `${formatKg(s.weightKg)}×${s.reps ?? '—'}`
    if (s.reps !== null) return `${s.reps}`
    return formatSetValues(s, exercise)
  })
  const date = new Date(last.endedAt).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  })
  return `${date}: ${parts.join(' · ')}${sets.length > 5 ? '…' : ''}`
}

export function BlockCard({
  block,
  letter,
  isFirst,
  isLast,
  exercisesById,
  lastByExercise,
  selectedSetId,
  actions,
  canMergeNext = false,
  groupable = false,
  drag,
}: {
  block: LocalBlock
  letter: string
  isFirst: boolean
  isLast: boolean
  exercisesById: Map<string, Exercise>
  lastByExercise: Map<string, LastPerformance> | undefined
  selectedSetId: string | null
  actions: BlockActions
  canMergeNext?: boolean
  groupable?: boolean
  drag?: BlockDrag
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const isSuperset = block.exercises.length > 1
  const menuExercise = menuFor ? exercisesById.get(menuFor) : undefined
  const [techniqueFor, setTechniqueFor] = useState<string | null>(null)

  return (
    <section
      className={cn(
        'bg-card rounded-2xl border p-3 shadow-xs transition-shadow',
        isSuperset && 'border-primary/40',
        drag?.dragging &&
          drag.dragging !== block.id &&
          drag.over === block.id &&
          'ring-primary ring-4',
        drag?.dragging === block.id && 'opacity-60',
      )}
      aria-label={`Bloque ${letter}`}
      {...(groupable ? { 'data-drop-block': block.id } : {})}
    >
      {isSuperset && (
        <p className="text-primary mb-2 flex items-center gap-1 text-xs font-semibold uppercase">
          <Link2 className="size-3.5" /> Superserie {letter}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {block.exercises.map((be, i) => {
          const exercise = exercisesById.get(be.exerciseId)
          const specs = fieldSpecs(exercise)
          const sets = block.sets.filter((s) => s.exerciseId === be.exerciseId)
          const last = lastSummary(lastByExercise?.get(be.exerciseId), exercise)
          const code = isSuperset ? `${letter}${i + 1}` : letter
          return (
            <div key={be.exerciseId}>
              <div
                className="mb-1 flex items-start gap-2 select-none"
                {...(groupable && drag ? drag.bind(block.id, exercise?.name ?? be.exerciseId) : {})}
              >
                <span className="bg-primary/10 text-primary mt-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold">
                  {code}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg leading-tight font-semibold">
                    <button
                      type="button"
                      disabled={!exercise}
                      onClick={() => setTechniqueFor(be.exerciseId)}
                      title="Ver técnica"
                      className="inline-flex items-start gap-1.5 text-left"
                    >
                      {exercise?.name ?? be.exerciseId}
                      <Info className="text-muted-foreground mt-1 size-4 shrink-0" />
                    </button>
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    {last ? `Última vez ${last}` : 'Primera vez con este ejercicio'}
                    {' · '}descanso {formatClock(be.restS)}
                  </p>
                  {be.suggestion && sets.some((s) => !s.completed) && (
                    <p
                      className="mt-1 flex flex-wrap items-center gap-x-2 text-xs"
                      aria-label="Sugerencia de peso"
                    >
                      <span className="text-primary inline-flex items-center gap-1 font-medium">
                        <Lightbulb className="size-3.5" />
                        {be.suggestion.reverted
                          ? `Con el peso de la última vez (${formatKg(be.suggestion.previousKg)} kg)`
                          : be.suggestion.reason}
                      </span>
                      {!be.suggestion.reverted &&
                        be.suggestion.weightKg !== be.suggestion.previousKg && (
                          <button
                            type="button"
                            className="text-muted-foreground underline"
                            onClick={() => actions.onRevertSuggestion(block.id, be.exerciseId)}
                          >
                            Usar {formatKg(be.suggestion.previousKg)} kg
                          </button>
                        )}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMenuFor(be.exerciseId)}
                  aria-label={`Opciones de ${exercise?.name ?? be.exerciseId}`}
                  className="hover:bg-accent -mr-1 rounded-full p-2"
                >
                  <MoreVertical className="size-5" />
                </button>
              </div>

              <div className="flex flex-col gap-1">
                {sets.map((set) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    specs={specs}
                    label={`${set.setIndex + 1}`}
                    selected={selectedSetId === set.id}
                    onSelect={() => actions.onSelectSet(set.id)}
                    onChange={(patch) => actions.onChangeSet(set.id, patch)}
                    onToggleComplete={() => actions.onToggleComplete(set.id)}
                    onToggleWarmup={() => actions.onToggleWarmup(set.id)}
                    onRemove={() => actions.onRemoveSet(set.id)}
                    onCompleteHold={
                      exercise?.trackingType === 'time' && actions.onCompleteHold
                        ? (durationS) => actions.onCompleteHold?.(set.id, durationS)
                        : undefined
                    }
                  />
                ))}
              </div>
              <Button
                variant="ghost"
                className="text-primary mt-1 h-11 w-full"
                onClick={() => actions.onAddSet(block.id, be.exerciseId)}
              >
                <Plus /> Añadir serie
              </Button>
            </div>
          )
        })}
      </div>

      <Sheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuExercise?.name ?? 'Ejercicio'}
      >
        <div className="flex flex-col gap-2 pb-2">
          {menuExercise && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="flex items-center gap-1 font-medium">
                <Info className="size-4" /> {primaryMusclesText(menuExercise)}
              </p>
            </div>
          )}
          <MenuButton
            icon={BookOpen}
            disabled={!menuExercise}
            onClick={() => {
              setTechniqueFor(menuFor)
              setMenuFor(null)
            }}
          >
            Ver técnica
          </MenuButton>
          <MenuButton
            icon={ArrowUp}
            disabled={isFirst}
            onClick={() => {
              actions.onMove(block.id, -1)
              setMenuFor(null)
            }}
          >
            Subir bloque
          </MenuButton>
          <MenuButton
            icon={ArrowDown}
            disabled={isLast}
            onClick={() => {
              actions.onMove(block.id, 1)
              setMenuFor(null)
            }}
          >
            Bajar bloque
          </MenuButton>
          <MenuButton
            icon={Link2}
            onClick={() => {
              actions.onAddSuperset(block.id)
              setMenuFor(null)
            }}
          >
            Añadir otro ejercicio en superserie
          </MenuButton>
          {canMergeNext && (
            <MenuButton
              icon={Link2}
              onClick={() => {
                actions.onMergeNext(block.id)
                setMenuFor(null)
              }}
            >
              Unir con el siguiente (superserie)
            </MenuButton>
          )}
          {isSuperset && block.blockType === 'superset' && menuFor && (
            <MenuButton
              icon={Unlink}
              onClick={() => {
                actions.onSplit(block.id, menuFor)
                setMenuFor(null)
              }}
            >
              Separar de la superserie
            </MenuButton>
          )}
          <MenuButton
            icon={Replace}
            disabled={!menuExercise}
            onClick={() => {
              if (menuExercise) actions.onSubstitute(block.id, menuExercise)
              setMenuFor(null)
            }}
          >
            Sustituir ejercicio
          </MenuButton>
          <MenuButton
            icon={Trash2}
            destructive
            onClick={() => {
              if (menuFor && confirm('¿Quitar este ejercicio y sus series?')) {
                actions.onRemoveExercise(block.id, menuFor)
              }
              setMenuFor(null)
            }}
          >
            Quitar ejercicio
          </MenuButton>
        </div>
      </Sheet>
      <ExerciseTechniqueSheet
        exercise={techniqueFor ? exercisesById.get(techniqueFor) : null}
        onClose={() => setTechniqueFor(null)}
      />
    </section>
  )
}

function MenuButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  destructive,
}: {
  icon: typeof ArrowUp
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className={cn('justify-start', destructive && 'text-destructive')}
    >
      <Icon /> {children}
    </Button>
  )
}
