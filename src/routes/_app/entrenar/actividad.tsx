import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, Plus, Watch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DurationField, WatchField } from '@/components/ui/quantity-input'
import { Textarea } from '@/components/ui/textarea'
import { saveFinishedSession } from '@/lib/workout/active-session'
import { parseCount, parseDuration } from '@/lib/input/quantity'
import { historyQueryKey } from '@/lib/workout/hooks'
import { createQuickActivity } from '@/lib/workout/session-kinds'
import { quickActivityOptions } from '@/lib/activities/catalog'
import { useActivityTypes } from '@/lib/activities/hooks'
import { ActivityEditorSheet } from '@/components/activities/activity-editor'
import { cn } from '@/lib/utils'
import { notifyError } from '@/lib/notify'

// «Registrar actividad»: deportes, clases de gimnasio, yoga, surf, personalizadas u otra, en una
// sola pantalla.
export const Route = createFileRoute('/_app/entrenar/actividad')({
  ssr: false,
  component: QuickActivityPage,
})

function localDateTimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Inicio de una actividad de «min» minutos que acaba ahora.
function startForDuration(min: number) {
  return localDateTimeValue(new Date(Date.now() - min * 60_000))
}

function QuickActivityPage() {
  const { auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Se vuelve a pintar cuando llegan las actividades (y las personalizadas) del servidor.
  useActivityTypes(auth.userId)
  const options = quickActivityOptions(auth.userId)
  const [type, setType] = useState('surf')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('60')
  // Por defecto: terminó ahora y empezó hace «duración» minutos.
  const [start, setStart] = useState(() => startForDuration(60))
  // Mientras no se toque «Empezó», se recalcula al cambiar la duración (terminó ahora).
  const [startTouched, setStartTouched] = useState(false)
  const [rpe, setRpe] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [watchOpen, setWatchOpen] = useState(false)
  const [avgHr, setAvgHr] = useState('')
  const [maxHr, setMaxHr] = useState('')
  const [calories, setCalories] = useState('')
  const [saving, setSaving] = useState(false)

  const durationS = parseDuration(duration, 'min')
  const durationMin = durationS === null ? null : Math.round(durationS / 60)
  const valid = rpe !== null && durationMin !== null && durationMin > 0 && start !== ''

  function changeDuration(value: string) {
    setDuration(value)
    const seconds = parseDuration(value, 'min')
    if (!startTouched && seconds !== null && seconds > 0)
      setStart(startForDuration(Math.round(seconds / 60)))
  }

  async function save() {
    if (!valid || rpe === null || durationMin === null) return
    setSaving(true)
    try {
      const session = createQuickActivity(
        auth.userId,
        {
          activityId: type,
          title,
          startedAt: new Date(start).toISOString(),
          durationMin,
          rpe,
          notes: notes.trim() || null,
          avgHr: parseCount(avgHr),
          maxHr: parseCount(maxHr),
          calories: parseCount(calories),
        },
        Date.now(),
      )
      await saveFinishedSession(session)
      await queryClient.invalidateQueries({ queryKey: historyQueryKey(auth.userId) })
      await navigate({
        to: '/entrenar/historial/$sessionId',
        params: { sessionId: session.id },
        search: { nueva: 1 },
        replace: true,
      })
    } catch (error) {
      notifyError(error, 'guardar la actividad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <Link
        to="/entrenar"
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> Entrenar
      </Link>
      <h1 className="text-2xl font-bold">Registrar actividad</h1>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tipo de actividad">
        {options.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={type === a.id}
            onClick={() => setType(a.id)}
            className={cn(
              'flex h-20 flex-col items-center justify-center rounded-2xl px-1 text-center text-sm leading-tight font-bold active:scale-95',
              type === a.id ? 'bg-primary text-primary-foreground' : 'bg-secondary',
            )}
          >
            <span className="text-2xl" aria-hidden>
              {a.emoji}
            </span>
            <span className="line-clamp-2">{a.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-muted-foreground flex h-20 flex-col items-center justify-center rounded-2xl border border-dashed text-sm font-medium active:scale-95"
        >
          <Plus className="size-6" aria-hidden />
          Nueva
        </button>
      </div>
      <ActivityEditorSheet
        open={creating}
        onClose={() => setCreating(false)}
        userId={auth.userId}
        activity={null}
        onSaved={(a) => setType(a.id)}
      />

      <DurationField
        id="act-duration"
        value={duration}
        onChange={changeDuration}
        chips={[30, 45, 60, 90, 120]}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">¿Cómo de dura ha sido? (RPE)</legend>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRpe(value)}
              aria-pressed={rpe === value}
              className={cn(
                'h-14 rounded-xl text-xl font-bold active:scale-95',
                rpe === value ? 'bg-primary text-primary-foreground' : 'bg-secondary',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="act-start">Empezó</Label>
          <Input
            id="act-start"
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              setStartTouched(true)
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="act-title">Título (opcional)</Label>
          <Input
            id="act-title"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border">
        <button
          type="button"
          onClick={() => setWatchOpen(!watchOpen)}
          aria-expanded={watchOpen}
          className="flex w-full items-center justify-between px-3 py-3 text-left font-medium"
        >
          <span className="flex items-center gap-2">
            <Watch className="size-5" /> Datos del reloj
            <span className="text-muted-foreground text-xs font-normal">(opcional)</span>
          </span>
          <ChevronDown className={cn('size-5 transition-transform', watchOpen && 'rotate-180')} />
        </button>
        {watchOpen && (
          <div className="grid grid-cols-3 gap-2 px-3 pb-3">
            <WatchField
              id="act-avg"
              label="FC media"
              unit="ppm"
              value={avgHr}
              onChange={setAvgHr}
            />
            <WatchField id="act-max" label="FC máx" unit="ppm" value={maxHr} onChange={setMaxHr} />
            <WatchField
              id="act-cal"
              label="Calorías"
              unit="kcal"
              value={calories}
              onChange={setCalories}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="act-notes">Notas</Label>
        <Textarea
          id="act-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Condiciones, sensaciones…"
        />
      </div>

      <Button
        size="lg"
        className="h-14 text-lg"
        disabled={!valid || saving}
        onClick={() => void save()}
      >
        {saving ? 'Guardando…' : 'Guardar actividad'}
      </Button>
    </div>
  )
}
