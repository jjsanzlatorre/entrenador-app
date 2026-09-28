import { useMemo, useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  EMPTY_FILTER,
  ExerciseFilters,
  type FilterState,
} from '@/components/workout/exercise-filters'
import { ExerciseListItem } from '@/components/workout/exercise-list-item'
import { createExercise, deleteExercise, type NewExerciseInput } from '@/lib/workout/api'
import { formatClock } from '@/lib/workout/format'
import { catalogQueryKey, useCatalog } from '@/lib/workout/hooks'
import {
  CATEGORY_LABELS,
  EQUIPMENT_LABELS,
  MUSCLES,
  TRACKING_LABELS,
  equipmentLabel,
  muscleName,
} from '@/lib/workout/labels'
import { searchExercises } from '@/lib/workout/search'
import type { Exercise } from '@/lib/workout/types'
import type { ExerciseCategory, TrackingType } from '@/types/database'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/entrenar/ejercicios')({
  ssr: false,
  component: ExercisesPage,
})

function ExercisesPage() {
  const { auth } = Route.useRouteContext()
  const catalog = useCatalog(auth.userId)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [detail, setDetail] = useState<Exercise | null>(null)
  const [creating, setCreating] = useState(false)

  const results = useMemo(() => searchExercises(catalog.data ?? [], filter), [catalog.data, filter])

  return (
    <div className="flex flex-col gap-3 p-4">
      <Link
        to="/entrenar"
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> Entrenar
      </Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Ejercicios</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Crear
        </Button>
      </div>
      <ExerciseFilters value={filter} onChange={setFilter} />
      {catalog.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
      {catalog.isError && <p className="text-destructive text-sm">{catalog.error.message}</p>}
      <p className="text-muted-foreground text-xs">{results.length} ejercicios</p>
      <ul className="divide-y">
        {results.map((e) => (
          <ExerciseListItem key={e.id} exercise={e} onClick={() => setDetail(e)} />
        ))}
      </ul>

      <ExerciseDetail exercise={detail} userId={auth.userId} onClose={() => setDetail(null)} />
      <CreateExerciseSheet
        open={creating}
        userId={auth.userId}
        onClose={() => setCreating(false)}
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
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey(userId) })
      onClose()
    },
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
          {exercise.techniqueNotes && (
            <p className="bg-muted/50 rounded-lg p-3">{exercise.techniqueNotes}</p>
          )}
          {exercise.aliases.length > 0 && (
            <p className="text-muted-foreground">También: {exercise.aliases.join(', ')}</p>
          )}
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

const CATEGORIES: ExerciseCategory[] = ['strength', 'functional', 'cardio', 'mobility', 'sport']
const TRACKING_TYPES: TrackingType[] = [
  'weight_reps',
  'reps',
  'time',
  'distance_time',
  'calories',
  'duration_only',
]

const EMPTY_FORM: NewExerciseInput = {
  name: '',
  category: 'strength',
  trackingType: 'weight_reps',
  equipment: [],
  primary: [],
  secondary: [],
  defaultRestS: 90,
  isUnilateral: false,
  techniqueNotes: null,
}

function CreateExerciseSheet({
  open,
  userId,
  onClose,
}: {
  open: boolean
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<NewExerciseInput>(EMPTY_FORM)
  const create = useMutation({
    mutationFn: () => createExercise(userId, form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey(userId) })
      setForm(EMPTY_FORM)
      onClose()
    },
  })

  function toggle(list: 'primary' | 'secondary' | 'equipment', value: string) {
    setForm((f) => {
      const current = f[list]
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      // Un músculo no puede ser principal y secundario a la vez.
      if (list === 'primary')
        return { ...f, primary: next, secondary: f.secondary.filter((m) => m !== value) }
      if (list === 'secondary')
        return { ...f, secondary: next, primary: f.primary.filter((m) => m !== value) }
      return { ...f, equipment: next }
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  const valid = form.name.trim().length > 0 && form.primary.length > 0

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Crear ejercicio"
      footer={
        <Button
          size="lg"
          className="w-full"
          form="create-exercise"
          type="submit"
          disabled={!valid || create.isPending}
        >
          {create.isPending ? 'Guardando…' : 'Guardar ejercicio'}
        </Button>
      }
    >
      <form id="create-exercise" onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ex-name">Nombre</Label>
          <Input
            id="ex-name"
            required
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ex-category">Categoría</Label>
            <select
              id="ex-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as ExerciseCategory })}
              className="border-input bg-background h-11 rounded-md border px-2"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ex-tracking">Se registra por</Label>
            <select
              id="ex-tracking"
              value={form.trackingType}
              onChange={(e) => setForm({ ...form, trackingType: e.target.value as TrackingType })}
              className="border-input bg-background h-11 rounded-md border px-2"
            >
              {TRACKING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRACKING_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ChipGroup
          title="Músculos principales (al menos uno)"
          options={MUSCLES.map((m) => [m.id, m.name])}
          selected={form.primary}
          onToggle={(v) => toggle('primary', v)}
        />
        <ChipGroup
          title="Músculos secundarios"
          options={MUSCLES.map((m) => [m.id, m.name])}
          selected={form.secondary}
          onToggle={(v) => toggle('secondary', v)}
        />
        <ChipGroup
          title="Material"
          options={Object.entries(EQUIPMENT_LABELS)}
          selected={form.equipment}
          onToggle={(v) => toggle('equipment', v)}
        />

        <div className="grid grid-cols-2 items-end gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ex-rest">Descanso (s)</Label>
            <Input
              id="ex-rest"
              inputMode="numeric"
              value={form.defaultRestS}
              onChange={(e) =>
                setForm({ ...form, defaultRestS: Math.min(600, Number(e.target.value) || 0) })
              }
            />
          </div>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={form.isUnilateral}
              onChange={(e) => setForm({ ...form, isUnilateral: e.target.checked })}
            />
            Unilateral
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ex-notes">Notas de técnica</Label>
          <Textarea
            id="ex-notes"
            value={form.techniqueNotes ?? ''}
            onChange={(e) => setForm({ ...form, techniqueNotes: e.target.value })}
          />
        </div>
        {create.isError && <p className="text-destructive text-sm">{create.error.message}</p>}
      </form>
    </Sheet>
  )
}

function ChipGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string
  options: [string, string][]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            aria-pressed={selected.includes(value)}
            className={cn(
              'h-9 rounded-full border px-3 text-sm',
              selected.includes(value)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
