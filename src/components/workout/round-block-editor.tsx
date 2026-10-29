// Editor de un bloque por rondas (superserie o circuito): ejercicios con su objetivo (reps,
// tiempo, peso, distancia o calorías y «cada lado»), rondas y descansos. Se usa al crear el
// bloque, al editarlo y en la vista previa de «Escribir entreno».
import { useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QuantityInput } from '@/components/ui/quantity-input'
import { fieldSpecs } from '@/lib/workout/fields'
import type { QuantityKind } from '@/lib/input/quantity'
import {
  assignExercise,
  canBePerSide,
  draftItemFor,
  type DraftItem,
  type RoundDraft,
} from '@/lib/workout/round-draft'
import { ROUND_CHIPS } from '@/lib/workout/rounds'
import type { Exercise, LastPerformance } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { ExercisePicker } from './exercise-picker'

const SECONDS: QuantityKind = { kind: 'duration', bare: 's' }

type Picking = { kind: 'add' } | { kind: 'replace'; key: string; query: string }

export function RoundBlockEditor({
  idPrefix,
  draft,
  onChange,
  exercises,
  equipment,
  userId,
  loadLast,
  compact = false,
}: {
  idPrefix: string
  draft: RoundDraft
  onChange: (draft: RoundDraft) => void
  exercises: Exercise[]
  equipment: string[]
  userId?: string
  // Valores de la última vez para precargar un ejercicio nuevo.
  loadLast?: (exercise: Exercise) => Promise<LastPerformance | null>
  // En la vista previa de «Escribir entreno» (varios bloques): sin los descansos desplegados.
  compact?: boolean
}) {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const [picking, setPicking] = useState<Picking | null>(null)
  const multi = draft.items.length > 1
  const set = (patch: Partial<RoundDraft>) => onChange({ ...draft, ...patch })
  const setItem = (key: string, fn: (item: DraftItem) => DraftItem) =>
    set({ items: draft.items.map((i) => (i.key === key ? fn(i) : i)) })
  const move = (index: number, direction: -1 | 1) => {
    const items = [...draft.items]
    const [item] = items.splice(index, 1)
    if (!item) return
    items.splice(index + direction, 0, item)
    set({ items })
  }

  async function pick(exercise: Exercise) {
    const mode = picking
    setPicking(null)
    if (!mode) return
    if (mode.kind === 'replace') {
      setItem(mode.key, (i) => assignExercise(i, exercise))
      return
    }
    const last = loadLast ? await loadLast(exercise).catch(() => null) : null
    onChange({ ...draft, items: [...draft.items, draftItemFor(exercise, last)] })
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label="Ejercicios del bloque">
        {draft.items.map((item, index) => {
          const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
          const specs = exercise ? fieldSpecs(exercise, item.perSide) : []
          const code = multi ? `${index + 1}` : ''
          return (
            <li
              key={item.key}
              className={cn('rounded-xl border p-2', !exercise && 'border-amber-500/60')}
              data-testid="round-item"
            >
              <div className="flex items-center gap-1">
                {code && (
                  <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-xs font-bold">
                    {code}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setPicking({ kind: 'replace', key: item.key, query: exercise ? '' : item.name })
                  }
                  className="min-w-0 flex-1 truncate text-left font-semibold"
                  aria-label={exercise ? `Cambiar ${exercise.name}` : `Elegir «${item.name}»`}
                >
                  {exercise ? exercise.name : `«${item.name || 'Ejercicio'}»`}
                </button>
                <button
                  type="button"
                  aria-label={`Subir ${item.name}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="p-2 disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${item.name}`}
                  disabled={index === draft.items.length - 1}
                  onClick={() => move(index, 1)}
                  className="p-2 disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Quitar ${item.name}`}
                  onClick={() => set({ items: draft.items.filter((i) => i.key !== item.key) })}
                  className="text-destructive p-2"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {!exercise && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-4" /> No lo encuentro en la biblioteca
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPicking({ kind: 'replace', key: item.key, query: item.name })}
                  >
                    <Search /> Elegir o crear
                  </Button>
                </div>
              )}
              {exercise && (item.match === 'search' || item.match === 'ai') && (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {item.match === 'ai' ? 'Interpretado por la IA' : 'Parecido a lo escrito'}: toca
                  el nombre si no es este.
                </p>
              )}
              {exercise && (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {specs.map((spec) => (
                    <QuantityInput
                      key={spec.field}
                      id={`${idPrefix}-${item.key}-${spec.field}`}
                      label={`${spec.label}${spec.suffix ? ' por lado' : ''}`}
                      value={item.values[spec.field] ?? ''}
                      onChange={(v) =>
                        setItem(item.key, (i) => ({
                          ...i,
                          values: { ...i.values, [spec.field]: v },
                        }))
                      }
                      quantity={spec.quantity}
                      hidePreview
                      inputClassName="h-11 text-base"
                    />
                  ))}
                  {canBePerSide(exercise) && (
                    <label className="col-span-2 flex h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={item.perSide}
                        onChange={(e) =>
                          setItem(item.key, (i) => ({ ...i, perSide: e.target.checked }))
                        }
                      />
                      Cada lado
                      <span className="text-muted-foreground text-xs">
                        {exercise.trackingType === 'time'
                          ? '(el cronómetro hace los dos lados)'
                          : '(reps por lado)'}
                      </span>
                    </label>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Button variant="outline" onClick={() => setPicking({ kind: 'add' })}>
        <Plus /> Añadir ejercicio
      </Button>

      <QuantityInput
        id={`${idPrefix}-rounds`}
        label={multi ? 'Rondas' : 'Series'}
        value={draft.rounds}
        onChange={(rounds) => set({ rounds })}
        quantity={{ kind: 'count' }}
        chips={ROUND_CHIPS}
        hidePreview
      />
      <div className={cn('grid gap-3', multi ? 'grid-cols-2' : 'grid-cols-1')}>
        {multi && !compact && (
          <QuantityInput
            id={`${idPrefix}-rest-ex`}
            label="Descanso entre ejercicios"
            value={draft.restBetweenExercisesS}
            onChange={(restBetweenExercisesS) => set({ restBetweenExercisesS })}
            quantity={SECONDS}
          />
        )}
        <QuantityInput
          id={`${idPrefix}-rest-round`}
          label={multi ? 'Descanso entre rondas' : 'Descanso entre series'}
          value={draft.restBetweenRoundsS}
          onChange={(restBetweenRoundsS) => set({ restBetweenRoundsS })}
          quantity={SECONDS}
          chips={compact ? undefined : [60, 90, 120]}
        />
      </div>

      {picking && (
        <ExercisePicker
          key={picking.kind === 'replace' ? picking.key : 'add'}
          userId={userId}
          mode={{ kind: 'add' }}
          initialQuery={picking?.kind === 'replace' ? picking.query : undefined}
          exercises={exercises}
          equipment={equipment}
          excludeIds={draft.items.flatMap((i) => (i.exerciseId ? [i.exerciseId] : []))}
          loading={false}
          error={null}
          onPick={(e) => void pick(e)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
