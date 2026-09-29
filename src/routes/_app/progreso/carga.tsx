import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BackLink, Stat } from '@/components/progress/common'
import { acwrMessage, formatRatio, useHasActivePlan } from '@/components/progress/load'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addDays,
  daysBetween,
  formatDayMonth,
  formatWeekRange,
  localDateKey,
  weekStartOf,
} from '@/lib/progress/dates'
import { sessionMinutes } from '@/lib/progress/adherence'
import { useSessionLog } from '@/lib/progress/hooks'
import { acuteChronicRatio, sessionLoad, weeklyLoads } from '@/lib/progress/load'
import { sessionsInRange } from '@/lib/progress/muscle-volume'
import { formatInt, formatTime } from '@/lib/workout/format'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/progreso/carga')({
  ssr: false,
  component: LoadPage,
})

const WEEKS = 12

function LoadPage() {
  const { auth } = Route.useRouteContext()
  const log = useSessionLog(auth.userId)
  const hasActivePlan = useHasActivePlan(auth.userId)
  const today = localDateKey(new Date())
  const weekStart = weekStartOf(today)

  if (log.isPending) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        <h1 className="text-2xl font-bold">Carga</h1>
        <p className="text-muted-foreground text-center">Cargando…</p>
      </div>
    )
  }

  const sessions = log.data?.sessions ?? []
  const acwr = acuteChronicRatio(sessions, today, { hasActivePlan })
  const weeks = weeklyLoads(sessions, weekStart, WEEKS)
  const thisWeek = sessionsInRange(sessions, weekStart, addDays(weekStart, 6)).reverse()
  const first = sessions[0] ? localDateKey(sessions[0].startedAt) : null
  const daysOfData = first ? daysBetween(first, today) + 1 : 0

  const StatusIcon =
    acwr.status === 'high' || acwr.status === 'low'
      ? AlertTriangle
      : acwr.status === 'ok'
        ? CheckCircle2
        : Info

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Carga</h1>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Ratio agudo:crónico</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <p
              className={cn(
                'text-4xl font-bold tabular-nums',
                acwr.ratio === null && 'text-muted-foreground',
              )}
            >
              {acwr.ratio !== null ? formatRatio(acwr.ratio) : '–'}
            </p>
            <p className="text-muted-foreground pb-1 text-xs">
              últimos 7 días / media semanal de los últimos 28
            </p>
          </div>
          <p
            className={cn(
              'flex items-start gap-2 rounded-lg p-3 text-sm',
              acwr.status === 'high' || acwr.status === 'low'
                ? 'border border-amber-400 bg-amber-50 dark:bg-amber-950/30'
                : 'bg-muted',
            )}
          >
            <StatusIcon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                acwr.status === 'high' || acwr.status === 'low'
                  ? 'text-amber-600 dark:text-amber-400'
                  : acwr.status === 'ok'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
              )}
            />
            <span>
              {acwrMessage(acwr)}
              {acwr.status === 'insufficient' && first && (
                <>
                  {' '}
                  Llevas {daysOfData} {daysOfData === 1 ? 'día' : 'días'} de datos.
                </>
              )}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Últimos 7 días" value={formatInt(acwr.acute)} hint="carga aguda" />
            <Stat
              label="Media semanal (28 d)"
              value={formatInt(acwr.chronicWeekly)}
              hint="carga crónica"
            />
          </div>
          {acwr.missingRpe > 0 && (
            <p className="text-muted-foreground text-xs">
              {acwr.missingRpe}{' '}
              {acwr.missingRpe === 1 ? 'sesión sin RPE no suma' : 'sesiones sin RPE no suman'} carga
              en los últimos 28 días.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Carga semanal (sRPE)</CardTitle>
        </CardHeader>
        <CardContent className="px-2">
          <div
            className="h-48"
            role="img"
            aria-label={`Carga de las últimas ${WEEKS} semanas: ${weeks.map((w) => formatInt(w.load)).join(', ')}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={(w: string) => formatDayMonth(w)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={16}
                />
                <YAxis
                  width={44}
                  tickFormatter={(v: number) => formatInt(v)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(v) => [formatInt(Number(v)), 'Carga']}
                  labelFormatter={(w) => formatWeekRange(String(w))}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                  cursor={{ fill: 'var(--muted)' }}
                />
                <Bar dataKey="load" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {weeks.map((w) => (
                    <Cell
                      key={w.weekStart}
                      fill="var(--primary)"
                      fillOpacity={w.weekStart === weekStart ? 1 : 0.55}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-muted-foreground px-3 pt-1 text-xs">
            Carga de una sesión = RPE × minutos. La barra más intensa es la semana en curso.
          </p>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Esta semana</CardTitle>
        </CardHeader>
        <CardContent>
          {thisWeek.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aún no hay sesiones esta semana.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {thisWeek.map((s) => {
                const load = sessionLoad(s)
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <span aria-hidden className="text-lg">
                      {sessionTypeEmoji(s.sessionType)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{sessionTypeLabel(s.sessionType)}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDayMonth(localDateKey(s.startedAt))} · {formatTime(s.startedAt)} ·{' '}
                        {s.rpe ? `RPE ${s.rpe}` : 'sin RPE'} × {sessionMinutes(s)} min
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums">
                      {load !== null ? formatInt(load) : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Ratio &gt; {formatRatio(1.5)}: riesgo de sobrecarga.{' '}
        {hasActivePlan
          ? `Ratio < ${formatRatio(0.8)}: carga baja respecto a tu plan.`
          : `El aviso de carga baja (< ${formatRatio(0.8)}) solo sale con un plan activo.`}{' '}
        Es una guía orientativa, no un diagnóstico: si algo duele, para y consulta a un profesional.
      </p>
    </div>
  )
}
