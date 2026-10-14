import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeepFocusButton, inputModeFor, toggledUnit } from '@/components/workout/value-cell'
import {
  describeQuantity,
  parseCount,
  parseDuration,
  formatQuantityInput,
  parseQuantity,
  quantityHint,
  quantityUnit,
  stepQuantity,
  type QuantityKind,
} from '@/lib/input/quantity'
import { cn } from '@/lib/utils'

const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

// Campo de tiempo, distancia, peso o número con el parser único (src/lib/input/quantity.ts):
// teclado numérico, unidad siempre visible, vista previa («= 25 min 30 s»), botones ± y
// chips rápidos. El valor se guarda como texto; quien lo usa lo interpreta con
// `parseQuantity(value, quantity)`.
export function QuantityInput({
  id,
  label,
  value,
  onChange,
  quantity,
  onQuantityChange,
  steps,
  chips,
  placeholder,
  hidePreview,
  className,
  inputClassName,
}: {
  id: string
  label: React.ReactNode
  value: string
  onChange: (value: string) => void
  quantity: QuantityKind
  // Si se pasa, la unidad se puede cambiar (km ↔ m, min ↔ s) tocándola.
  onQuantityChange?: (quantity: QuantityKind) => void
  // Botones ± en la unidad del campo (p. ej. [1, 5]).
  steps?: number[]
  // Valores rápidos en la unidad del campo (p. ej. [15, 30, 45, 60]).
  chips?: number[]
  placeholder?: string
  hidePreview?: boolean
  className?: string
  inputClassName?: string
}) {
  const parsed = value.trim() === '' ? null : parseQuantity(value, quantity)
  const invalid = value.trim() !== '' && parsed === null
  const unit = quantityUnit(quantity)
  const other = onQuantityChange ? toggledUnit(quantity) : null
  const set = (n: number) => onChange(formatQuantityInput(n, quantity))
  const factor =
    quantity.kind === 'duration' && quantity.bare === 'min'
      ? 60
      : quantity.kind === 'distance' && quantity.bare === 'km'
        ? 1000
        : 1
  const previewId = `${id}-preview`

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode={inputModeFor(quantity)}
          enterKeyHint="done"
          autoComplete="off"
          placeholder={placeholder}
          aria-describedby={hidePreview ? undefined : previewId}
          aria-invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('h-12 min-w-0 text-lg', invalid && 'border-destructive', inputClassName)}
        />
        {quantity.kind === 'duration' && (
          <KeepFocusButton
            label="Escribir dos puntos"
            onPress={() => onChange(`${value}:`)}
            className="h-12 w-9 text-lg"
          >
            :
          </KeepFocusButton>
        )}
        {other ? (
          <KeepFocusButton
            label={`Unidad: ${unit}. Cambiar`}
            onPress={() => onQuantityChange?.(other)}
            className="bg-primary/10 text-primary h-12 shrink-0"
          >
            {unit} ⇄
          </KeepFocusButton>
        ) : (
          unit && <span className="text-muted-foreground shrink-0 text-sm">{unit}</span>
        )}
      </div>
      {!hidePreview && (
        <p
          id={previewId}
          aria-live="polite"
          className={cn('min-h-4 text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
        >
          {invalid
            ? quantityHint(quantity)
            : parsed !== null
              ? `= ${describeQuantity(parsed, quantity)}`
              : ''}
        </p>
      )}
      {steps && steps.length > 0 && (
        <div className="flex gap-1">
          {[...steps].reverse().map((step) => (
            <StepButton
              key={`-${step}`}
              step={-step}
              unit={unit}
              onPress={() => set(stepQuantity(parsed, -step, quantity))}
            />
          ))}
          {steps.map((step) => (
            <StepButton
              key={`+${step}`}
              step={step}
              unit={unit}
              onPress={() => set(stepQuantity(parsed, step, quantity))}
            />
          ))}
        </div>
      )}
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Valores rápidos">
          {chips.map((chip) => {
            const chipValue = chip * factor
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={parsed === chipValue}
                onClick={() => set(chipValue)}
                className={cn(
                  'h-9 rounded-full border px-3 text-sm',
                  parsed === chipValue
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background',
                )}
              >
                {decimal.format(chip)} {unit}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StepButton({ step, unit, onPress }: { step: number; unit: string; onPress: () => void }) {
  const text = decimal.format(Math.abs(step))
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={`${step > 0 ? 'Más' : 'Menos'} ${text} ${unit}`}
      className="bg-secondary flex h-10 flex-1 items-center justify-center gap-0.5 rounded-lg text-sm font-semibold active:scale-95"
    >
      {step > 0 ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
      {text}
    </button>
  )
}

// Duración de una sesión o actividad: número suelto = minutos («25»), «25:30», «1h05»…
// Se guarda en minutos enteros (redondeando los segundos).
export function DurationField({
  id,
  value,
  onChange,
  chips = [15, 30, 45, 60, 90],
}: {
  id: string
  value: string
  onChange: (value: string) => void
  chips?: number[]
}) {
  const seconds = parseDuration(value, 'min')
  return (
    <div className="flex flex-col gap-1">
      <QuantityInput
        id={id}
        label="Duración"
        value={value}
        onChange={onChange}
        quantity={{ kind: 'duration', bare: 'min' }}
        steps={[1, 5]}
        chips={chips}
      />
      {seconds !== null && seconds % 60 !== 0 && (
        <p className="text-muted-foreground text-xs">
          Se guarda como {Math.round(seconds / 60)} min.
        </p>
      )}
    </div>
  )
}

// Datos del reloj: enteros con su unidad.
export function WatchField({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
}) {
  const invalid = value.trim() !== '' && parseCount(value) === null
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label} <span className="text-muted-foreground">({unit})</span>
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        aria-invalid={invalid}
        className={cn(invalid && 'border-destructive')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
