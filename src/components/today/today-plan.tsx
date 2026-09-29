import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, Play, SkipForward } from 'lucide-react'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Button } from '@/components/ui/button'
import { notifyError, notifySaved } from '@/lib/notify'
import { skipPlanned } from '@/lib/plan/api'
import { overdueThisWeek, weekView, type PlannedView } from '@/lib/plan/calendar'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { refreshPlan, useActivePlan, useTrainingProfile } from '@/lib/plan/hooks'
import { WEEKDAY_LONG } from '@/lib/plan/profile'
import { useStartPlanned } from '@/lib/plan/start'
import { formatDayMonth, isoWeekday, weekStartOf, type DateKey } from '@/lib/progress/dates'
import { useSessionLog } from '@/lib/progress/hooks'
import { useCatalog } from '@/lib/workout/hooks'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import type { Sex } from '@/types/database'

// «Hoy»: la sesión planificada del día con «Empezar planificada» y las pendientes de días
// anteriores de esta semana (hacerlas ahora o saltarlas).
export function TodayPlan({
  userId,
  today,
  sex,
  canStart,
}: {
  userId: string
  today: DateKey
  sex: Sex | null
  // Con una sesión en curso no se puede empezar otra.
  canStart: boolean
}) {
  const plan = useActivePlan(userId)
  const log = useSessionLog(userId)
  const training = useTrainingProfile(userId)
  const starter = useStartPlanned(userId)
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const [open, setOpen] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<string | null>(null)

  if (!plan.data) {
    if (plan.isSuccess && training.data)
      return (
        <Link to="/plan/elegir" className="text-primary text-center text-sm underline">
          Aún no tienes plan: elegir uno
        </Link>
      )
    return null
  }

  const days = weekView(
    plan.data.sessions,
    log.data?.sessions ?? [],
    weekStartOf(today),
    training.data?.fixedActivities ?? [],
  )
  const todays = days.find((d) => d.date === today)?.planned ?? []
  const overdue = overdueThisWeek(days, today)
  const name = (id: string) => catalog.byId.get(id)?.name ?? id

  async function skip(p: PlannedView) {
    setSkipping(p.id)
    try {
      await skipPlanned(p.id)
      await refreshPlan(queryClient, userId)
      notifySaved('Sesión saltada')
    } catch (error) {
      notifyError(error, 'saltar la sesión')
    } finally {
      setSkipping(null)
    }
  }

  return (
    <section aria-label="Plan de hoy" className="flex flex-col gap-3">
      {todays.length === 0 && (
        <p className="text-muted-foreground flex items-center gap-2 rounded-xl border p-3 text-sm">
          <CalendarDays className="size-5 shrink-0" />
          Hoy no tienes sesión en el plan: descanso o entreno libre.
        </p>
      )}
      {todays.map((p) => {
        const pending = p.effectiveStatus === 'planned' || p.effectiveStatus === 'moved'
        return (
          <div key={p.id} className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-xs">
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-3xl">
                {sessionTypeEmoji(p.sessionType)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  Hoy en tu plan · semana {p.week}
                </p>
                <p className="text-lg leading-tight font-bold">{p.title}</p>
                <p className="text-muted-foreground text-sm">
                  {p.durationMin ? `${p.durationMin} min · ` : ''}
                  {INTENSITY_LABELS[p.intensity]}
                </p>
              </div>
              {p.effectiveStatus === 'done' && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                  <Check className="mr-0.5 inline size-3" />
                  Hecha
                </span>
              )}
              {p.effectiveStatus === 'skipped' && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  Saltada
                </span>
              )}
            </div>
            {open === p.id && <PlannedBlocks blocks={p.blocks} name={name} sex={sex} />}
            {pending && (
              <div className="flex flex-col gap-2">
                {canStart && (
                  <Button
                    size="lg"
                    className="h-14 text-lg"
                    disabled={starter.busy}
                    onClick={() => void starter.start(p)}
                  >
                    <Play className="size-5" /> Empezar planificada
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen((o) => (o === p.id ? null : p.id))}
                >
                  {open === p.id ? 'Ocultar detalle' : 'Ver qué toca'}
                </Button>
              </div>
            )}
          </div>
        )
      })}

      {overdue.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          <p className="text-sm font-semibold">
            {overdue.length === 1
              ? 'Te quedó una sesión de esta semana'
              : `Te quedaron ${overdue.length} sesiones de esta semana`}
          </p>
          {overdue.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">
                <span aria-hidden>{sessionTypeEmoji(p.sessionType)} </span>
                <span className="font-medium">{p.title}</span>{' '}
                <span className="text-muted-foreground">
                  ({WEEKDAY_LONG[isoWeekday(p.date) - 1]} {formatDayMonth(p.date)})
                </span>
              </span>
              <div className="flex gap-2">
                {canStart && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={starter.busy}
                    onClick={() => void starter.start(p)}
                  >
                    <Play /> Hacer ahora
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={skipping === p.id}
                  onClick={() => void skip(p)}
                >
                  <SkipForward /> Saltar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
