import { useMemo, useState } from 'react'
import { Sheet } from '@/components/ui/sheet'
import { searchExercises } from '@/lib/workout/search'
import { suggestAlternatives } from '@/lib/workout/substitution'
import type { Exercise } from '@/lib/workout/types'
import { EMPTY_FILTER, ExerciseFilters, type FilterState } from './exercise-filters'
import { ExerciseListItem } from './exercise-list-item'

export type PickerMode =
  | { kind: 'add' }
  | { kind: 'superset'; blockId: string }
  | { kind: 'substitute'; blockId: string; exercise: Exercise }

const MAX_RESULTS = 80

export function ExercisePicker({
  mode,
  exercises,
  equipment,
  excludeIds,
  loading,
  error,
  onPick,
  onClose,
}: {
  mode: PickerMode | null
  exercises: Exercise[]
  equipment: string[]
  excludeIds: string[]
  loading: boolean
  error: string | null
  onPick: (exercise: Exercise) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])

  const suggestions = useMemo(
    () =>
      mode?.kind === 'substitute'
        ? suggestAlternatives(mode.exercise, exercises, equipment).filter((e) => !exclude.has(e.id))
        : [],
    [mode, exercises, equipment, exclude],
  )
  const results = useMemo(
    () =>
      searchExercises(exercises, filter)
        .filter((e) => !exclude.has(e.id))
        .slice(0, MAX_RESULTS),
    [exercises, filter, exclude],
  )

  const title =
    mode?.kind === 'superset'
      ? 'Añadir a la superserie'
      : mode?.kind === 'substitute'
        ? `Sustituir ${mode.exercise.name}`
        : 'Añadir ejercicio'

  function close() {
    setFilter(EMPTY_FILTER)
    onClose()
  }

  return (
    <Sheet open={mode !== null} onClose={close} title={title} className="h-[92dvh]">
      <div className="flex flex-col gap-3">
        {mode?.kind === 'substitute' && (
          <section>
            <h3 className="text-muted-foreground mb-1 text-sm font-medium">
              Trabajan los mismos músculos
            </h3>
            {suggestions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No hay alternativas con esos músculos. Busca abajo cualquier otro ejercicio.
              </p>
            ) : (
              <ul className="divide-y">
                {suggestions.map((e) => (
                  <ExerciseListItem
                    key={e.id}
                    exercise={e}
                    onClick={() => {
                      setFilter(EMPTY_FILTER)
                      onPick(e)
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
        <ExerciseFilters
          value={filter}
          onChange={setFilter}
          autoFocus={mode?.kind !== 'substitute'}
        />
        {loading && (
          <p className="text-muted-foreground py-4 text-center text-sm">Cargando ejercicios…</p>
        )}
        {error && <p className="text-destructive py-2 text-sm">{error}</p>}
        {!loading && results.length === 0 && !error && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Nada con esos filtros. Puedes crear tu propio ejercicio en Entrenar → Ejercicios.
          </p>
        )}
        <ul className="divide-y">
          {results.map((e) => (
            <ExerciseListItem
              key={e.id}
              exercise={e}
              onClick={() => {
                setFilter(EMPTY_FILTER)
                onPick(e)
              }}
            />
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
