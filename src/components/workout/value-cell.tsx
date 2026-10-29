import { useEffect, useRef, useState } from 'react'
import {
  describeQuantity,
  formatQuantityInput,
  parseQuantity,
  quantityHint,
  type QuantityKind,
} from '@/lib/input/quantity'
import { type FieldSpec } from '@/lib/workout/fields'
import { formatClock, formatKg } from '@/lib/workout/format'
import { cn } from '@/lib/utils'

// Texto y unidad que se ven en la celda. En un campo en km, menos de 1 km se ve en metros.
export function cellDisplay(spec: FieldSpec, value: number | null) {
  if (value === null) return { text: '—', unit: spec.unit }
  switch (spec.field) {
    case 'durationS':
      return { text: formatClock(value), unit: spec.unit === 'min' ? 'min:s' : 's' }
    case 'weightKg':
      return { text: formatKg(value), unit: 'kg' }
    case 'distanceM':
      return spec.unit === 'km' && value >= 1000
        ? { text: formatKg(Math.round(value / 10) / 100), unit: 'km' }
        : { text: formatKg(value), unit: 'm' }
    default:
      return { text: String(value), unit: spec.unit }
  }
}

export function inputModeFor(quantity: QuantityKind) {
  return quantity.kind === 'count' ? 'numeric' : 'decimal'
}

// Cambia la unidad del número suelto (km ↔ m, min ↔ s) sin tocar lo escrito.
export function toggledUnit(quantity: QuantityKind): QuantityKind | null {
  if (quantity.kind === 'distance')
    return { kind: 'distance', bare: quantity.bare === 'km' ? 'm' : 'km' }
  if (quantity.kind === 'duration')
    return { kind: 'duration', bare: quantity.bare === 'min' ? 's' : 'min' }
  return null
}

// Botón que no quita el foco al campo (el teclado sigue abierto).
export function KeepFocusButton({
  onPress,
  children,
  label,
  className,
}: {
  onPress: () => void
  children: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={cn(
        'bg-secondary h-9 min-w-9 rounded-md px-2 text-sm font-semibold active:scale-95',
        className,
      )}
    >
      {children}
    </button>
  )
}

// Unidad con la que se empieza a editar: la que se ve en la celda.
function initialQuantity(spec: FieldSpec, value: number | null): QuantityKind {
  if (spec.field === 'distanceM' && spec.unit === 'km' && value !== null && value < 1000)
    return { kind: 'distance', bare: 'm' }
  return spec.quantity
}

// Muestra un valor; al tocarlo se convierte en un campo con teclado numérico, la unidad
// (que se puede cambiar) y la vista previa de lo interpretado («= 25 min 30 s»).
export function ValueCell({
  spec,
  value,
  onChange,
  onFocus,
  done,
}: {
  spec: FieldSpec
  value: number | null
  onChange: (value: number | null) => void
  onFocus?: () => void
  done?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [quantity, setQuantity] = useState<QuantityKind>(spec.quantity)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const parsed = draft.trim() === '' ? null : parseQuantity(draft, quantity)
  const invalid = draft.trim() !== '' && parsed === null
  const other = toggledUnit(quantity)
  const unitText =
    quantity.kind === 'duration' || quantity.kind === 'distance' ? quantity.bare : spec.unit

  function commit() {
    setEditing(false)
    if (draft.trim() === '') onChange(null)
    else if (parsed !== null && parsed !== value) onChange(parsed)
  }

  if (editing) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          aria-label={`${spec.label}`}
          aria-describedby={`${spec.field}-preview`}
          aria-invalid={invalid}
          autoFocus
          inputMode={inputModeFor(quantity)}
          enterKeyHint="done"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          className={cn(
            'bg-background h-12 w-full min-w-0 rounded-lg border-2 px-1 text-center text-xl font-semibold tabular-nums outline-none',
            invalid ? 'border-destructive' : 'border-primary',
          )}
        />
        <div className="bg-popover absolute top-full left-1/2 z-20 mt-1 flex w-44 -translate-x-1/2 flex-col gap-1.5 rounded-lg border p-2 shadow-lg">
          <p
            id={`${spec.field}-preview`}
            aria-live="polite"
            className={cn(
              'text-center text-xs',
              invalid ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {invalid
              ? quantityHint(quantity)
              : parsed !== null
                ? `= ${describeQuantity(parsed, quantity)}`
                : `En ${unitText}`}
          </p>
          <div className="flex justify-center gap-1">
            {quantity.kind === 'duration' && (
              <KeepFocusButton label="Escribir dos puntos" onPress={() => setDraft((d) => `${d}:`)}>
                :
              </KeepFocusButton>
            )}
            {other && (
              <KeepFocusButton
                label={`Unidad: ${unitText}. Cambiar a ${other.kind === 'duration' || other.kind === 'distance' ? other.bare : ''}`}
                onPress={() => setQuantity(other)}
                className="bg-primary/10 text-primary"
              >
                {unitText} ⇄
              </KeepFocusButton>
            )}
          </div>
        </div>
      </div>
    )
  }
  const shown = cellDisplay(spec, value)
  return (
    <button
      type="button"
      aria-label={`${spec.label}: ${shown.text} ${value === null ? '' : shown.unit}. Tocar para editar`}
      onClick={() => {
        onFocus?.()
        const start = initialQuantity(spec, value)
        setQuantity(start)
        setDraft(formatQuantityInput(value, start))
        setEditing(true)
      }}
      className={cn(
        'flex h-12 w-full min-w-0 flex-col items-center justify-center rounded-lg leading-none tabular-nums',
        done ? 'text-muted-foreground bg-transparent' : 'bg-muted',
        value === null && 'text-muted-foreground',
      )}
    >
      <span className="text-xl font-semibold">{shown.text}</span>
      <span className="text-muted-foreground mt-0.5 text-[10px] font-normal">
        {shown.unit}
        {spec.suffix ?? ''}
      </span>
    </button>
  )
}
