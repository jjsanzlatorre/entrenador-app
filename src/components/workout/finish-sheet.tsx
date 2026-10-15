import { useState } from 'react'
import { ChevronDown, Watch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { DurationField, WatchField } from '@/components/ui/quantity-input'
import { parseCount, parseDuration } from '@/lib/input/quantity'
import type { SessionDetailsPatch } from '@/lib/workout/session-ops'
import type { LocalSession } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { whenFromInstant, whenProblem, whenToMs } from '@/lib/workout/when'
import { WhenField } from './when-field'
import { useNow } from '@/lib/workout/hooks'

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
  onCompleteAll,
}: {
  open: boolean
  session: LocalSession
  elapsedMin: number | null
  pendingSets: number
  saving: boolean
  onClose: () => void
  onSave: (details: SessionDetailsPatch) => void
  // «Entreno pasado»: marcar como hechas las series pendientes que tienen datos.
  onCompleteAll?: () => void
}) {
  const editing = session.mode === 'edit'
  const past = session.mode === 'past'
  const [rpe, setRpe] = useState<number | null>(session.rpe)
  const [duration, setDuration] = useState(
    session.durationMin !== null
      ? String(session.durationMin)
      : elapsedMin !== null
        ? String(elapsedMin)
        : '',
  )
  // Fecha y hora de inicio (por defecto, la de la sesión). En directo solo se guarda si cambia.
  const initialWhen = whenFromInstant(session.startedAt)
  const [when, setWhen] = useState(initialWhen)
  const whenChanged = when.date !== initialWhen.date || when.time !== initialWhen.time
  const now = useNow(30_000)
  const whenInvalid = Boolean(whenProblem(when, now))
  const [avgHr, setAvgHr] = useState(session.avgHr?.toString() ?? '')
  const [maxHr, setMaxHr] = useState(session.maxHr?.toString() ?? '')
  const [calories, setCalories] = useState(session.calories?.toString() ?? '')
  const [notes, setNotes] = useState(session.notes ?? '')
  const [watchOpen, setWatchOpen] = useState(
    session.avgHr !== null || session.maxHr !== null || session.calories !== null,
  )

  const durationS = parseDuration(duration, 'min')
  const durationMin = durationS === null ? null : Math.round(durationS / 60)
  const canSave = rpe !== null && durationMin !== null && !saving && !whenInvalid
  const startedAt =
    past || whenChanged
      ? new Date(whenToMs(when) ?? Date.parse(session.startedAt)).toISOString()
      : undefined

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Guardar cambios' : past ? 'Guardar entreno' : 'Terminar sesión'}
      footer={
        <Button
          size="lg"
          className="h-14 w-full text-lg"
          disabled={!canSave}
          onClick={() =>
            onSave({
              rpe,
              durationMin,
              avgHr: parseCount(avgHr),
              maxHr: parseCount(maxHr),
              calories: parseCount(calories),
              notes: notes.trim() || null,
              ...(startedAt ? { startedAt } : {}),
            })
          }
        >
          {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar sesión'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {pendingSets > 0 && !editing && (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <p>
              Tienes {pendingSets} {pendingSets === 1 ? 'serie sin marcar' : 'series sin marcar'}:
              se guardarán pero no cuentan como hechas.
            </p>
            {past && onCompleteAll && (
              <Button variant="outline" size="sm" className="self-start" onClick={onCompleteAll}>
                Marcar todas como hechas
              </Button>
            )}
          </div>
        )}

        <WhenField
          id="finish-when"
          label={past || editing ? '¿Cuándo empezó?' : 'Empezó'}
          value={when}
          onChange={setWhen}
          hint={
            !past && !editing && whenChanged
              ? 'Se guardará con esta fecha y hora (fin = inicio + duración).'
              : null
          }
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
          <p className="text-muted-foreground text-sm">{rpeHint(rpe)}</p>
        </fieldset>

        <DurationField id="duration" value={duration} onChange={setDuration} />

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
                id="avg_hr"
                label="FC media"
                unit="ppm"
                value={avgHr}
                onChange={setAvgHr}
              />
              <WatchField id="max_hr" label="FC máx" unit="ppm" value={maxHr} onChange={setMaxHr} />
              <WatchField
                id="calories"
                label="Calorías"
                unit="kcal"
                value={calories}
                onChange={setCalories}
              />
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
