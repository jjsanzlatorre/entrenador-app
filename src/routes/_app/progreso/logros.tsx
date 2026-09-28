import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { HomeCityPrompt, useEquivalenceContext } from '@/components/progress/achievements'
import { BackLink, Stat } from '@/components/progress/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { accumulate, periodFor, type PeriodKind } from '@/lib/progress/accumulated'
import { formatDayMonth, formatMonth, localDateKey } from '@/lib/progress/dates'
import {
  equivalenceFor,
  formatKm,
  formatMetricValue,
  METRIC_LABEL,
  parseMilestoneKey,
  stepName,
  stepsFor,
  withPeriod,
  type Equivalence,
  type EquivalenceContext,
  type Metric,
} from '@/lib/progress/equivalences'
import { formatDuration } from '@/lib/progress/period-summary'
import { useSessionLog, useShownMilestones } from '@/lib/progress/hooks'
import type { ShownMilestone } from '@/lib/progress/api'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'
import type { SessionType } from '@/types/database'

export const Route = createFileRoute('/_app/progreso/logros')({
  ssr: false,
  component: AchievementsPage,
})

const PERIODS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'Semana' },
  { kind: 'month', label: 'Mes' },
  { kind: 'year', label: 'Año' },
  { kind: 'total', label: 'Total' },
]

const intFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

