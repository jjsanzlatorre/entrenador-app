import { useState } from 'react'
import { ChevronDown, Watch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { parseInteger } from '@/lib/workout/format'
import type { SessionDetailsPatch } from '@/lib/workout/session-ops'
import type { LocalSession } from '@/lib/workout/types'
import { cn } from '@/lib/utils'

const RPE_HINTS: Record<number, string> = {
  1: 'Muy suave',
  3: 'Suave',
  5: 'Moderada',
  7: 'Dura',
  9: 'Muy dura',
  10: 'Máxima',
}

function rpeHint(rpe: number | null) {
  if (rpe === null) return 'Elige del 1 al 10'
  const key = [10, 9, 7, 5, 3, 1].find((k) => rpe >= k) ?? 1
  return RPE_HINTS[key]
}

export function FinishSheet({
  open,
  session,
  elapsedMin,
  pendingSets,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  session: LocalSession
  elapsedMin: number
  pendingSets: number
  saving: boolean
  onClose: () => void
  onSave: (details: SessionDetailsPatch) => void
}) {
  const editing = session.mode === 'edit'
  const [rpe, setRpe] = useState<number | null>(session.rpe)
  const [duration, setDuration] = useState(String(session.durationMin ?? elapsedMin))
  const [avgHr, setAvgHr] = useState(session.avgHr?.toString() ?? '')
  const [maxHr, setMaxHr] = useState(session.maxHr?.toString() ?? '')
  const [calories, setCalories] = useState(session.calories?.toString() ?? '')
  const [notes, setNotes] = useState(session.notes ?? '')
  const [watchOpen, setWatchOpen] = useState(
    session.avgHr !== null || session.maxHr !== null || session.calories !== null,
  )

  const durationMin = parseInteger(duration)
  const canSave = rpe !== null && durationMin !== null && !saving

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Guardar cambios' : 'Terminar sesión'}
      footer={
        <Button
          size="lg"
          className="h-14 w-full text-lg"
          disabled={!canSave}
          onClick={() =>
            onSave({
              rpe,
              durationMin,
              avgHr: parseInteger(avgHr),
              maxHr: parseInteger(maxHr),
              calories: parseInteger(calories),
              notes: notes.trim() || null,
            })
          }
        >
          {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar sesión'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {pendingSets > 0 && !editing && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            Tienes {pendingSets} {pendingSets === 1 ? 'serie sin marcar' : 'series sin marcar'}: se
            guardarán pero no cuentan como hechas.
          </p>
        )}

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
          <p className="text-muted-foreground text-sm">{rpeHint(rpe)}</p>
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="duration">Duración (min)</Label>
          <Input
            id="duration"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="h-12 text-lg"
          />
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
              <WatchField id="avg_hr" label="FC media" value={avgHr} onChange={setAvgHr} />
              <WatchField id="max_hr" label="FC máx" value={maxHr} onChange={setMaxHr} />
              <WatchField id="calories" label="Calorías" value={calories} onChange={setCalories} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notas</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Sensaciones, molestias, qué cambiar la próxima vez…"
          />
        </div>
      </div>
    </Sheet>
  )
}

function WatchField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
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
