import { useState } from 'react'
import { Tip } from '@/components/help/tip'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  GripVertical,
  History,
  MessageCircle,
  MoreHorizontal,
  MoveRight,
  PauseCircle,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { useAiStatus } from '@/lib/ai/client'
import { z } from 'zod'
import { MoveSheet } from '@/components/plan/move-sheet'
import { PlanMenu } from '@/components/plan/plan-menu'
import { PlanAdherenceBar } from '@/components/plan/plan-adherence'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Page } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet } from '@/components/ui/sheet'
import { notifyError, notifySaved } from '@/lib/notify'
import { restorePlanned, setPlannedDone, skipPlanned } from '@/lib/plan/api'
import {
  planAdherence,
  planWeekNumber,
  weekSummary,
  weekView,
  type PlannedView,
} from '@/lib/plan/calendar'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { refreshPlan, useActivePlan, useTrainingProfile } from '@/lib/plan/hooks'
import { moveWarnings } from '@/lib/plan/move-rules'
import { WEEKDAY_LONG } from '@/lib/plan/profile'
import { isPendingPlanned, moveSession, pauseOn, planWeekForRange } from '@/lib/plan/reschedule'
import { useLongPressDrag } from '@/lib/plan/use-long-press-drag'
import { usePlanChange } from '@/lib/plan/use-plan-change'
import { useStartPlanned } from '@/lib/plan/start'
import { PlannedPairButton } from '@/components/partners/pair'
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  isoWeekday,
  localDateKey,
  weekStartOf,
} from '@/lib/progress/dates'
import { sessionLogKey, useSessionLog } from '@/lib/progress/hooks'
import type { SessionLogEntry } from '@/lib/progress/types'
import { formatTime } from '@/lib/workout/format'
import { useCatalog } from '@/lib/workout/hooks'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { activityEmoji, activityLabel } from '@/lib/activities/catalog'
import type { Sex } from '@/types/database'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/plan/')({
  ssr: false,
  validateSearch: z.object({
    semana: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  component: PlanPage,
})

const fixedLabel = (type: string) => `${activityEmoji(type)} ${activityLabel(type)}`

const STATUS: Record<PlannedView['effectiveStatus'], { label: string; className: string }> = {
  planned: { label: 'Pendiente', className: 'bg-muted text-foreground' },
  moved: {
    label: 'Movida',
    className: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  },
  done: {
    label: 'Hecha',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  },
  skipped: { label: 'Saltada', className: 'bg-muted text-muted-foreground line-through' },
}

