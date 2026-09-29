import {
  ArrowDown,
  ArrowUp,
  Info,
  Lightbulb,
  Link2,
  MoreVertical,
  Plus,
  Replace,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { setFields } from '@/lib/workout/fields'
import { formatClock, formatKg } from '@/lib/workout/format'
import type { SetPatch } from '@/lib/workout/session-ops'
import type { Exercise, LastPerformance, LocalBlock } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { primaryMusclesText } from './exercise-list-item'
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
}

function lastSummary(last: LastPerformance | undefined, exercise: Exercise | undefined) {
  if (!last) return null
  const sets = last.sets.filter((s) => !s.isWarmup)
  if (sets.length === 0) return null
  const parts = sets.slice(0, 5).map((s) => {
    if (exercise?.trackingType === 'weight_reps' && s.weightKg !== null)
      return `${formatKg(s.weightKg)}×${s.reps ?? '—'}`
    if (s.reps !== null) return `${s.reps}`
    if (s.distanceM !== null) return `${formatKg(s.distanceM)} m`
    if (s.durationS !== null) return formatClock(s.durationS)
    if (s.calories !== null) return `${s.calories} kcal`
    return '—'
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
}: {
  block: LocalBlock
  letter: string
  isFirst: boolean
  isLast: boolean
  exercisesById: Map<string, Exercise>
  lastByExercise: Map<string, LastPerformance> | undefined
  selectedSetId: string | null
  actions: BlockActions
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const isSuperset = block.exercises.length > 1
  const menuExercise = menuFor ? exercisesById.get(menuFor) : undefined

  return (
    <section
      className={cn('bg-card rounded-2xl border p-3 shadow-xs', isSuperset && 'border-primary/40')}
      aria-label={`Bloque ${letter}`}
    >
      {isSuperset && (
        <p className="text-primary mb-2 flex items-center gap-1 text-xs font-semibold uppercase">
          <Link2 className="size-3.5" /> Superserie {letter}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {block.exercises.map((be, i) => {
          const exercise = exercisesById.get(be.exerciseId)
          const fields = setFields(exercise?.trackingType ?? 'weight_reps', exercise?.category)
          const sets = block.sets.filter((s) => s.exerciseId === be.exerciseId)
          const last = lastSummary(lastByExercise?.get(be.exerciseId), exercise)
          const code = isSuperset ? `${letter}${i + 1}` : letter
          return (
            <div key={be.exerciseId}>
              <div className="mb-1 flex items-start gap-2">
                <span className="bg-primary/10 text-primary mt-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold">
                  {code}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg leading-tight font-semibold">
                    {exercise?.name ?? be.exerciseId}
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
                    fields={fields}
                    label={`${set.setIndex + 1}`}
                    selected={selectedSetId === set.id}
                    onSelect={() => actions.onSelectSet(set.id)}
                    onChange={(patch) => actions.onChangeSet(set.id, patch)}
                    onToggleComplete={() => actions.onToggleComplete(set.id)}
                    onToggleWarmup={() => actions.onToggleWarmup(set.id)}
                    onRemove={() => actions.onRemoveSet(set.id)}
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
              {menuExercise.techniqueNotes && (
                <p className="text-muted-foreground mt-1">{menuExercise.techniqueNotes}</p>
              )}
            </div>
          )}
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
            Añadir ejercicio en superserie
          </MenuButton>
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
