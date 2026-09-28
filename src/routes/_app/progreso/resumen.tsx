import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BackLink, Stat } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addDays,
  addMonths,
  formatMonth,
  formatWeekRange,
  localDateKey,
  monthEndOf,
  monthStartOf,
  weekStartOf,
} from '@/lib/progress/dates'
import { useSessionLog } from '@/lib/progress/hooks'
import { formatDuration, periodSummary } from '@/lib/progress/period-summary'
import { formatInt } from '@/lib/workout/format'
import { formatDistance, paceKindForSession } from '@/lib/workout/pace'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/progreso/resumen')({
  ssr: false,
  component: SummaryPage,
})

type Mode = 'week' | 'month'

function SummaryPage() {
  const { auth } = Route.useRouteContext()
  const log = useSessionLog(auth.userId)
  const today = localDateKey(new Date())
  const [mode, setMode] = useState<Mode>('week')
  const [offset, setOffset] = useState(0)

  const from =
    mode === 'week'
      ? addDays(weekStartOf(today), 7 * offset)
      : addMonths(monthStartOf(today), offset)
  const to = mode === 'week' ? addDays(from, 6) : monthEndOf(from)
  const prevFrom = mode === 'week' ? addDays(from, -7) : addMonths(from, -1)
  const prevTo = mode === 'week' ? addDays(prevFrom, 6) : monthEndOf(prevFrom)
  const sessions = log.data?.sessions ?? []
  const summary = periodSummary(sessions, from, to)
  const previous = periodSummary(sessions, prevFrom, prevTo)
  const title = mode === 'week' ? formatWeekRange(from) : formatMonth(from)

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Resumen</h1>

      <div className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1" role="tablist">
        {(['week', 'month'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setOffset(0)
            }}
            className={cn(
              'h-10 rounded-lg text-sm font-semibold',
              mode === m ? 'bg-background shadow' : 'text-muted-foreground',
            )}
          >
            {m === 'week' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Anterior"
          onClick={() => setOffset((o) => o - 1)}
        >
          <ChevronLeft />
        </Button>
        <p className="font-semibold first-letter:uppercase">{title}</p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Siguiente"
          disabled={offset >= 0}
          onClick={() => setOffset((o) => o + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      {log.isPending ? (
        <p className="text-muted-foreground text-center">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Sesiones" value={summary.sessions} hint={`antes: ${previous.sessions}`} />
            <Stat
              label="Horas"
              value={formatDuration(summary.minutes)}
              hint={`antes: ${formatDuration(previous.minutes)}`}
            />
            <Stat
              label="Carga (sRPE)"
              value={formatInt(summary.load)}
              hint={`RPE × min · antes: ${formatInt(previous.load)}`}
            />
            <Stat
              label="Distancia"
              value={summary.distanceM > 0 ? formatDistance(summary.distanceM) : '—'}
              hint={
                previous.distanceM > 0 ? `antes: ${formatDistance(previous.distanceM)}` : undefined
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por deporte</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.bySport.length === 0 ? (
                <p className="text-muted-foreground text-sm">Sin sesiones en este periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="pb-1 font-normal">Deporte</th>
                      <th className="pb-1 text-right font-normal">Ses.</th>
                      <th className="pb-1 text-right font-normal">Tiempo</th>
                      <th className="pb-1 text-right font-normal">Carga</th>
                      <th className="pb-1 text-right font-normal">Dist.</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {summary.bySport.map((s) => (
                      <tr key={s.sessionType} className="border-t">
                        <td className="py-1.5">
                          <span aria-hidden>{sessionTypeEmoji(s.sessionType)} </span>
                          {sessionTypeLabel(s.sessionType)}
                        </td>
                        <td className="text-right">{s.sessions}</td>
                        <td className="text-right">{formatDuration(s.minutes)}</td>
                        <td className="text-right">{s.load > 0 ? formatInt(s.load) : '—'}</td>
                        <td className="text-right">
                          {s.distanceM > 0
                            ? formatDistance(s.distanceM, paceKindForSession(s.sessionType))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-xs">
            Semanas de lunes a domingo. «Antes» es {mode === 'week' ? 'la semana' : 'el mes'}{' '}
            anterior.
          </p>
        </>
      )}
    </div>
  )
}
