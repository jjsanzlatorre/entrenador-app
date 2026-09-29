import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  MessageCircle,
  MoveRight,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import { useAiStatus } from '@/lib/ai/client'
import { z } from 'zod'
import { Chip } from '@/components/plan/chip'
import { PlanAdherenceBar } from '@/components/plan/plan-adherence'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Page } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import {
  archivePlan,
  movePlanned,
  restorePlanned,
  setPlannedDone,
  skipPlanned,
  type ActivePlan,
  type PlannedSession,
} from '@/lib/plan/api'
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
import { WEEKDAY_LONG, WEEKDAY_SHORT, type FixedActivity } from '@/lib/plan/profile'
import { useStartPlanned } from '@/lib/plan/start'
import { PlannedPairButton } from '@/components/partners/pair'
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  localDateKey,
  weekStartOf,
} from '@/lib/progress/dates'
import { sessionLogKey, useSessionLog } from '@/lib/progress/hooks'
import type { SessionLogEntry } from '@/lib/progress/types'
import { formatTime } from '@/lib/workout/format'
import { useCatalog } from '@/lib/workout/hooks'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
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

const FIXED_EMOJI: Record<string, string> = {
  padel_fronton: '🎾 Frontón',
  surf: '🏄 Surf',
  yoga: '🧘 Yoga',
  other: '⚡ Actividad',
}

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
  const ai = useAiStatus()

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
  const planWeek = planWeekNumber(plan.data.startDate, weekStart)
  const adherence = planAdherence(plan.data.sessions, log.data?.sessions ?? [], today)
  const selected = days.flatMap((d) => d.planned).find((p) => p.id === open) ?? null
  const extraSameDay = selected ? (days.find((d) => d.date === selected.date)?.extra ?? []) : []

  return (
    <Page title="Plan">
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{plan.data.name}</CardTitle>
          <CardDescription>
            Desde el {formatDayMonth(plan.data.startDate)} ·{' '}
            {planWeek
              ? `semana ${planWeek} de 4${planWeek === 4 ? ' (descarga)' : ''}`
              : 'fuera del plan'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PlanAdherenceBar adherence={adherence} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/plan/elegir">Cambiar plan</Link>
            </Button>
            <ArchiveButton plan={plan.data} userId={auth.userId} />
          </div>
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
            className={cn(
              'rounded-xl border p-3',
              day.date === today && 'border-primary',
              day.date < today && 'opacity-90',
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
                    {FIXED_EMOJI[f.type]}
                  </span>
                ))}
              </span>
            </div>
            {day.planned.length === 0 && day.extra.length === 0 && (
              <p className="text-muted-foreground mt-1 text-sm">Descanso</p>
            )}
            <ul className="mt-2 flex flex-col gap-2">
              {day.planned.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(p.id)}
                    className="bg-card hover:bg-accent flex w-full items-center gap-3 rounded-lg border p-3 text-left"
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
                  </button>
                </li>
              ))}
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

      <PlannedSheet
        planned={selected}
        userId={auth.userId}
        today={today}
        candidates={extraSameDay}
        allPlanned={plan.data.sessions}
        fixed={training.data?.fixedActivities ?? []}
        sex={auth.profile.sex}
        onClose={() => setOpen(null)}
      />
    </Page>
  )
}

function ArchiveButton({ plan, userId }: { plan: ActivePlan; userId: string }) {
  const queryClient = useQueryClient()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={async () => {
        if (!confirm(`¿Terminar el plan «${plan.name}»? Lo hecho se conserva en el historial.`))
          return
        try {
          await archivePlan(plan.id)
          await refreshPlan(queryClient, userId)
          notifySaved('Plan terminado')
        } catch (error) {
          notifyError(error, 'terminar el plan')
        }
      }}
    >
      Terminar plan
    </Button>
  )
}

function PlannedSheet({
  planned,
  userId,
  today,
  candidates,
  allPlanned,
  fixed,
  sex,
  onClose,
}: {
  planned: PlannedView | null
  userId: string
  today: string
  candidates: SessionLogEntry[]
  allPlanned: PlannedSession[]
  fixed: Pick<FixedActivity, 'type' | 'days'>[]
  sex: Sex | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const starter = useStartPlanned(userId)
  const [working, setWorking] = useState(false)
  const busy = working || starter.busy
  const [moving, setMoving] = useState(false)
  const [linking, setLinking] = useState(false)
  const name = (id: string) => catalog.byId.get(id)?.name ?? id

  async function run(action: () => Promise<unknown>, success: string, what: string) {
    setWorking(true)
    try {
      await action()
      await refreshPlan(queryClient, userId)
      await queryClient.invalidateQueries({ queryKey: sessionLogKey(userId) })
      notifySaved(success)
      setMoving(false)
      setLinking(false)
      onClose()
    } catch (error) {
      notifyError(error, what)
    } finally {
      setWorking(false)
    }
  }

  const warningsFor = (date: string) =>
    planned ? moveWarnings(planned, date, allPlanned, fixed) : []

  const pending = planned?.effectiveStatus === 'planned' || planned?.effectiveStatus === 'moved'
  const weekStart = planned ? weekStartOf(planned.date) : today

  return (
    <Sheet
      open={planned !== null}
      onClose={() => {
        setMoving(false)
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
              <Button size="lg" disabled={busy} onClick={() => void starter.start(planned)}>
                <Play /> Empezar ahora
              </Button>
              <PlannedPairButton userId={userId} planned={planned} disabled={busy} />
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setLinking((v) => !v)}>
                  <Check /> Hecha
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setMoving((v) => !v)}>
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

          {moving && pending && (
            <MovePicker
              current={planned.date}
              weekStart={weekStart}
              busy={busy}
              warningsFor={warningsFor}
              onPick={(date) => {
                const warnings = warningsFor(date)
                void run(
                  async () => {
                    await movePlanned(planned, date)
                    for (const w of warnings) notifyWarning(w)
                  },
                  `Movida al ${formatDayMonth(date)}`,
                  'mover la sesión',
                )
              }}
            />
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

function MovePicker({
  current,
  weekStart,
  busy,
  warningsFor,
  onPick,
}: {
  current: string
  weekStart: string
  busy: boolean
  warningsFor: (date: string) => string[]
  onPick: (date: string) => void
}) {
  const [custom, setCustom] = useState('')
  const customWarnings = custom && custom !== current ? warningsFor(custom) : []
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="text-sm font-semibold">Mover a…</p>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date, i) => {
          const warned = date !== current && warningsFor(date).length > 0
          return (
            <Chip
              key={date}
              selected={date === current}
              className="flex flex-col items-center px-0 leading-tight"
              label={`${WEEKDAY_LONG[i]} ${formatDayMonth(date)}${warned ? ' (con aviso)' : ''}`}
              onClick={() => date !== current && !busy && onPick(date)}
            >
              <span>{WEEKDAY_SHORT[i]}</span>
              <span className="text-[10px] font-normal">
                {Number(date.slice(8))}
                {warned ? ' ⚠' : ''}
              </span>
            </Chip>
          )
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        ⚠ = pierna pesada antes de frontón o surf, o dos intensas seguidas. Puedes moverla igual.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          aria-label="Otro día"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={busy || !custom || custom === current}
          onClick={() => onPick(custom)}
        >
          Mover
        </Button>
      </div>
      {customWarnings.map((w) => (
        <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
          ⚠ {w}
        </p>
      ))}
    </div>
  )
}
