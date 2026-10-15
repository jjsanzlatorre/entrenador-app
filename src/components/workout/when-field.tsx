// Selector de fecha y hora de una sesión: «Hoy», «Ayer», «Anteayer», calendario y hora.
// Nunca deja elegir una fecha futura.
import { useId } from 'react'
import { CalendarDays } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { localDateKey } from '@/lib/progress/dates'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/workout/hooks'
import {
  QUICK_DAYS,
  quickDay,
  whenProblem,
  whenToMs,
  formatWhen,
  type WhenValue,
} from '@/lib/workout/when'

export function WhenField({
  label = '¿Cuándo?',
  value,
  onChange,
  now: nowProp,
  hint,
  id,
}: {
  label?: string
  value: WhenValue
  onChange: (value: WhenValue) => void
  now?: number
  // Texto bajo el campo (p. ej. qué modo se abrirá).
  hint?: string | null
  id?: string
}) {
  const tick = useNow(30_000)
  const now = nowProp ?? tick
  const autoId = useId()
  const base = id ?? `when-${autoId}`
  const today = localDateKey(now)
  const quick = QUICK_DAYS.map((q) => ({ ...q, date: quickDay(today, q.offset) }))
  const isQuick = quick.some((q) => q.date === value.date)
  const problem = whenProblem(value, now)
  const ms = whenToMs(value)

  return (
    <fieldset className="flex flex-col gap-2" data-testid="when-field">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Día">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            aria-pressed={value.date === q.date}
            onClick={() => onChange({ ...value, date: q.date })}
            className={cn(
              'h-11 rounded-xl border text-sm font-semibold active:scale-95',
              value.date === q.date
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card',
            )}
          >
            {q.label}
          </button>
        ))}
        <label
          className={cn(
            'relative flex h-11 items-center justify-center gap-1 rounded-xl border text-sm font-semibold',
            !isQuick ? 'bg-primary text-primary-foreground border-primary' : 'bg-card',
          )}
        >
          <CalendarDays className="size-4" aria-hidden />
          <span>{isQuick ? 'Otro' : value.date.slice(8) + '/' + value.date.slice(5, 7)}</span>
          <input
            type="date"
            aria-label="Elegir otro día"
            data-testid="when-date"
            max={today}
            value={value.date}
            onChange={(e) => e.target.value && onChange({ ...value, date: e.target.value })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${base}-time`} className="text-muted-foreground text-sm">
          Hora
        </label>
        <Input
          id={`${base}-time`}
          type="time"
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
          className="h-11 w-32 text-base"
        />
        {ms !== null && !problem && (
          <span
            className="text-muted-foreground min-w-0 truncate text-sm"
            data-testid="when-preview"
          >
            = {formatWhen(ms, now)}
          </span>
        )}
      </div>
      {problem ? (
        <p className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-sm">{hint}</p>
      ) : null}
    </fieldset>
  )
}
