import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CloudOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CHECKIN_FIELDS,
  CHECKIN_LABELS,
  checkinQueryKey,
  dismissCheckin,
  isComplete,
  saveCheckin,
  useCheckin,
  type Checkin,
  type CheckinField,
} from '@/lib/checkin'
import { notifyError } from '@/lib/notify'
import type { DateKey } from '@/lib/progress/dates'
import { cn } from '@/lib/utils'

type Draft = Record<CheckinField, number | null>

const EMPTY: Draft = { sleep: null, energy: null, soreness: null, stress: null }

// Check-in diario opcional (≤ 10 s): 4 filas de 1 a 5; se guarda solo al tocar la cuarta.
export function CheckinCard({ userId, today }: { userId: string; today: DateKey }) {
  const queryClient = useQueryClient()
  const query = useCheckin(userId, today)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  if (!query.data) return null
  const saved = query.data.checkin
  const values: Draft = draft ?? (saved ? pick(saved) : EMPTY)

  async function persist(next: Draft) {
    try {
      await saveCheckin(userId, { date: today, ...next } as Checkin)
      await queryClient.invalidateQueries({ queryKey: checkinQueryKey(userId, today) })
      setEditing(false)
      setDraft(null)
    } catch (error) {
      notifyError(error, 'guardar el check-in')
    }
  }

  function choose(field: CheckinField, value: number) {
    const next = { ...values, [field]: value }
    setDraft(next)
    if (isComplete(next)) void persist(next)
  }

  if (saved && isComplete(saved) && !editing) {
    return (
      <section
        aria-label="Check-in de hoy"
        className="flex items-center gap-3 rounded-xl border p-3 text-sm"
      >
        <Check className="size-5 shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Check-in: </span>
          {CHECKIN_FIELDS.map((f) => `${CHECKIN_LABELS[f].label} ${saved[f]}`).join(' · ')}
          {saved.pending && (
            <span className="text-muted-foreground block text-xs">
              <CloudOff className="mr-1 inline size-3" />
              Guardado en el móvil; se subirá al recuperar la conexión
            </span>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Cambiar
        </Button>
      </section>
    )
  }

  if (query.data.dismissed && !editing && !draft) return null

  return (
    <section aria-label="Check-in de hoy" className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">¿Cómo estás hoy?</p>
          <p className="text-muted-foreground text-xs">Opcional · 4 toques</p>
        </div>
        {!saved && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={async () => {
              await dismissCheckin(userId, today)
              await queryClient.invalidateQueries({ queryKey: checkinQueryKey(userId, today) })
            }}
          >
            <X /> Ahora no
          </Button>
        )}
      </div>
      {CHECKIN_FIELDS.map((f) => (
        <div key={f} role="group" aria-label={CHECKIN_LABELS[f].label}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{CHECKIN_LABELS[f].label}</span>
            <span className="text-muted-foreground text-xs">
              1 {CHECKIN_LABELS[f].low} · 5 {CHECKIN_LABELS[f].high}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={values[f] === n}
                aria-label={`${CHECKIN_LABELS[f].label} ${n}`}
                onClick={() => choose(f, n)}
                className={cn(
                  'h-11 rounded-lg border text-base font-semibold active:scale-95',
                  values[f] === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-card',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function pick(c: Checkin): Draft {
  return { sleep: c.sleep, energy: c.energy, soreness: c.soreness, stress: c.stress }
}
