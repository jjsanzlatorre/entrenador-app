import { Check, Minus, Plus, Trash2 } from 'lucide-react'
import { FIELD_STEP, FIELD_UNIT, stepField, type SetField } from '@/lib/workout/fields'
import { formatKg } from '@/lib/workout/format'
import type { SetEntry } from '@/lib/workout/types'
import type { SetPatch } from '@/lib/workout/session-ops'
import { cn } from '@/lib/utils'
import { ValueCell } from './value-cell'

const FIELD_LABEL: Record<SetField, string> = {
  weightKg: 'Peso (kg)',
  reps: 'Repeticiones',
  durationS: 'Tiempo',
  distanceM: 'Distancia (m)',
  calories: 'Calorías',
}

function stepLabel(field: SetField, direction: 1 | -1) {
  const step = FIELD_STEP[field]
  const sign = direction === 1 ? '+' : '−'
  if (field === 'weightKg') return `${sign}${formatKg(step)}`
  if (field === 'durationS') return `${sign}${step} s`
  return `${sign}${step}`
}

export function SetRow({
  set,
  fields,
  label,
  selected,
  onSelect,
  onChange,
  onToggleComplete,
  onToggleWarmup,
  onRemove,
}: {
  set: SetEntry
  fields: SetField[]
  label: string
  selected: boolean
  onSelect: () => void
  onChange: (patch: SetPatch) => void
  onToggleComplete: () => void
  onToggleWarmup: () => void
  onRemove: () => void
}) {
  const columns =
    fields.length === 1
      ? 'grid-cols-[2.75rem_1fr_3.5rem]'
      : fields.length === 2
        ? 'grid-cols-[2.75rem_1fr_1fr_3.5rem]'
        : 'grid-cols-[2.75rem_1fr_1fr_1fr_3.5rem]'

  return (
    <div
      className={cn(
        'rounded-xl transition-colors',
        selected && !set.completed && 'bg-primary/5 ring-primary/30 ring-1',
        set.completed && 'bg-emerald-500/10',
      )}
    >
      <div className={cn('grid items-center gap-2 p-1.5', columns)}>
        <button
          type="button"
          onClick={onToggleWarmup}
          aria-label={
            set.isWarmup
              ? `${label}: calentamiento. Tocar para serie normal`
              : `${label}. Tocar para marcar calentamiento`
          }
          className={cn(
            'h-12 rounded-lg text-sm font-bold',
            set.isWarmup
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
              : 'text-muted-foreground',
          )}
        >
          {set.isWarmup ? 'C' : label}
        </button>
        {fields.map((field) => (
          <ValueCell
            key={field}
            field={field}
            label={FIELD_LABEL[field]}
            value={set[field]}
            done={set.completed}
            onFocus={onSelect}
            onChange={(value) => onChange({ [field]: value })}
          />
        ))}
        <button
          type="button"
          onClick={onToggleComplete}
          aria-pressed={set.completed}
          aria-label={set.completed ? `${label} hecha. Tocar para desmarcar` : `Completar ${label}`}
          className={cn(
            'flex h-12 items-center justify-center rounded-lg border-2 transition-colors active:scale-95',
            set.completed
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-primary text-primary bg-background',
          )}
        >
          <Check className="size-7" strokeWidth={3} />
        </button>
      </div>

      {selected && !set.completed && (
        <div className="flex flex-col gap-2 px-1.5 pb-2">
          <div
            className={cn(
              'grid gap-2',
              fields.length === 1
                ? 'grid-cols-1'
                : fields.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-3',
            )}
          >
            {fields.map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-center text-[11px] uppercase">
                  {FIELD_UNIT[field]}
                </span>
                <div className="grid grid-cols-2 gap-1">
                  {([-1, 1] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => onChange({ [field]: stepField(set[field], field, direction) })}
                      className="bg-secondary flex h-11 items-center justify-center gap-0.5 rounded-lg text-sm font-semibold active:scale-95"
                      aria-label={`${stepLabel(field, direction)} ${FIELD_UNIT[field]}`}
                    >
                      {direction === 1 ? (
                        <Plus className="size-3.5" />
                      ) : (
                        <Minus className="size-3.5" />
                      )}
                      {stepLabel(field, direction).slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground mr-1 text-xs">RIR</span>
            {[0, 1, 2, 3, 4, 5].map((rir) => (
              <button
                key={rir}
                type="button"
                onClick={() => onChange({ rir: set.rir === rir ? null : rir })}
                className={cn(
                  'h-9 flex-1 rounded-md text-sm font-medium',
                  set.rir === rir ? 'bg-primary text-primary-foreground' : 'bg-secondary',
                )}
                aria-pressed={set.rir === rir}
              >
                {rir}
              </button>
            ))}
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Borrar ${label}`}
              className="text-destructive ml-1 flex h-9 w-10 items-center justify-center rounded-md"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
