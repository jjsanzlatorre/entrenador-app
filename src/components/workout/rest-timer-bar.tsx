import { useEffect, useRef, useState } from 'react'
import { Maximize2, Pause, Play, SkipForward } from 'lucide-react'
import { beep, vibrate } from '@/lib/workout/alerts'
import { formatClock } from '@/lib/workout/format'
import {
  getFullscreenAuto,
  setFullscreenAuto,
  useFullscreenAuto,
} from '@/lib/workout/fullscreen-pref'
import type { TimerDisplay } from '@/lib/workout/timer-display'
import { useNow } from '@/lib/workout/hooks'
import { restRemainingMs } from '@/lib/workout/session-ops'
import type { RestTimer } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { TimerFullscreen } from './timer-fullscreen'

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
  // Pantalla completa: a mano (tocando el reloj) o sola con cada descanso si está activado.
  const [fullscreenFor, setFullscreenFor] = useState<number | null>(() =>
    getFullscreenAuto('rest') ? rest.startedAt : null,
  )
  const autoRest = useFullscreenAuto('rest')
  const [seenRest, setSeenRest] = useState(rest.startedAt)
  if (seenRest !== rest.startedAt) {
    setSeenRest(rest.startedAt)
    setFullscreenFor(getFullscreenAuto('rest') ? rest.startedAt : null)
  }
  const fullscreen = fullscreenFor === rest.startedAt

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
  const display: TimerDisplay = {
    phase: finished ? 'done' : 'rest',
    title: 'Descanso',
    counter: null,
    clock: formatClock(seconds),
    open: false,
    warn: !finished && seconds <= 3,
    current: finished ? '¡A por la siguiente serie!' : exerciseName || null,
    next: null,
    progress,
    totalProgress: null,
  }

  return (
    <div
      className="bg-background/95 pb-safe px-safe fixed inset-x-0 bottom-0 z-40 border-t shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur"
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
        <button
          type="button"
          onClick={() => setFullscreenFor(rest.startedAt)}
          aria-label="Ver el descanso a pantalla completa"
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <Maximize2 className="size-3 shrink-0" />
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
        </button>
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
      {fullscreen && (
        <TimerFullscreen
          display={display}
          paused={paused}
          label={`Descanso${exerciseName ? ` · ${exerciseName}` : ''}`}
          onTogglePause={onTogglePause}
          controls={[
            { label: 'Restar 15 segundos', content: '−15 s', onClick: () => onAdjust(-15) },
            { label: 'Sumar 15 segundos', content: '+15 s', onClick: () => onAdjust(15) },
            {
              label: 'Saltar descanso',
              content: (
                <>
                  <SkipForward className="size-6" /> Saltar
                </>
              ),
              onClick: onSkip,
            },
          ]}
          extra={
            <label
              className="flex items-center gap-2 text-sm font-semibold opacity-90"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                className="size-4"
                checked={autoRest}
                onChange={(e) => setFullscreenAuto('rest', e.target.checked)}
              />
              Abrir sola en cada descanso
            </label>
          }
          onClose={() => setFullscreenFor(null)}
        />
      )}
    </div>
  )
}
