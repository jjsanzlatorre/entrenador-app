import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

// − valor + con botones grandes (uso con una mano).
export function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-11"
        aria-label={`Menos ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span className="w-8 text-center text-2xl font-bold tabular-nums">{value}</span>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-11"
        aria-label={`Más ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  )
}