function PlanPage() {
  const { auth } = Route.useRouteContext()
  const { semana } = Route.useSearch()
  const navigate = useNavigate()
  const plan = useActivePlan(auth.userId)
  const log = useSessionLog(auth.userId)
  const training = useTrainingProfile(auth.userId)
  const today = localDateKey(new Date())
  const weekStart = weekStartOf(semana ?? today)
  const [open, setOpen] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const ai = useAiStatus()
  const changer = usePlanChange(auth.userId)
  const fixedActivities = training.data?.fixedActivities ?? []

  // Mantener pulsada una sesión pendiente y soltarla en otro día.
  const { drag, bind } = useLongPressDrag((id, date) => {
    const active = plan.data
    const session = active?.sessions.find((s) => s.id === id)
    if (!active || !session || session.date === date || changer.busy) return
    void changer.apply(
      active.id,
      moveSession(session, date),
      `«${session.title}» movida al ${WEEKDAY_LONG[isoWeekday(date) - 1]} ${formatDayMonth(date)}`,
      moveWarnings(session, date, active.sessions, fixedActivities),
    )
  })

  const setWeek = (w: string) =>
    void navigate({
      to: '/plan',
      search: { semana: w === weekStartOf(today) ? undefined : w },
      replace: true,
    })

  if (plan.isPending) {
    return (
      <Page title="Plan">
        <p className="text-muted-foreground text-center">Cargando…</p>
      </Page>
    )
  }
  if (plan.isError) {
    return (
      <Page title="Plan">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CloudOff className="size-4" /> No se ha podido cargar el plan: {plan.error.message}
        </p>
      </Page>
    )
  }
  if (!plan.data) {
    return (
      <Page title="Plan">
        <Card>
          <CardHeader>
            <CardTitle>Aún no tienes plan</CardTitle>
            <CardDescription>
              Elige un plan de 4 semanas (carrera, natación, fuerza, HYROX, DEKA o híbrido) y lo
              repartimos en tus días.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild size="lg">
              <Link to="/plan/elegir">Elegir plan</Link>
            </Button>
            {training.isSuccess && training.data === null && (
              <Button asChild variant="outline" size="lg">
                <Link to="/onboarding">Completar mi perfil primero</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </Page>
    )
  }

  const days = weekView(
    plan.data.sessions,
    log.data?.sessions ?? [],
    weekStart,
    training.data?.fixedActivities ?? [],
  )
  const summary = weekSummary(days)
  const pauses = plan.data.pauses ?? []
  const planWeek =
    planWeekForRange(plan.data.sessions, weekStart) ??
    (pauses.length === 0 ? planWeekNumber(plan.data.startDate, weekStart) : null)
  const weekPaused = days.some((d) => pauseOn(pauses, d.date))
  const adherence = planAdherence(plan.data.sessions, log.data?.sessions ?? [], today)
  const selected = days.flatMap((d) => d.planned).find((p) => p.id === open) ?? null
  const extraSameDay = selected ? (days.find((d) => d.date === selected.date)?.extra ?? []) : []
  const movingSession = plan.data.sessions.find((p) => p.id === moving) ?? null

  return (
    <Page title="Plan">
      <Tip id="plan" title="Tu semana planificada">
        Toca una sesión para empezarla, moverla o saltarla; mantén pulsada y arrástrala a otro día.
        En ⋯ «Opciones del plan» puedes pausar o desplazar todo el plan.
      </Tip>
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{plan.data.name}</CardTitle>
          <CardDescription>
            Desde el {formatDayMonth(plan.data.startDate)} ·{' '}
            {planWeek
              ? `semana ${planWeek} de 4${planWeek === 4 ? ' (descarga)' : ''}`
              : weekPaused
                ? 'en pausa'
                : 'fuera del plan'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PlanAdherenceBar adherence={adherence} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMenuOpen(true)}>
              <MoreHorizontal /> Opciones del plan
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Mantén pulsada una sesión y arrástrala a otro día, o tócala y pulsa «Mover».
          </p>
          {ai.data?.configured && (
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link to="/plan/revision">
                  <Sparkles /> Revisión semanal
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link to="/entrenador">
                  <MessageCircle /> Preguntar
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Semana anterior"
          onClick={() => setWeek(addDays(weekStart, -7))}
        >
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <p className="font-semibold first-letter:uppercase">{formatWeekRange(weekStart)}</p>
          <p className="text-muted-foreground text-xs">
            {summary.planned > 0
              ? `${summary.done} de ${summary.planned} hechas${summary.extra ? ` · +${summary.extra} fuera del plan` : ''}`
              : 'Sin sesiones planificadas'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Semana siguiente"
          onClick={() => setWeek(addDays(weekStart, 7))}
        >
          <ChevronRight />
        </Button>
      </div>

      <ol className="flex flex-col gap-2">
        {days.map((day) => (
          <li
            key={day.date}
            data-drop-date={day.date}
            aria-label={`${WEEKDAY_LONG[day.weekday - 1]} ${formatDayMonth(day.date)}`}
            className={cn(
              'rounded-xl border p-3 transition-colors',
              day.date === today && 'border-primary',
              day.date < today && 'opacity-90',
              drag && 'border-dashed',
              drag?.overDate === day.date && 'border-primary bg-primary/10 border-2 border-solid',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                <span className="inline-block first-letter:uppercase">
                  {WEEKDAY_LONG[day.weekday - 1]}
                </span>{' '}
                <span className="text-muted-foreground font-normal">
                  {formatDayMonth(day.date)}
                </span>
                {day.date === today && <Badge className="ml-2">Hoy</Badge>}
              </p>
              <span className="flex flex-wrap justify-end gap-1">
                {day.fixed.map((f) => (
                  <span key={f.type} className="bg-muted rounded-full px-2 py-0.5 text-xs">
                    {fixedLabel(f.type)}
                  </span>
                ))}
              </span>
            </div>
            {pauseOn(pauses, day.date) ? (
              <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
                <PauseCircle className="size-4" /> Plan en pausa
              </p>
            ) : (
              day.planned.length === 0 &&
              day.extra.length === 0 && (
                <p className="text-muted-foreground mt-1 text-sm">Descanso</p>
              )
            )}
            <ul className="mt-2 flex flex-col gap-2">
              {day.planned.map((p) => {
                const draggable =
                  isPendingPlanned(p) && p.effectiveStatus !== 'done' && !changer.busy
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(p.id)}
                      {...(draggable ? bind(p.id, p.title) : {})}
                      data-planned-id={p.id}
                      className={cn(
                        'bg-card hover:bg-accent flex w-full items-center gap-3 rounded-lg border p-3 text-left select-none [-webkit-touch-callout:none]',
                        drag?.id === p.id && 'opacity-40',
                      )}
                    >
                      <span aria-hidden className="text-xl">
                        {sessionTypeEmoji(p.sessionType)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate font-medium',
                            p.effectiveStatus === 'skipped' && 'text-muted-foreground line-through',
                          )}
                        >
                          {p.title}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {p.durationMin ? `${p.durationMin} min · ` : ''}
                          {INTENSITY_LABELS[p.intensity]}
                          {p.effectiveStatus === 'moved' && p.originalDate
                            ? ` · era el ${formatDayMonth(p.originalDate)}`
                            : ''}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS[p.effectiveStatus].className,
                        )}
                      >
                        {p.effectiveStatus === 'done' && <Check className="mr-0.5 inline size-3" />}
                        {STATUS[p.effectiveStatus].label}
                      </span>
                      {draggable && (
                        <GripVertical aria-hidden className="text-muted-foreground -mr-1 size-4" />
                      )}
                    </button>
                  </li>
                )
              })}
              {day.extra.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/entrenar/historial/$sessionId"
                    params={{ sessionId: s.id }}
                    className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm"
                  >
                    <span aria-hidden className="text-xl">
                      {sessionTypeEmoji(s.sessionType)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{sessionTypeLabel(s.sessionType)}</span>
                      <span className="text-muted-foreground block text-xs">
                        Hecha fuera del plan · {formatTime(s.startedAt)}
                        {s.durationMin ? ` · ${s.durationMin} min` : ''}
                      </span>
                    </span>
                    <Check className="text-success size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {drag && (
        <div
          aria-hidden
          className="bg-card border-primary pointer-events-none fixed z-50 max-w-[70vw] -translate-x-1/2 -translate-y-1/2 truncate rounded-lg border-2 px-3 py-2 text-sm font-semibold shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
          {drag.overDate && (
            <span className="text-primary block text-xs font-normal">
              → {WEEKDAY_LONG[isoWeekday(drag.overDate) - 1]} {formatDayMonth(drag.overDate)}
            </span>
          )}
        </div>
      )}

      <PlannedSheet
        planned={selected}
        userId={auth.userId}
        candidates={extraSameDay}
        sex={auth.profile.sex}
        today={today}
        onMove={(id) => {
          setOpen(null)
          setMoving(id)
        }}
        onClose={() => setOpen(null)}
      />
      <MoveSheet
        session={movingSession}
        planId={plan.data.id}
        sessions={plan.data.sessions}
        fixed={fixedActivities}
        today={today}
        userId={auth.userId}
        onClose={() => setMoving(null)}
      />
      <PlanMenu
        open={menuOpen}
        plan={plan.data}
        userId={auth.userId}
        weekStart={weekStart}
        today={today}
        onClose={() => setMenuOpen(false)}
      />
    </Page>
  )
}

function PlannedSheet({
  planned,
  userId,
  candidates,
  sex,
  today,
  onMove,
  onClose,
}: {
  planned: PlannedView | null
  userId: string
  candidates: SessionLogEntry[]
  sex: Sex | null
  today: string
  onMove: (id: string) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const starter = useStartPlanned(userId)
  const [working, setWorking] = useState(false)
  const busy = working || starter.busy
  const [linking, setLinking] = useState(false)
  const name = (id: string) => catalog.byId.get(id)?.name ?? id

  async function run(action: () => Promise<unknown>, success: string, what: string) {
    setWorking(true)
    try {
      await action()
      await refreshPlan(queryClient, userId)
      await queryClient.invalidateQueries({ queryKey: sessionLogKey(userId) })
      notifySaved(success)
      setLinking(false)
      onClose()
    } catch (error) {
      notifyError(error, what)
    } finally {
      setWorking(false)
    }
  }

  const pending = planned?.effectiveStatus === 'planned' || planned?.effectiveStatus === 'moved'
  // Día pasado sin hacer: «Registrar como hecha» (entreno pasado con la estructura del plan).
  const overdue = pending && planned !== null && planned.date < today

  return (
    <Sheet
      open={planned !== null}
      onClose={() => {
        setLinking(false)
        onClose()
      }}
      title={planned ? `${sessionTypeEmoji(planned.sessionType)} ${planned.title}` : ''}
    >
      {planned && (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-muted-foreground text-sm">
            <span className="inline-block first-letter:uppercase">
              {WEEKDAY_LONG[(new Date(`${planned.date}T00:00:00Z`).getUTCDay() + 6) % 7]}
            </span>{' '}
            {formatDayMonth(planned.date)} · semana {planned.week}
            {planned.durationMin ? ` · ${planned.durationMin} min` : ''} ·{' '}
            {INTENSITY_LABELS[planned.intensity]} · {STATUS[planned.effectiveStatus].label}
          </p>

          <PlannedBlocks blocks={planned.blocks} name={name} sex={sex} />
          {planned.notes && <p className="text-muted-foreground text-sm">{planned.notes}</p>}

          {pending && (
            <div className="flex flex-col gap-2">
              {overdue && (
                <Button size="lg" disabled={busy} onClick={() => void starter.logPast(planned)}>
                  <History /> Registrar como hecha
                </Button>
              )}
              <Button
                size="lg"
                variant={overdue ? 'outline' : 'default'}
                disabled={busy}
                onClick={() => void starter.start(planned)}
              >
                <Play /> Empezar ahora
              </Button>
              <PlannedPairButton userId={userId} planned={planned} disabled={busy} />
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setLinking((v) => !v)}>
                  <Check /> Hecha
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => onMove(planned.id)}>
                  <MoveRight /> Mover
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => skipPlanned(planned.id), 'Sesión saltada', 'saltar la sesión')
                  }
                >
                  <SkipForward /> Saltar
                </Button>
              </div>
            </div>
          )}

          {linking && pending && (
            <div className="flex flex-col gap-2 rounded-xl border p-3">
              <p className="text-sm font-semibold">¿Con qué sesión la hiciste?</p>
              {candidates.map((s) => (
                <Button
                  key={s.id}
                  variant="outline"
                  className="justify-start"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => setPlannedDone(planned.id, true, s.id),
                      'Marcada como hecha y enlazada',
                      'marcar como hecha',
                    )
                  }
                >
                  {sessionTypeEmoji(s.sessionType)} {sessionTypeLabel(s.sessionType)} ·{' '}
                  {formatTime(s.startedAt)}
                  {s.durationMin ? ` · ${s.durationMin} min` : ''}
                </Button>
              ))}
              <Button
                variant="outline"
                className="justify-start"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => setPlannedDone(planned.id, true, null),
                    'Marcada como hecha',
                    'marcar como hecha',
                  )
                }
              >
                Hecha, sin registrar la sesión
              </Button>
              {candidates.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No hay sesiones registradas ese día sin enlazar.
                </p>
              )}
            </div>
          )}

          {planned.effectiveStatus === 'done' && (
            <div className="flex flex-col gap-2">
              {planned.linkedSessionId && (
                <Button asChild variant="outline" size="lg">
                  <Link
                    to="/entrenar/historial/$sessionId"
                    params={{ sessionId: planned.linkedSessionId }}
                  >
                    Ver la sesión registrada
                  </Link>
                </Button>
              )}
              {planned.status === 'done' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => setPlannedDone(planned.id, false),
                      'Vuelve a estar pendiente',
                      'deshacer',
                    )
                  }
                >
                  <RotateCcw /> Deshacer «hecha»
                </Button>
              )}
              {planned.status !== 'done' && (
                <p className="text-muted-foreground text-xs">
                  La sesión se subirá al recuperar la conexión y quedará enlazada.
                </p>
              )}
            </div>
          )}

          {planned.effectiveStatus === 'skipped' && (
            <Button
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={() =>
                void run(() => restorePlanned(planned), 'Vuelve a estar pendiente', 'deshacer')
              }
            >
              <RotateCcw /> Deshacer «saltada»
            </Button>
          )}
        </div>
      )}
    </Sheet>
  )
}
