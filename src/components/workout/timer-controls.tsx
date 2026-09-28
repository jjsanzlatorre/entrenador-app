import { useEffect, useRef } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { countdownAlert, setSoundMuted, useSoundMuted } from '@/lib/workout/alerts'
import { cn } from '@/lib/utils'

// Pitido/vibración en los últimos 3 s de cada fase y al terminarla.
// Solo avisa si el segundo cambia con la app abierta (no al volver tarde de segundo plano).
export function useCountdownAlerts(phaseKey: string, secondsLeft: number | null, active: boolean) {
  const last = useRef<{ key: string; second: number | null } | null>(null)
  useEffect(() => {
    if (!active) {
      last.current = null
      return
    }
    const previous = last.current?.key === phaseKey ? last.current.second : null
    last.current = { key: phaseKey, second: secondsLeft }
    if (secondsLeft === null || previous === null || previous === secondsLeft) return
    if (secondsLeft <= 3 && secondsLeft >= 1 && previous > secondsLeft) countdownAlert(secondsLeft)
  }, [phaseKey, secondsLeft, active])
}

// Aviso de fin de fase: cuando cambia la fase estando en marcha.
export function usePhaseChangeAlert(phaseKey: string, active: boolean) {
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (active && previous.current !== null && previous.current !== phaseKey) countdownAlert(0)
    previous.current = active ? phaseKey : null
  }, [phaseKey, active])
}

export function SoundToggle({ className }: { className?: string }) {
  const muted = useSoundMuted()
  return (
    <button
      type="button"
      onClick={() => setSoundMuted(!muted)}
      aria-pressed={muted}
      aria-label={muted ? 'Activar sonido de los temporizadores' : 'Silenciar temporizadores'}
      className={cn('hover:bg-accent rounded-full p-2', className)}
    >
      {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
    </button>
  )
}

export function BigButton({
  onClick,
  children,
  label,
  variant = 'secondary',
  className,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  label: string
  variant?: 'secondary' | 'primary' | 'danger'
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'flex h-16 min-w-16 flex-1 items-center justify-center gap-1 rounded-2xl px-2 text-base font-bold active:scale-95 disabled:opacity-40',
        variant === 'primary' && 'bg-primary text-primary-foreground',
        variant === 'secondary' && 'bg-secondary',
        variant === 'danger' && 'bg-destructive/10 text-destructive',
        className,
      )}
    >
      {children}
    </button>
  )
}
