import { useEffect, useRef, useState } from 'react'
import { useSwipe } from '@/lib/ui/use-swipe'
import { Check, Minus, Play, Plus, Square, Trash2 } from 'lucide-react'
import { stepQuantity } from '@/lib/input/quantity'
import { countdownAlert, sideSwitchAlert, unlockAudio } from '@/lib/workout/alerts'
import { holdView, pressHold, startHold, type Hold } from '@/lib/workout/hold'
import type { FieldSpec } from '@/lib/workout/fields'
import { formatClock, formatKg } from '@/lib/workout/format'
import type { SetEntry } from '@/lib/workout/types'
import type { SetPatch } from '@/lib/workout/session-ops'
import { cn } from '@/lib/utils'
import { ValueCell } from './value-cell'

// Texto del botón (la unidad solo en los tiempos, donde puede ser s o min).
function stepText(spec: FieldSpec) {
  return `${formatKg(spec.step)}${spec.field === 'durationS' ? ` ${spec.unit}` : ''}`
}

// Temporizador de una serie isométrica (src/lib/workout/hold.ts): con tiempo objetivo, cuenta
// atrás; sin él, cronómetro; «cada lado», los dos lados con aviso al cambiar.
function useHoldClock(hold: Hold | null, onFinish: (seconds: number) => void) {
  const [now, setNow] = useState(() => Date.now())
  const lastAlert = useRef<string | null>(null)
  const lastSide = useRef<1 | 2 | null>(null)
  const finish = useRef(onFinish)
  useEffect(() => {
    finish.current = onFinish
  })

  useEffect(() => {
    if (!hold) return
    lastAlert.current = null
    lastSide.current = holdView(hold, Date.now()).side
    let finished = false
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      const view = holdView(hold, t)
      // Cambio de lado automático (al acabar el tiempo del lado 1): aviso «Cambia de lado».
      if (view.side !== lastSide.current) {
        if (lastSide.current === 1 && view.side === 2 && hold.switchedAt === null) sideSwitchAlert()
        lastSide.current = view.side
      }
      if (view.leftS !== null && view.leftS <= 3 && view.leftS >= 0) {
        const key = `${view.side}:${view.leftS}`
        // El 0 del lado 1 ya lo avisa el cambio de lado.
        if (key !== lastAlert.current && !(view.side === 1 && view.leftS === 0)) {
          lastAlert.current = key
          countdownAlert(view.leftS)
        }
      }
      if (view.done && view.resultS !== null && !finished) {
        finished = true
        finish.current(view.resultS)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [hold])

  return hold ? holdView(hold, now) : null
}

export function SetRow({
  set,
  specs,
  label,
  selected,
  onSelect,
  onChange,
  onToggleComplete,
  onToggleWarmup,
  onRemove,
  onCompleteHold,
  perSide = false,
}: {
  set: SetEntry
  specs: FieldSpec[]
  label: string
  selected: boolean
  onSelect: () => void
  onChange: (patch: SetPatch) => void
  onToggleComplete: () => void
  onToggleWarmup: () => void
  onRemove: () => void
  // Series por tiempo (isométricos): botón ▶ que cronometra y completa la serie.
  onCompleteHold?: (durationS: number) => void
  // «Cada lado»: el cronómetro hace los dos lados (con aviso al cambiar).
  perSide?: boolean
}) {
  const [hold, setHold] = useState<Hold | null>(null)
  const holdEnabled = Boolean(onCompleteHold) && !set.completed
  const clock = useHoldClock(hold, (seconds) => {
    setHold(null)
    onCompleteHold?.(seconds)
  })

  function toggleHold() {
    unlockAudio()
    if (!hold) {
      setHold(startHold(Date.now(), set.durationS, perSide))
      onSelect()
      return
    }
    const pressed = pressHold(hold, Date.now())
    if (pressed.hold) {
      sideSwitchAlert()
      setHold(pressed.hold)
      return
    }
    setHold(null)
    if (pressed.resultS !== null) onCompleteHold?.(pressed.resultS)
  }

  // Deslizar a la derecha completa (o desmarca) y a la izquierda borra (con «Deshacer»).
  const swipe = useSwipe({
    onRight: () => {
      setHold(null)
      onToggleComplete()
    },
    onLeft: onRemove,
    disabled: Boolean(hold),
  })

  const extra = holdEnabled ? 1 : 0
  const count = specs.length + extra
  const columns =
    count === 1
      ? 'grid-cols-[2.75rem_1fr_3.5rem]'
      : count === 2
        ? 'grid-cols-[2.75rem_1fr_1fr_3.5rem]'
        : 'grid-cols-[2.75rem_1fr_1fr_1fr_3.5rem]'

  return (
    <div className="relative overflow-hidden rounded-xl" data-set-row={set.id}>
      {swipe.swiping && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center px-4 text-sm font-semibold text-white',
            swipe.dx > 0 ? 'justify-start bg-emerald-700' : 'bg-destructive justify-end',
          )}
        >
          {swipe.dx > 0 ? (set.completed ? 'Desmarcar' : '✓ Completar') : 'Borrar'}
        </div>
      )}
      <div
        {...swipe.handlers}
        style={swipe.swiping ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        className={cn(
          'bg-card relative touch-pan-y rounded-xl',
          !swipe.swiping && 'transition-transform',
        )}
      >
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
            {clock !== null ? (
              <div
                role="timer"
                aria-label={
                  hold?.targetS === null ? 'Cronómetro de la serie' : 'Cuenta atrás de la serie'
                }
                className="bg-primary/10 text-primary flex h-12 flex-col items-center justify-center rounded-lg leading-none font-bold tabular-nums"
                style={{ gridColumn: `span ${specs.length}` }}
              >
                <span className="text-2xl">{formatClock(clock.clockS)}</span>
                {clock.side !== null && (
                  <span className="text-[11px] font-semibold" data-testid="hold-side">
                    Lado {clock.side}
                  </span>
                )}
              </div>
            ) : (
              specs.map((spec) => (
                <ValueCell
                  key={spec.field}
                  spec={spec}
                  value={set[spec.field]}
                  done={set.completed}
                  onFocus={onSelect}
                  onChange={(value) => onChange({ [spec.field]: value })}
                />
              ))
            )}
            {holdEnabled && (
              <button
                type="button"
                onClick={toggleHold}
                aria-label={
                  hold
                    ? hold.perSide && clock?.side === 1
                      ? 'Cambiar de lado'
                      : 'Parar y guardar el tiempo'
                    : 'Empezar a cronometrar la serie'
                }
                className={cn(
                  'flex h-12 items-center justify-center rounded-lg font-semibold active:scale-95',
                  hold ? 'bg-destructive text-white' : 'bg-secondary',
                )}
              >
                {hold ? <Square className="size-5" /> : <Play className="size-5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setHold(null)
                onToggleComplete()
              }}
              aria-pressed={set.completed}
              aria-label={
                set.completed ? `${label} hecha. Tocar para desmarcar` : `Completar ${label}`
              }
              className={cn(
                'flex h-12 items-center justify-center rounded-lg border-2 transition-colors active:scale-95',
                set.completed
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-primary text-primary bg-background',
              )}
            >
              <Check className="size-7" strokeWidth={3} />
            </button>
          </div>

          {selected && !set.completed && !hold && (
            <div className="flex flex-col gap-2 px-1.5 pb-2">
              <div
                className={cn(
                  'grid gap-2',
                  specs.length === 1
                    ? 'grid-cols-1'
                    : specs.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-3',
                )}
              >
                {specs.map((spec) => (
                  <div key={spec.field} className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-center text-[11px] uppercase">
                      {spec.unit}
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      {([-1, 1] as const).map((direction) => (
                        <button
                          key={direction}
                          type="button"
                          onClick={() =>
                            onChange({
                              [spec.field]: stepQuantity(
                                set[spec.field],
                                spec.step * direction,
                                spec.quantity,
                              ),
                            })
                          }
                          className="bg-secondary flex h-11 items-center justify-center gap-0.5 rounded-lg text-sm font-semibold active:scale-95"
                          aria-label={`${direction === 1 ? '+' : '−'}${formatKg(spec.step)} ${spec.unit}`}
                        >
                          {direction === 1 ? (
                            <Plus className="size-3.5" />
                          ) : (
                            <Minus className="size-3.5" />
                          )}
                          {stepText(spec)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {onCompleteHold && (
                <p className="text-muted-foreground text-center text-xs">
                  ▶ cronometra la serie
                  {set.durationS ? ` (cuenta atrás desde ${formatClock(set.durationS)})` : ''}
                  {perSide ? ', los dos lados con aviso al cambiar,' : ''} y la completa al parar.
                </p>
              )}
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
                  className="text-destructive relative ml-1 flex h-9 w-10 items-center justify-center rounded-md after:absolute after:-inset-1 after:content-['']"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
