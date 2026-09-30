// Tarjeta de un bloque de varios días propuesto desde el chat (add_sessions_range, §11.5): lista
// cada día con su sesión, deja desmarcar días y añade las marcadas en una sola transacción
// (respond_chat_range, 0034). Los días que ya tienen una sesión planificada se avisan y salen sin
// marcar; si se marcan, se avisa otra vez antes de aplicar.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Check, ChevronDown, X } from 'lucide-react'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Button } from '@/components/ui/button'
import { refreshAfterChange, respondChatRange } from '@/lib/ai/client'
import { toPlanBlocks, type ChatRange, type ChatRangeResult } from '@/lib/ai/schemas'
import { errorMessage } from '@/lib/notify'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { useActivePlan } from '@/lib/plan/hooks'
import { WEEKDAY_LONG } from '@/lib/plan/profile'
import { formatDayMonth, isoWeekday, weekStartOf } from '@/lib/progress/dates'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import type { SessionType, Sex } from '@/types/database'

const dayLabel = (date: string) => `${WEEKDAY_LONG[isoWeekday(date) - 1]} ${formatDayMonth(date)}`

const sessionsText = (n: number) => (n === 1 ? '1 sesión' : `${n} sesiones`)

export function ChatRangeCard({
  userId,
  sex,
  name,
  chatInteractionId,
  index,
  range,
  result,
}: {
  userId: string
  sex: Sex | null
  name: (id: string) => string
  chatInteractionId: string
  index: number
  range: ChatRange
  result: ChatRangeResult | undefined
}) {
  const queryClient = useQueryClient()
  const plan = useActivePlan(userId)
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState<ChatRangeResult | null>(null)
  const current = local ?? result

  // Sesiones pendientes del plan por día (choques).
  const pending = new Map<string, string[]>()
  for (const s of plan.data?.sessions ?? []) {
    if (s.status !== 'planned' && s.status !== 'moved') continue
    pending.set(s.date, [...(pending.get(s.date) ?? []), s.title])
  }
  // Por defecto, marcados los días sin choque; `toggled` guarda lo que cambia el usuario.
  const isSelected = (date: string) => !pending.has(date) !== toggled.has(date)
  const selected = range.days.filter((d) => isSelected(d.date))
  const clashes = selected.filter((d) => pending.has(d.date))

  function toggle(date: string) {
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  async function respond(accept: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await respondChatRange({
        chatInteractionId,
        index,
        accept,
        ...(accept
          ? { dates: selected.map((d) => d.date), allowConflicts: clashes.length > 0 }
          : {}),
      })
      setLocal(res)
      await refreshAfterChange(queryClient, userId)
    } catch (e) {
      setError(
        `No se ha podido ${accept ? 'añadir las sesiones' : 'descartar'}: ${errorMessage(e)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const answered = current !== undefined

  return (
    <section
      aria-label={`Propuesta: ${range.title}`}
      className="border-primary/40 bg-primary/5 flex flex-col gap-2 rounded-xl border p-3"
    >
      <p className="text-primary text-xs font-medium uppercase">
        <span aria-hidden>🗓️ </span>Añadir sesiones · {range.days.length} días
      </p>
      <p className="font-semibold">{range.title}</p>
      <p className="text-sm">{range.reason}</p>

      <ul aria-label="Días propuestos" className="flex flex-col gap-1">
        {range.days.map((d) => {
          const clash = pending.get(d.date)
          const checked = isSelected(d.date)
          const id = `range-${chatInteractionId}-${index}-${d.date}`
          return (
            <li key={d.date} className="bg-background rounded-lg border p-2 text-sm">
              <div className="flex items-start gap-2">
                {!answered && (
                  <input
                    id={id}
                    type="checkbox"
                    className="accent-primary mt-1 size-5 shrink-0"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(d.date)}
                  />
                )}
                <label htmlFor={id} className="flex flex-1 flex-col">
                  <span className="font-medium">
                    {dayLabel(d.date)} ·{' '}
                    <span aria-hidden>
                      {sessionTypeEmoji((d.session.session_type ?? 'other') as SessionType)}{' '}
                    </span>
                    {d.session.title}
                  </span>
                  <span className="text-muted-foreground">
                    {d.session.duration_min} min · {INTENSITY_LABELS[d.session.intensity]}
                  </span>
                </label>
                <button
                  type="button"
                  className="text-primary -m-2 p-2"
                  aria-expanded={open === d.date}
                  aria-label={`Ver la sesión del ${dayLabel(d.date)}`}
                  onClick={() => setOpen((o) => (o === d.date ? null : d.date))}
                >
                  <ChevronDown className={open === d.date ? 'size-4 rotate-180' : 'size-4'} />
                </button>
              </div>
              {clash && !answered && (
                <p className="text-warning mt-1 flex gap-1 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Ya tienes «{clash.join('», «')}» ese día
                </p>
              )}
              {open === d.date && (
                <div className="mt-2">
                  <PlannedBlocks blocks={toPlanBlocks(d.session.blocks)} name={name} sex={sex} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {current?.status === 'accepted' ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            ✅ {sessionsText(current.created)} {current.created === 1 ? 'añadida' : 'añadidas'} al
            plan
            {current.dates.length > 0 &&
              ` · ${dayLabel(current.dates[0]!)}${
                current.dates.length > 1 ? ` → ${dayLabel(current.dates.at(-1)!)}` : ''
              }`}
          </p>
          {current.dates[0] && (
            <Link
              to="/plan"
              search={{ semana: weekStartOf(current.dates[0]) }}
              className="text-primary inline-flex items-center gap-1 font-medium underline"
            >
              <CalendarDays className="size-4" /> Ver en Plan
            </Link>
          )}
        </div>
      ) : current?.status === 'discarded' ? (
        <p className="text-muted-foreground text-sm">Descartado</p>
      ) : (
        <>
          {!plan.isLoading && !plan.data && (
            <p className="bg-muted rounded-lg p-2 text-sm">
              No tienes un plan activo: estas sesiones se añaden a un plan. Elige uno en Plan.
            </p>
          )}
          {clashes.length > 0 && (
            <p
              role="alert"
              className="flex gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm dark:bg-amber-950/30"
            >
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
              Vas a añadir una sesión en días que ya tienen otra planificada (
              {clashes.map((d) => dayLabel(d.date)).join(', ')}). No se quita la que ya tenías.
            </p>
          )}
          <Button disabled={busy || selected.length === 0} onClick={() => void respond(true)}>
            <Check />{' '}
            {busy
              ? 'Añadiendo…'
              : selected.length === 0
                ? 'Marca al menos un día'
                : `Añadir ${sessionsText(selected.length)}`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void respond(false)}>
            <X /> Descartar
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="bg-muted flex gap-2 rounded-lg p-2 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </section>
  )
}
