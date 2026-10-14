import { useMemo, useState } from 'react'
import { BackLink } from '@/components/layout/back-link'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { CreateExerciseSheet, NoResults } from '@/components/workout/create-exercise-sheet'
import {
  EMPTY_FILTER,
  ExerciseFilters,
  type FilterState,
} from '@/components/workout/exercise-filters'
import { ExerciseListItem } from '@/components/workout/exercise-list-item'
import { ExerciseTechnique } from '@/components/workout/exercise-technique'
import { deleteExercise } from '@/lib/workout/api'
import { formatClock } from '@/lib/workout/format'
import { catalogQueryKey, useCatalog } from '@/lib/workout/hooks'
import { CATEGORY_LABELS, TRACKING_LABELS, equipmentLabel, muscleName } from '@/lib/workout/labels'
import { searchExercises } from '@/lib/workout/search'
import type { Exercise } from '@/lib/workout/types'
import { notifyError, notifySaved } from '@/lib/notify'

export const Route = createFileRoute('/_app/entrenar/ejercicios')({
  ssr: false,
  component: ExercisesPage,
})

function ExercisesPage() {
  const { auth } = Route.useRouteContext()
  const catalog = useCatalog(auth.userId)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [detail, setDetail] = useState<Exercise | null>(null)
  // null: cerrado; texto: nombre con el que se abre (lo buscado si no hay resultados).
  const [creating, setCreating] = useState<string | null>(null)

  const results = useMemo(() => searchExercises(catalog.data ?? [], filter), [catalog.data, filter])

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackLink to="/entrenar" label="Entrenar" />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Ejercicios</h1>
        <Button onClick={() => setCreating('')}>
          <Plus /> Crear
        </Button>
      </div>
      <ExerciseFilters value={filter} onChange={setFilter} />
      {catalog.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
      {catalog.isError && <p className="text-destructive text-sm">{catalog.error.message}</p>}
      <p className="text-muted-foreground text-xs">{results.length} ejercicios</p>
      {catalog.data && results.length === 0 && (
        <NoResults query={filter.query} onCreate={(name) => setCreating(name)} />
      )}
      <ul className="divide-y">
        {results.map((e) => (
          <ExerciseListItem key={e.id} exercise={e} onClick={() => setDetail(e)} />
        ))}
      </ul>

      <ExerciseDetail exercise={detail} userId={auth.userId} onClose={() => setDetail(null)} />
      <CreateExerciseSheet
        open={creating !== null}
        initialName={creating ?? ''}
        userId={auth.userId}
        onClose={() => setCreating(null)}
        onCreated={(e) => setDetail(e)}
      />
    </div>
  )
}

function ExerciseDetail({
  exercise,
  userId,
  onClose,
}: {
  exercise: Exercise | null
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => deleteExercise(id),
    onSuccess: async () => {
      notifySaved('Ejercicio borrado')
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey(userId) })
      onClose()
    },
    onError: (error) => notifyError(error, 'borrar el ejercicio'),
  })

  return (
    <Sheet open={exercise !== null} onClose={onClose} title={exercise?.name ?? ''}>
      {exercise && (
        <div className="flex flex-col gap-3 pb-2 text-sm">
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{CATEGORY_LABELS[exercise.category]}</Badge>
            <Badge variant="outline">{TRACKING_LABELS[exercise.trackingType]}</Badge>
            {exercise.isUnilateral && <Badge variant="outline">Unilateral</Badge>}
            {exercise.ownerId && <Badge>Propio</Badge>}
          </div>
          <MuscleList exercise={exercise} role="primary" title="Principales" />
          <MuscleList exercise={exercise} role="secondary" title="Secundarios" />
          {exercise.equipment.length > 0 && (
            <p>
              <span className="font-medium">Material:</span>{' '}
              {exercise.equipment.map(equipmentLabel).join(', ')}
            </p>
          )}
          <p>
            <span className="font-medium">Descanso por defecto:</span>{' '}
            {formatClock(exercise.defaultRestS)}
          </p>
          {exercise.aliases.length > 0 && (
            <p className="text-muted-foreground">También: {exercise.aliases.join(', ')}</p>
          )}
          <div className="border-t pt-3">
            <ExerciseTechnique exercise={exercise} />
          </div>
          {exercise.ownerId === userId && (
            <>
              <Button
                variant="outline"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm('¿Borrar este ejercicio?')) remove.mutate(exercise.id)
                }}
              >
                <Trash2 /> Borrar ejercicio
              </Button>
              {remove.isError && <p className="text-destructive">{remove.error.message}</p>}
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

function MuscleList({
  exercise,
  role,
  title,
}: {
  exercise: Exercise
  role: 'primary' | 'secondary'
  title: string
}) {
  const muscles = exercise.muscles.filter((m) => m.role === role)
  if (muscles.length === 0) return null
  return (
    <p>
      <span className="font-medium">{title}:</span>{' '}
      {muscles.map((m) => muscleName(m.muscleId)).join(', ')}
    </p>
  )
}