function AchievementsPage() {
  const { auth } = Route.useRouteContext()
  const [kind, setKind] = useState<PeriodKind>('month')
  const log = useSessionLog(auth.userId)
  const shown = useShownMilestones(auth.userId)
  const {
    ctx,
    isPending: catalogPending,
    error: catalogError,
  } = useEquivalenceContext(auth.profile)
  const today = localDateKey(new Date())
  const acc = useMemo(
    () => accumulate(log.data?.sessions ?? [], periodFor(kind, today)),
    [log.data, kind, today],
  )

  if (log.isPending || catalogPending) {
    return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  }

  const eq = (metric: Metric, value: number) => (ctx ? equivalenceFor(metric, value, ctx) : null)
  const sports = (Object.entries(acc.minutesBySport) as [SessionType, number][]).sort(
    (a, b) => b[1] - a[1],
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Mis logros</h1>

      <div className="bg-muted grid grid-cols-4 gap-1 rounded-xl p-1" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.kind}
            type="button"
            role="tab"
            aria-selected={kind === p.kind}
            onClick={() => setKind(p.kind)}
            className={cn(
              'rounded-lg py-2 text-sm font-medium',
              kind === p.kind ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {log.data?.offline && (
        <p className="text-muted-foreground text-sm">
          Sin conexión: se cuentan las sesiones guardadas en este móvil.
        </p>
      )}
      {catalogError && !ctx && (
        <p className="text-muted-foreground text-sm">
          No se han podido cargar las equivalencias. Vuelve a intentarlo con conexión.
        </p>
      )}
      {ctx && !ctx.home && <HomeCityPrompt from="logros" />}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Sesiones" value={acc.sessions} />
        <Stat label="Horas" value={formatDuration(acc.minutes)} />
        <Stat label="Repeticiones" value={intFormat.format(acc.reps)} />
      </div>

      <MetricCard
        kind={kind}
        title="🏋️ Tonelaje"
        metric="tonnage"
        value={acc.tonnageKg}
        eq={eq('tonnage', acc.tonnageKg)}
        hint="Series completadas sin calentamiento; el peso corporal no suma."
      />
      <MetricCard
        kind={kind}
        title="🏊 Natación"
        metric="swim"
        value={acc.swimM}
        eq={eq('swim', acc.swimM)}
      />
      <MetricCard
        kind={kind}
        title="🏃 Carrera"
        metric="run"
        value={acc.runM}
        eq={eq('run', acc.runM)}
      />
      <MetricCard
        kind={kind}
        title="🚴 Bici y spinning"
        metric="bike"
        value={acc.bikeM}
        extra={acc.bikeMinutes > 0 ? formatDuration(acc.bikeMinutes) : undefined}
        eq={eq('bike', acc.bikeM)}
      />
      <MetricCard
        kind={kind}
        title="⏱️ Tiempo entrenando"
        metric="time"
        value={acc.minutes}
        eq={eq('time', acc.minutes)}
      >
        {sports.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {sports.map(([type, minutes]) => (
              <li key={type} className="flex justify-between">
                <span>
                  {sessionTypeEmoji(type)} {sessionTypeLabel(type)}
                </span>
                <span className="tabular-nums">{formatDuration(minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </MetricCard>

      {ctx?.home && <Destinations ctx={ctx} distM={acc.distM} kind={kind} />}

      <MilestoneHistory items={shown.data?.items ?? []} ctx={ctx} />

      <p className="text-muted-foreground text-xs">
        Valores aproximados. Las distancias a destinos se miden en línea recta desde tu ciudad de
        referencia.
      </p>
    </div>
  )
}

function MetricCard({
  kind,
  title,
  metric,
  value,
  extra,
  eq,
  hint,
  children,
}: {
  kind: PeriodKind
  title: string
  metric: Metric
  value: number
  extra?: string
  eq: Equivalence | null
  hint?: string
  children?: React.ReactNode
}) {
  const fraction = eq?.position.fraction ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span>{title}</span>
          <span className="text-xl font-extrabold tabular-nums">
            {formatMetricValue(metric, value)}
            {extra && (
              <span className="text-muted-foreground ml-1.5 text-sm font-normal">· {extra}</span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {value === 0 ? (
          <p className="text-muted-foreground text-sm">Aún nada en este periodo.</p>
        ) : eq?.phrase ? (
          <p className="flex items-start gap-2 text-sm font-medium">
            <span className="text-2xl leading-none" aria-hidden>
              {eq.position.passed?.emoji}
            </span>
            <span>{withPeriod(kind, eq.phrase)}.</span>
          </p>
        ) : null}
        {eq?.needsHome && metric !== 'swim' && value > 0 && (
          <p className="text-muted-foreground text-xs">
            Elige tu ciudad de referencia para ver a dónde habrías llegado.
          </p>
        )}
        {eq?.next && fraction !== null && (
          <div>
            <div
              className="bg-muted h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-label={eq.next}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
            >
              <div
                className="bg-primary h-full rounded-full transition-[width]"
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {eq.position.next?.emoji} {eq.next}
            </p>
          </div>
        )}
        {eq?.big && <p className="text-muted-foreground text-xs">🎯 {eq.big.text}</p>}
        {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
        {children}
      </CardContent>
    </Card>
  )
}

// Destinos alcanzados con la distancia total (carrera + bici + natación) del periodo.
function Destinations({
  ctx,
  distM,
  kind,
}: {
  ctx: EquivalenceContext
  distM: number
  kind: PeriodKind
}) {
  const steps = stepsFor('dist', ctx)
  const reached = steps.filter((s) => s.value <= distM)
  const next = steps.find((s) => s.value > distM)
  return (
    <Card>
      <CardHeader>
        <CardTitle>🗺️ Destinos alcanzados</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          {withPeriod(kind, `Has recorrido ${formatKm(distM)}`)} (carrera, bici y natación), en
          línea recta desde {ctx.home!.city}.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {reached
            .slice(-8)
            .reverse()
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-600" /> {s.emoji} {stepName(s)}
                </span>
                <span className="text-muted-foreground tabular-nums">{formatKm(s.value)}</span>
              </li>
            ))}
          {reached.length > 8 && (
            <li className="text-muted-foreground text-xs">y {reached.length - 8} más</li>
          )}
          {next && (
            <li className="text-muted-foreground flex items-center justify-between gap-2">
              <span>
                ➡️ {next.emoji} {stepName(next)}
              </span>
              <span className="tabular-nums">faltan {formatKm(next.value - distM)}</span>
            </li>
          )}
          {reached.length === 0 && !next && <li className="text-muted-foreground">—</li>}
        </ul>
      </CardContent>
    </Card>
  )
}

function periodText(period: PeriodKind, key: string | null) {
  switch (period) {
    case 'week':
      return `semana del ${formatDayMonth(key!)}`
    case 'month':
      return formatMonth(`${key}-01`)
    case 'year':
      return key!
    case 'total':
      return 'total'
  }
}

function MilestoneHistory({
  items,
  ctx,
}: {
  items: ShownMilestone[]
  ctx: EquivalenceContext | null
}) {
  const rows = items.flatMap((item) => {
    const parsed = parseMilestoneKey(item.key)
    if (!parsed) return []
    if (parsed.type === 'month_summary') {
      return [
        { item, emoji: '📅', text: `Resumen de ${formatMonth(`${parsed.month}-01`)}`, sub: '' },
      ]
    }
    const object = ctx?.objects.find((o) => o.id === parsed.stepId)
    const destination = ctx?.destinations.find((d) => d.id === parsed.stepId)
    const name = object
      ? `${object.label.charAt(0).toUpperCase()}${object.label.slice(1)}`
      : (destination?.name ?? parsed.stepId)
    const emoji = object?.emoji ?? (destination ? '📍' : '🏅')
    return [
      {
        item,
        emoji,
        text: name,
        sub: `${METRIC_LABEL[parsed.metric]} · ${periodText(parsed.period, parsed.periodKey)}`,
      },
    ]
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>🏅 Hitos conseguidos</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aparecerán aquí cuando una sesión te haga superar un objeto o un destino nuevo.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map(({ item, emoji, text, sub }) => (
              <li key={item.key} className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{text}</p>
                  {sub && <p className="text-muted-foreground truncate text-xs">{sub}</p>}
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatDayMonth(localDateKey(item.shownAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
