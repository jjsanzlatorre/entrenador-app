import { createFileRoute, Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { AdherenceBar, UsCard, weekValue } from '@/components/progress/adherence'
import { BackLink, Stat } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  adherenceLevel,
  averagePct,
  formatPct,
  monthAdherence,
  monthValue,
  streaks,
  weekAdherence,
  weekHistory,
  weekMessage,
} from '@/lib/progress/adherence'
import {
  formatDayMonth,
  formatMonth,
  formatWeekRange,
  localDateKey,
  monthStartOf,
  weekStartOf,
} from '@/lib/progress/dates'
import { useMyAdherenceData } from '@/lib/progress/hooks'
import { sessionTypeLabel } from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/progreso/cumplimiento')({
  ssr: false,
  component: AdherencePage,
})

const HISTORY_FILL = {
  low: 'bg-slate-400 dark:bg-slate-500',
  mid: 'bg-sky-500',
  done: 'bg-emerald-600 dark:bg-emerald-500',
}

function AdherencePage() {
  const { auth } = Route.useRouteContext()
  const { days, commitments, isPending, offline } = useMyAdherenceData(auth.userId)
  const today = localDateKey(new Date())

  if (isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>

  if (commitments.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        <h1 className="text-2xl font-bold">Cumplimiento</h1>
        <p className="text-muted-foreground">
          Aún no has definido tu compromiso: cuántas sesiones quieres hacer cada semana.
        </p>
        <Button asChild size="lg">
          <Link to="/perfil/compromiso">Definir mi compromiso</Link>
        </Button>
      </div>
    )
  }

  const week = weekAdherence(commitments, days, weekStartOf(today))
  const month = monthAdherence(commitments, days, monthStartOf(today))
  const history = weekHistory(commitments, days, today)
  const streak = streaks(commitments, days, today)
  const avg = averagePct(commitments, days, today)

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cumplimiento</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/perfil/compromiso">
            <Pencil /> Compromiso
          </Link>
        </Button>
      </div>
      {offline && (
        <p className="text-muted-foreground text-sm">
          Sin conexión: se cuentan las sesiones guardadas en este móvil.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Semana en curso{' '}
            <span className="text-muted-foreground text-sm font-normal">
              {formatWeekRange(week.weekStart)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <AdherenceBar
            pct={week.pct}
            label="Sesiones"
            value={weekValue(week)}
            extra={week.extra}
          />
          {week.byType.map((t) => (
            <AdherenceBar
              key={t.sessionType}
              size="sm"
              pct={t.done / t.committed}
              label={sessionTypeLabel(t.sessionType)}
              value={`${t.done}/${t.committed}`}
            />
          ))}
          {week.minutesTarget && week.minutesDone !== null && (
            <AdherenceBar
              size="sm"
              pct={week.minutesDone / week.minutesTarget}
              label="Minutos"
              value={`${week.minutesDone}/${week.minutesTarget} min`}
            />
          )}
          <p className="text-sm font-medium">{weekMessage(week, today)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="first-letter:uppercase">{formatMonth(month.monthStart)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <AdherenceBar
            pct={month.pct}
            label="Sesiones del mes"
            value={monthValue(month)}
            extra={month.extra}
          />
          <p className="text-muted-foreground text-xs">
            {month.partial
              ? 'Tu compromiso empezó a final de mes: el porcentaje se verá el mes que viene.'
              : `Objetivo del mes: ${String(month.committed).replace('.', ',')} sesiones (las semanas partidas entre dos meses cuentan por días), redondeado a ${month.target}.`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Racha actual" value={`${streak.current} sem.`} />
        <Stat label="Mejor racha" value={`${streak.best} sem.`} />
        <Stat label="Media 3 meses" value={formatPct(avg)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimas 12 semanas</CardTitle>
        </CardHeader>
        <CardContent>
          <ol
            className="flex h-32 items-end gap-1"
            aria-label="Cumplimiento de las últimas 12 semanas"
          >
            {history.map((w) => {
              const pct = w.pct === null ? 0 : Math.min(1, w.pct)
              return (
                <li
                  key={w.weekStart}
                  className="flex h-full flex-1 flex-col items-center justify-end"
                  title={`Semana del ${formatDayMonth(w.weekStart)}: ${w.pct === null ? 'sin compromiso' : weekValue(w)}`}
                >
                  <span className="sr-only">
                    Semana del {formatDayMonth(w.weekStart)}:{' '}
                    {w.pct === null ? 'sin compromiso' : weekValue(w)}
                  </span>
                  <div
                    className={cn(
                      'w-full rounded-t-sm',
                      w.pct === null ? 'bg-muted' : HISTORY_FILL[adherenceLevel(w.pct)],
                    )}
                    style={{ height: `${Math.max(4, pct * 100)}%` }}
                    aria-hidden
                  />
                </li>
              )
            })}
          </ol>
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>{formatDayMonth(history[0]!.weekStart)}</span>
            <span>esta semana</span>
          </div>
          <ul className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
            <Legend className={HISTORY_FILL.low} label="< 50 %" />
            <Legend className={HISTORY_FILL.mid} label="50–99 %" />
            <Legend className={HISTORY_FILL.done} label="≥ 100 %" />
          </ul>
        </CardContent>
      </Card>

      <UsCard userId={auth.userId} myName={auth.profile.display_name ?? 'Yo'} />

      <p className="text-muted-foreground text-xs">
        Cuenta una sesión por día y tipo, de al menos 15 minutos. La adherencia al plan llegará con
        los planes (fase 5).
      </p>
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1">
      <span className={cn('inline-block size-3 rounded-sm', className)} aria-hidden />
      {label}
    </li>
  )
}
