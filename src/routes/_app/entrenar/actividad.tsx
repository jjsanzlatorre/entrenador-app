import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, Watch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { saveFinishedSession } from '@/lib/workout/active-session'
import { parseInteger } from '@/lib/workout/format'
import { historyQueryKey } from '@/lib/workout/hooks'
import {
  QUICK_ACTIVITIES,
  createQuickActivity,
  type QuickActivityType,
} from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'

// «Registrar actividad»: yoga, surf, frontón u otra, en una sola pantalla.
export const Route = createFileRoute('/_app/entrenar/actividad')({
  ssr: false,
  component: QuickActivityPage,
})

const DURATION_PRESETS = [30, 45, 60, 90, 120]

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
  const [type, setType] = useState<QuickActivityType>('surf')
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('60')
  // Por defecto: terminó ahora y empezó hace «duración» minutos.
  const [start, setStart] = useState(() => startForDuration(60))
  const [rpe, setRpe] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [watchOpen, setWatchOpen] = useState(false)
  const [avgHr, setAvgHr] = useState('')
  const [maxHr, setMaxHr] = useState('')
  const [calories, setCalories] = useState('')
  const [saving, setSaving] = useState(false)

  const durationMin = parseInteger(duration)
  const valid = rpe !== null && durationMin !== null && durationMin > 0 && start !== ''

  function pickDuration(min: number) {
    setDuration(String(min))
    setStart(startForDuration(min))
  }

  async function save() {
    if (!valid || rpe === null || durationMin === null) return
    setSaving(true)
    try {
      const session = createQuickActivity(
        auth.userId,
        {
          type,
          title,
          startedAt: new Date(start).toISOString(),
          durationMin,
          rpe,
          notes: notes.trim() || null,
          avgHr: parseInteger(avgHr),
          maxHr: parseInteger(maxHr),
          calories: parseInteger(calories),
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

      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Tipo de actividad">
        {QUICK_ACTIVITIES.map((a) => (
          <button
            key={a.type}
            type="button"
            aria-pressed={type === a.type}
            onClick={() => setType(a.type)}
            className={cn(
              'flex h-20 flex-col items-center justify-center rounded-2xl text-sm font-bold active:scale-95',
              type === a.type ? 'bg-primary text-primary-foreground' : 'bg-secondary',
            )}
          >
            <span className="text-2xl" aria-hidden>
              {a.emoji}
            </span>
            {a.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="act-duration">Duración (min)</Label>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickDuration(m)}
              aria-pressed={duration === String(m)}
              className={cn(
                'h-10 rounded-full border px-4 text-sm font-medium',
                duration === String(m)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background',
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <Input
          id="act-duration"
          inputMode="numeric"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="h-12 text-lg"
        />
      </div>

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
            onChange={(e) => setStart(e.target.value)}
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
            <WatchInput id="act-avg" label="FC media" value={avgHr} onChange={setAvgHr} />
            <WatchInput id="act-max" label="FC máx" value={maxHr} onChange={setMaxHr} />
            <WatchInput id="act-cal" label="Calorías" value={calories} onChange={setCalories} />
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

function WatchInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
