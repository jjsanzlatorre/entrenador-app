import { cn } from '@/lib/utils'

// Interruptor accesible: role="switch", área táctil de 44 × 64 px aunque la pista mida 32 px.
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
  labelledBy?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-visible:ring-ring/50 -mr-1 flex h-11 w-16 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-60',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative h-8 w-14 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted-foreground/40',
        )}
      >
        <span
          className={cn(
            'bg-background absolute top-1 left-1 size-6 rounded-full shadow transition-transform motion-reduce:transition-none',
            checked && 'translate-x-6',
          )}
        />
      </span>
    </button>
  )
}
