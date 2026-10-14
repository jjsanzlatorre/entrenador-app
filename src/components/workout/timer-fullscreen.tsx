import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, Pause } from 'lucide-react'
import { useWakeLock } from '@/lib/workout/hooks'
import type { TimerDisplay } from '@/lib/workout/timer-display'
import { cn } from '@/lib/utils'
import { SoundToggle } from './timer-controls'

export type FullscreenControl = {
  label: string
  content: ReactNode
  onClick: () => void
  disabled?: boolean
}

const PHASE_NAMES: Record<TimerDisplay['phase'], string> = {
  prep: 'Prepárate',
  work: 'Trabajo',
  rest: 'Descanso',
  done: 'Terminado',
}

// Colores por fase, con contraste alto (dígitos legibles a 2–3 m).
const PHASE_COLORS: Record<TimerDisplay['phase'] | 'paused', string> = {
  prep: 'bg-amber-400 text-black',
  work: 'bg-rose-700 text-white',
  rest: 'bg-emerald-700 text-white',
  done: 'bg-zinc-800 text-white',
  paused: 'bg-zinc-700 text-white',
}

// Ancho aproximado del reloj en «em» (cifras tabulares ≈ 0,62 em; «:» ≈ 0,32 em).
export function clockWidthEm(clock: string) {
  let em = 0
  for (const ch of clock) em += ch === ':' ? 0.32 : 0.62
  return Math.max(em, 1)
}

// Cronómetro a pantalla completa: dígitos enormes, color por fase, ronda o minuto, ejercicio
// actual y siguiente, barra de progreso. Tocar en cualquier sitio pausa o continúa; los botones
// grandes no. Vertical y horizontal, dentro de los márgenes de seguridad, con la pantalla
// encendida. Los avisos (pitidos y vibración) siguen en el componente que lo abre.
export function TimerFullscreen({
  display,
  paused,
  label,
  onTogglePause,
  controls,
  big,
  extra,
  onClose,
}: {
  display: TimerDisplay
  paused: boolean
  // Qué es: «EMOM», «Descanso», «Tabata»…
  label: string
  onTogglePause?: () => void
  controls: FullscreenControl[]
  // Acción principal enorme (AMRAP «+1 ronda», intervalos «Serie hecha»).
  big?: FullscreenControl | null
  // Contador extra (rondas del AMRAP).
  extra?: ReactNode
  onClose: () => void
}) {
  useWakeLock(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ' && onTogglePause) {
        e.preventDefault()
        onTogglePause()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, onTogglePause])

  if (typeof document === 'undefined') return null
  const color = paused ? PHASE_COLORS.paused : PHASE_COLORS[display.phase]
  const side = Boolean(display.current || display.next || extra || big)
  const widthEm = clockWidthEm(display.clock)
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  const light = !paused && display.phase === 'prep'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} a pantalla completa`}
      data-phase={paused ? 'paused' : display.phase}
      onClick={onTogglePause}
      className={cn(
        'pt-safe-2 pb-safe-3 px-safe-3 fixed inset-0 z-[60] flex flex-col gap-2 transition-colors duration-300 select-none',
        color,
      )}
    >
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black tracking-wide uppercase sm:text-2xl">
            {paused ? 'En pausa' : PHASE_NAMES[display.phase]}
          </p>
          <p className="truncate text-sm font-semibold opacity-80">{label}</p>
        </div>
        {display.counter && (
          <p className="shrink-0 text-3xl font-black tabular-nums sm:text-4xl">{display.counter}</p>
        )}
        <div onClick={(e) => e.stopPropagation()}>
          <SoundToggle className="hover:bg-white/15" />
        </div>
        <button
          type="button"
          onClick={stop(onClose)}
          aria-label="Salir de pantalla completa"
          className="rounded-full p-2.5 hover:bg-white/15"
        >
          <Minimize2 className="size-6" />
        </button>
      </header>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col items-center justify-center gap-2',
          side && 'landscape:flex-row',
        )}
      >
        <div
          role="timer"
          aria-live="off"
          className={cn(
            'flex min-h-0 w-full flex-1 items-center justify-center',
            side
              ? '[--fs-h:40dvh] landscape:[--fs-h:62dvh] landscape:[--fs-w:60vw]'
              : '[--fs-h:46dvh] landscape:[--fs-h:60dvh]',
            '[--fs-w:100vw]',
          )}
        >
          <span
            className={cn(
              'leading-none font-black tracking-tight tabular-nums',
              display.warn && !paused && 'animate-pulse',
            )}
            style={{
              fontSize: `min(calc((var(--fs-w) - 2rem) / ${widthEm.toFixed(2)}), var(--fs-h))`,
            }}
          >
            {display.clock}
          </span>
        </div>
        {side && (
          <div className="flex w-full flex-col items-center gap-2 text-center landscape:w-[38vw]">
            {display.current && (
              <p className="line-clamp-2 text-3xl leading-tight font-bold sm:text-4xl">
                {display.current}
              </p>
            )}
            {display.next && (
              <p className="line-clamp-2 text-lg font-semibold opacity-85">
                Siguiente: {display.next}
              </p>
            )}
            {extra}
            {big && (
              <button
                type="button"
                aria-label={big.label}
                disabled={big.disabled}
                onClick={stop(big.onClick)}
                className={cn(
                  'flex h-24 w-full max-w-md items-center justify-center gap-2 rounded-3xl text-3xl font-black shadow-lg active:scale-95 disabled:opacity-40',
                  light ? 'bg-black text-white' : 'bg-white text-black',
                )}
              >
                {big.content}
              </button>
            )}
          </div>
        )}
      </div>

      {paused && (
        <p className="flex items-center justify-center gap-2 text-center text-lg font-bold">
          <Pause className="size-5" /> Toca la pantalla para continuar
        </p>
      )}

      {(display.progress !== null || display.totalProgress !== null) && (
        <div className="flex flex-col gap-1" aria-hidden>
          {display.progress !== null && (
            <div
              className={cn(
                'h-3 overflow-hidden rounded-full',
                light ? 'bg-black/15' : 'bg-white/25',
              )}
            >
              <div
                className={cn('h-full rounded-full', light ? 'bg-black' : 'bg-white')}
                style={{ width: `${display.progress * 100}%` }}
              />
            </div>
          )}
          {display.totalProgress !== null && (
            <div
              className={cn(
                'h-1.5 overflow-hidden rounded-full',
                light ? 'bg-black/10' : 'bg-white/15',
              )}
            >
              <div
                className={cn('h-full rounded-full', light ? 'bg-black/60' : 'bg-white/70')}
                style={{ width: `${display.totalProgress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {controls.length > 0 && (
        <div className="flex gap-2">
          {controls.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-label={c.label}
              disabled={c.disabled}
              onClick={stop(c.onClick)}
              className={cn(
                'flex h-16 min-w-0 flex-1 items-center justify-center gap-1 rounded-2xl text-lg font-bold active:scale-95 disabled:opacity-35',
                light ? 'bg-black/15' : 'bg-white/20',
              )}
            >
              {c.content}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
