import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Check, ChevronDown, Undo2, X } from 'lucide-react'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Button } from '@/components/ui/button'
import { refreshAfterChange, respondChange, revertTodayAdjust } from '@/lib/ai/client'
import { CHANGE_LABELS, toPlanBlocks, type PlanChange } from '@/lib/ai/schemas'
import { errorMessage, notifyError, notifySaved } from '@/lib/notify'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { useActivePlan } from '@/lib/plan/hooks'
import { WEEKDAY_LONG } from '@/lib/plan/profile'
import { formatDayMonth, isoWeekday, weekStartOf } from '@/lib/progress/dates'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import type { Sex } from '@/types/database'

const DONE_TEXT = {
  modify: 'Sesión cambiada',
  move: 'Sesión movida',
  skip: 'Sesión cambiada por descanso',
  add: 'Sesión añadida al plan',
} as const

const dayLabel = (date: string) => `${WEEKDAY_LONG[isoWeekday(date) - 1]} ${formatDayMonth(date)}`

// Cambio del plan propuesto por la IA (revisión semanal o chat): solo se aplica al pulsar
// «Aceptar». Cambiar y descansar se pueden deshacer después.
export function ChangeCard({
  userId,
  interactionId,
  index,
  change,
  response,
  sex,
  name,
}: {
  userId: string
  interactionId: string
  index: number
  change: PlanChange
  response: 'accepted' | 'discarded' | undefined
  sex: Sex | null
  name: (id: string) => string
}) {
  const queryClient = useQueryClient()
  const plan = useActivePlan(userId)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  // Respuesta local mientras se refrescan los datos.
  const [local, setLocal] = useState<typeof response>(undefined)
  const [error, setError] = useState<string | null>(null)
  const state = response ?? local
  const label = CHANGE_LABELS[change.action]
  const target = change.planned_session_id
    ? plan.data?.sessions.find((s) => s.id === change.planned_session_id)
    : undefined

  async function respond(accept: boolean) {
    setBusy(true)
    setError(null)
    try {
      await respondChange(interactionId, index, accept)
      setLocal(accept ? 'accepted' : 'discarded')
      await refreshAfterChange(queryClient, userId)
    } catch (e) {
      setError(`No se ha podido ${accept ? 'aplicar' : 'descartar'} el cambio: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!target) return
    setBusy(true)
    try {
      await revertTodayAdjust(target.id)
      await refreshAfterChange(queryClient, userId)
      notifySaved('Cambio deshecho: vuelve la sesión original')
    } catch (error) {
      notifyError(error, 'deshacer el cambio')
    } finally {
      setBusy(false)
    }
  }

  // Día en el que queda la sesión (del plan ya refrescado desde la base de datos).
  const doneDate = change.action === 'move' || change.action === 'add' ? change.date : target?.date

  const where =
    change.action === 'add'
      ? change.date && dayLabel(change.date)
      : target
        ? `${sessionTypeEmoji(target.sessionType)} ${target.title} · ${dayLabel(target.date)}`
        : null

  return (
    <section
      aria-label={`Cambio propuesto: ${change.title}`}
      className="border-primary/40 bg-primary/5 flex flex-col gap-2 rounded-xl border p-3"
    >
      <p className="text-primary text-xs font-medium uppercase">
        <span aria-hidden>{label.emoji} </span>
        {label.label}
      </p>
      <p className="font-semibold">{change.title}</p>
      {where && <p className="text-muted-foreground text-sm">{where}</p>}
      {change.action === 'move' && change.date && (
        <p className="text-sm">
          → <span className="font-medium">{dayLabel(change.date)}</span>
        </p>
      )}
      <p className="text-sm">{change.reason}</p>
      {change.session && (
        <div>
          <button
            type="button"
            className="text-primary flex items-center gap-1 text-sm font-medium"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown className={open ? 'size-4 rotate-180' : 'size-4'} />
            {change.session.title} · {change.session.duration_min} min ·{' '}
            {INTENSITY_LABELS[change.session.intensity]}
          </button>
          {open && (
            <div className="mt-2">
              <PlannedBlocks blocks={toPlanBlocks(change.session.blocks)} name={name} sex={sex} />
            </div>
          )}
        </div>
      )}
      {state === 'accepted' ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 font-medium">
            ✅ {DONE_TEXT[change.action]}
            {doneDate ? ` · ${dayLabel(doneDate)}` : ''}
          </span>
          {doneDate && (
            <Link
              to="/plan"
              search={{ semana: weekStartOf(doneDate) }}
              className="text-primary inline-flex items-center gap-1 font-medium underline"
            >
              <CalendarDays className="size-4" /> Ver en Plan
            </Link>
          )}
          {(change.action === 'modify' || change.action === 'skip') && target?.adjusted && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void undo()}>
              <Undo2 /> Deshacer
            </Button>
          )}
        </div>
      ) : state === 'discarded' ? (
        <p className="text-muted-foreground text-sm">Descartado</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void respond(true)}>
            <Check /> Aceptar
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void respond(false)}>
            <X /> Descartar
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="bg-muted flex gap-2 rounded-lg p-2 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </section>
  )
}
