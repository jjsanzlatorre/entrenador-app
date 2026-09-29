import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Botón de selección grande (toque cómodo con una mano).
export function Chip({
  selected,
  onClick,
  children,
  className,
  label,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card hover:bg-accent text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

// Selector de días de la semana L M X J V S D.
export function WeekdayPicker({
  value,
  onChange,
  label,
}: {
  value: number[]
  onChange: (days: number[]) => void
  label: string
}) {
  const names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  return (
    <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={label}>
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => {
        const day = i + 1
        const on = value.includes(day)
        return (
          <Chip
            key={d}
            selected={on}
            label={names[i]}
            className="px-0"
            onClick={() =>
              onChange(on ? value.filter((x) => x !== day) : [...value, day].sort((a, b) => a - b))
            }
          >
            {d}
          </Chip>
        )
      })}
    </div>
  )
}
