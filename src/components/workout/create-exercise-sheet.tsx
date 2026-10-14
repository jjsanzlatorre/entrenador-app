import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { formatDurationInput, parseDuration } from '@/lib/input/quantity'
import { notifyError, notifySaved } from '@/lib/notify'
import { createExercise, type NewExerciseInput } from '@/lib/workout/api'
import { catalogQueryKey } from '@/lib/workout/hooks'
import { CATEGORY_LABELS, EQUIPMENT_LABELS, MUSCLES, TRACKING_LABELS } from '@/lib/workout/labels'
import type { Exercise } from '@/lib/workout/types'
import type { ExerciseCategory, TrackingType } from '@/types/database'
import { cn } from '@/lib/utils'

const CATEGORIES: ExerciseCategory[] = ['strength', 'functional', 'cardio', 'mobility', 'sport']
const TRACKING_TYPES: TrackingType[] = [
  'weight_reps',
  'reps',
  'time',
  'distance_time',
  'calories',
  'duration_only',
]

// Pistas del nombre para rellenar el tipo de registro (se puede cambiar).
export function guessTracking(name: string): TrackingType {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/plancha|plank|hold|isometric|colgad|hang|l-?sit|wall sit|sentadilla en pared/.test(n))
    return 'time'
  if (/carrera|correr|run|nado|nadar|swim|bici|bike|remo ergo|row erg|cinta|eliptica/.test(n))
    return 'distance_time'
  if (/estiramiento|stretch|yoga|movilidad/.test(n)) return 'duration_only'
  return 'weight_reps'
}

function emptyForm(name: string): NewExerciseInput {
  return {
    name,
    category: 'strength',
    trackingType: guessTracking(name),
    equipment: [],
    primary: [],
    secondary: [],
    defaultRestS: 90,
    isUnilateral: false,
    techniqueNotes: null,
  }
}

// Crear un ejercicio propio. `initialName`: lo buscado cuando no hay resultados.
export function CreateExerciseSheet({
  open,
  userId,
  initialName = '',
  onClose,
  onCreated,
}: {
  open: boolean
  userId: string
  initialName?: string
  onClose: () => void
  onCreated?: (exercise: Exercise) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Crear ejercicio" footer={<SubmitButton />}>
      {open && (
        <CreateExerciseForm
          key={initialName}
          userId={userId}
          initialName={initialName}
          onDone={(exercise) => {
            onCreated?.(exercise)
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}

function SubmitButton() {
  return (
    <Button size="lg" className="w-full" form="create-exercise" type="submit">
      Guardar ejercicio
    </Button>
  )
}

function CreateExerciseForm({
  userId,
  initialName,
  onDone,
}: {
  userId: string
  initialName: string
  onDone: (exercise: Exercise) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<NewExerciseInput>(() => emptyForm(initialName.trim()))
  const [rest, setRest] = useState(formatDurationInput(90, 's'))
  const [error, setError] = useState<string | null>(null)
  const restS = parseDuration(rest, 's')

  const create = useMutation({
    mutationFn: (input: NewExerciseInput) => createExercise(userId, input),
    onError: (e) => notifyError(e, 'crear el ejercicio'),
    onSuccess: async (id, input) => {
      notifySaved('Ejercicio creado')
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey(userId) })
      onDone({
        id,
        name: input.name.trim(),
        aliases: [],
        category: input.category,
        trackingType: input.trackingType,
        equipment: input.equipment,
        isUnilateral: input.isUnilateral,
        isCompound: input.primary.length + input.secondary.length > 1,
        defaultRestS: input.defaultRestS,
        techniqueNotes: input.techniqueNotes?.trim() || null,
        techniqueSteps: [],
        techniqueMistakes: [],
        ownerId: userId,
        muscles: [
          ...input.primary.map((muscleId) => ({ muscleId, role: 'primary' as const })),
          ...input.secondary.map((muscleId) => ({ muscleId, role: 'secondary' as const })),
        ],
      })
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
    if (create.isPending) return
    if (form.name.trim().length === 0) return setError('Ponle un nombre')
    if (form.primary.length === 0) return setError('Elige al menos un músculo principal')
    if (restS === null || restS > 600) return setError('Descanso: entre 0 y 10 min')
    setError(null)
    create.mutate({ ...form, defaultRestS: restS })
  }

  return (
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

      <div className="grid grid-cols-2 items-start gap-2">
        <QuantityInput
          id="ex-rest"
          label="Descanso"
          value={rest}
          onChange={setRest}
          quantity={{ kind: 'duration', bare: 's' }}
        />
        <label className="mt-6 flex h-11 items-center gap-2 text-sm">
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
      {(error ?? create.error) && (
        <p className="text-destructive text-sm" role="alert">
          {error ?? create.error?.message}
        </p>
      )}
      {create.isPending && <p className="text-muted-foreground text-sm">Guardando…</p>}
    </form>
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

// Sin resultados: crear el ejercicio con lo buscado como nombre.
export function NoResults({
  query,
  onCreate,
}: {
  query: string
  onCreate: (name: string) => void
}) {
  const name = query.trim()
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-muted-foreground text-sm">
        {name ? `No hay ningún ejercicio que se llame «${name}».` : 'Nada con esos filtros.'}
      </p>
      <Button variant="outline" onClick={() => onCreate(name.slice(0, 80))}>
        <Plus />{' '}
        {name ? `Crear «${name.length > 40 ? `${name.slice(0, 40)}…` : name}»` : 'Crear ejercicio'}
      </Button>
    </div>
  )
}
