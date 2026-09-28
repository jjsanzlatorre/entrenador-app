import { useEffect, useRef, useState } from 'react'
import { formatClock, formatKg, parseClock, parseDecimal, parseInteger } from '@/lib/workout/format'
import type { SetField } from '@/lib/workout/fields'
import { cn } from '@/lib/utils'

function display(field: SetField, value: number | null) {
  if (value === null) return '—'
  if (field === 'durationS') return formatClock(value)
  if (field === 'weightKg') return formatKg(value)
  return String(value)
}

function toInput(field: SetField, value: number | null) {
  if (value === null) return ''
  if (field === 'durationS') return formatClock(value)
  return field === 'weightKg' ? formatKg(value) : String(value)
}

function parse(field: SetField, input: string) {
  if (field === 'durationS') return parseClock(input)
  if (field === 'weightKg' || field === 'distanceM') return parseDecimal(input)
  return parseInteger(input)
}

// Muestra un valor; al tocarlo se convierte en un campo con teclado numérico.
export function ValueCell({
  field,
  value,
  onChange,
  onFocus,
  done,
  label,
}: {
  field: SetField
  value: number | null
  onChange: (value: number | null) => void
  onFocus?: () => void
  done?: boolean
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    setEditing(false)
    const parsed = parse(field, draft)
    if (draft.trim() === '') onChange(null)
    else if (parsed !== null && parsed !== value) onChange(parsed)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        autoFocus
        inputMode={field === 'durationS' ? 'numeric' : field === 'weightKg' ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="border-primary bg-background h-12 w-full min-w-0 rounded-lg border-2 px-1 text-center text-xl font-semibold tabular-nums outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`${label}: ${display(field, value)}. Tocar para editar`}
      onClick={() => {
        onFocus?.()
        setDraft(toInput(field, value))
        setEditing(true)
      }}
      className={cn(
        'h-12 w-full min-w-0 rounded-lg text-center text-xl font-semibold tabular-nums',
        done ? 'text-muted-foreground bg-transparent' : 'bg-muted',
        value === null && 'text-muted-foreground',
      )}
    >
      {display(field, value)}
    </button>
  )
}
