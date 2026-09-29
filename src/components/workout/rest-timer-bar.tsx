import { useEffect, useRef } from 'react'
import { Pause, Play, SkipForward } from 'lucide-react'
import { beep, vibrate } from '@/lib/workout/alerts'
import { formatClock } from '@/lib/workout/format'
import { useNow } from '@/lib/workout/hooks'
import { restRemainingMs } from '@/lib/workout/session-ops'
import type { RestTimer } from '@/lib/workout/types'
import { cn } from '@/lib/utils'

// Descanso basado en timestamps (endsAt): al volver de segundo plano muestra el tiempo real.
export function RestTimerBar({
  rest,
  exerciseName,
  onAdjust,
  onTogglePause,
  onSkip,
}: {
  rest: RestTimer
  exerciseName: string
  onAdjust: (deltaS: number) => void
  onTogglePause: () => void
  onSkip: () => void
}) {
  const now = useNow(250)
  const remaining = restRemainingMs(rest, now)
  const total = Math.max(1, rest.endsAt - rest.startedAt)
  const seconds = Math.ceil(remaining / 1000)
  const finished = remaining <= 0
  const paused = rest.pausedRemainingMs !== null

  // Pitido en los últimos 3 s y al final (solo si se cruza el segundo ahora, no al volver tarde).
  const lastAlert = useRef<{ key: number; second: number } | null>(null)
  useEffect(() => {
    if (paused) return
    const key = rest.endsAt
    const previous = lastAlert.current?.key === key ? lastAlert.current.second : null
    if (previous === seconds) return
    lastAlert.current = { key, second: seconds }
    const lateMs = now - rest.endsAt
    if (seconds <= 3 && seconds > 0 && previous !== null) {
      beep(90, 880)
      vibrate(60)
    } else if (seconds <= 0 && previous !== null && previous > 0 && lateMs < 1500) {
      beep(450, 1320)
      vibrate([200, 100, 200])
    }
  }, [seconds, paused, rest.endsAt, now])

  // Se oculta sola 10 s después de terminar.
  useEffect(() => {
    if (finished && !paused && now - rest.endsAt > 10_000) onSkip()
  }, [finished, paused, now, rest.endsAt, onSkip])

  const progress = Math.min(1, Math.max(0, 1 - remaining / total))

  return (
    <div
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="timer"
      aria-live="off"
    >
      <div className="bg-muted h-1.5 w-full">
        <div
          className={cn(
            'h-full transition-[width] duration-200',
            finished ? 'bg-emerald-500' : 'bg-primary',
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mx-auto flex max-w-lg items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground truncate text-xs">
            {finished
              ? '¡A por la siguiente serie!'
              : paused
                ? 'Descanso en pausa'
                : `Descanso · ${exerciseName}`}
          </p>
          <p
            className={cn(
              'text-4xl leading-none font-bold tabular-nums',
              finished && 'text-success',
              !finished && seconds <= 3 && 'text-destructive',
            )}
          >
            {formatClock(seconds)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAdjust(-15)}
          className="bg-secondary h-14 w-14 rounded-xl text-sm font-bold active:scale-95"
          aria-label="Restar 15 segundos"
        >
          −15
        </button>
        <button
          type="button"
          onClick={() => onAdjust(15)}
          className="bg-secondary h-14 w-14 rounded-xl text-sm font-bold active:scale-95"
          aria-label="Sumar 15 segundos"
        >
          +15
        </button>
        <button
          type="button"
          onClick={onTogglePause}
          className="bg-secondary flex h-14 w-14 items-center justify-center rounded-xl active:scale-95"
          aria-label={paused ? 'Reanudar descanso' : 'Pausar descanso'}
        >
          {paused ? <Play className="size-6" /> : <Pause className="size-6" />}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="bg-primary text-primary-foreground flex h-14 w-14 items-center justify-center rounded-xl active:scale-95"
          aria-label="Saltar descanso"
        >
          <SkipForward className="size-6" />
        </button>
      </div>
    </div>
  )
}
