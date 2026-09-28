import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { EQUIPMENT_LABELS, MUSCLES } from '@/lib/workout/labels'
import { cn } from '@/lib/utils'

export type FilterState = { query: string; muscleId: string | null; equipment: string | null }

export const EMPTY_FILTER: FilterState = { query: '', muscleId: null, equipment: null }

// Buscador + filtro por músculo (chips) y por material (select).
export function ExerciseFilters({
  value,
  onChange,
  autoFocus,
}: {
  value: FilterState
  onChange: (value: FilterState) => void
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Buscar ejercicio"
          aria-label="Buscar ejercicio"
          autoFocus={autoFocus}
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
          className="h-12 pl-10 text-base"
        />
      </div>
      <div
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label="Filtrar por músculo"
      >
        <Chip
          active={value.muscleId === null}
          onClick={() => onChange({ ...value, muscleId: null })}
        >
          Todos
        </Chip>
        {MUSCLES.map((m) => (
          <Chip
            key={m.id}
            active={value.muscleId === m.id}
            onClick={() => onChange({ ...value, muscleId: value.muscleId === m.id ? null : m.id })}
          >
            {m.name}
          </Chip>
        ))}
      </div>
      <select
        aria-label="Filtrar por material"
        value={value.equipment ?? ''}
        onChange={(e) => onChange({ ...value, equipment: e.target.value || null })}
        className="border-input bg-background h-11 rounded-md border px-3 text-sm"
      >
        <option value="">Cualquier material</option>
        {Object.entries(EQUIPMENT_LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap',
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background',
      )}
    >
      {children}
    </button>
  )
}
