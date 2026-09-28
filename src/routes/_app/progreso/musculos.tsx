import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, CloudOff } from 'lucide-react'
import { BodyMap, BodyMapLegend } from '@/components/progress/body-map'
import { BackLink } from '@/components/progress/common'
import { formatDiff, MuscleDetailSheet } from '@/components/progress/muscle-detail'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { addDays, formatWeekRange, localDateKey, weekStartOf } from '@/lib/progress/dates'
import { useExerciseSetCounts, useSessionLog } from '@/lib/progress/hooks'
import {
  formatSets,
  neglectedMuscles,
  setsOf,
  weekComparison,
  weekVolume,
} from '@/lib/progress/muscle-volume'
import { useCatalog } from '@/lib/workout/hooks'
import { muscleName } from '@/lib/workout/labels'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/progreso/musculos')({
  ssr: false,
  component: MusclesPage,
})

// Semanas que se miran hacia atrás para los músculos descuidados (la elegida incluida).
const LOOKBACK_WEEKS = 4

function MusclesPage() {
  const { auth } = Route.useRouteContext()
  const today = localDateKey(new Date())
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const weekStart = addDays(weekStartOf(today), 7 * offset)
  const from = addDays(weekStart, -7 * (LOOKBACK_WEEKS - 1))
  const log = useSessionLog(auth.userId)
  const counts = useExerciseSetCounts(auth.userId, from, addDays(weekStart, 6))
  const catalog = useCatalog(auth.userId)

  const sessions = useMemo(() => log.data?.sessions ?? [], [log.data])
  const weeks = useMemo(
    () =>
      Array.from({ length: LOOKBACK_WEEKS }, (_, i) =>
        weekVolume(sessions, counts.data?.counts ?? [], catalog.byId, addDays(weekStart, -7 * i)),
      ),
    [sessions, counts.data, catalog.byId, weekStart],
  )
  const current = weeks[0]!
  const previous = weeks[1]!
  const firstDay = sessions[0] ? localDateKey(sessions[0].startedAt) : null
  const neglected = neglectedMuscles(weeks, weekStart, firstDay)
  const neglectedIds = new Set<string>(neglected.map((n) => n.muscleId))
  const comparison = weekComparison(current, previous).sort(
    (a, b) => b.sets - a.sets || muscleName(a.muscleId).localeCompare(muscleName(b.muscleId)),
  )
  const approxTotal = [...current.values()].reduce((acc, v) => acc + v.approxSets, 0)
  const loading = log.isPending || counts.isPending || catalog.isPending
  const selectedNeglect = neglected.find((n) => n.muscleId === selected) ?? null

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Mapa muscular</h1>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Semana anterior"
          onClick={() => setOffset((o) => o - 1)}
        >
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <p className="font-semibold first-letter:uppercase">{formatWeekRange(weekStart)}</p>
          <p className="text-muted-foreground text-xs">
            {offset === 0 ? 'Esta semana' : offset === -1 ? 'Semana pasada' : 'Semana'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Semana siguiente"
          disabled={offset >= 0}
          onClick={() => setOffset((o) => o + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      {counts.data?.offline && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <CloudOff className="size-4" /> Sin conexión: se usa la última copia guardada.
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          {loading ? (
            <div className="bg-muted mx-auto h-80 w-full max-w-sm animate-pulse rounded-xl" />
          ) : (
            <BodyMap
              sets={(id) => setsOf(current, id)}
              selected={selected}
              onSelect={setSelected}
              neglected={neglectedIds}
            />
          )}
          <BodyMapLegend showNeglected={neglected.length > 0} unit="series/semana" />
          <p className="text-muted-foreground text-center text-xs">
            Toca un músculo para ver sus series y qué las aporta.
            {approxTotal > 0 && ' Incluye una parte aproximada de cardio y deportes.'}
          </p>
        </CardContent>
      </Card>

      {neglected.length > 0 && (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Músculos descuidados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-2 text-sm">
              0 series en las últimas 2 semanas o más:
            </p>
            <ul className="flex flex-wrap gap-2">
              {neglected.map((n) => (
                <li key={n.muscleId}>
                  <button
                    type="button"
                    onClick={() => setSelected(n.muscleId)}
                    className="rounded-full border border-dashed border-[var(--mv-neglected)] px-3 py-1.5 text-sm"
                  >
                    {muscleName(n.muscleId)}{' '}
                    <span className="text-muted-foreground text-xs">
                      {n.orMore ? `${n.weeks}+` : n.weeks} sem.
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Series por músculo</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="pb-1 font-normal">Músculo</th>
                <th className="pb-1 text-right font-normal">Series</th>
                <th className="pb-1 text-right font-normal">vs. anterior</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {comparison.map((row) => {
                const approx = current.get(row.muscleId)?.approxSets ?? 0
                return (
                  <tr
                    key={row.muscleId}
                    className="hover:bg-accent cursor-pointer border-t"
                    onClick={() => setSelected(row.muscleId)}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-left"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelected(row.muscleId)
                        }}
                      >
                        {muscleName(row.muscleId)}
                        {neglectedIds.has(row.muscleId) && (
                          <span className="ml-1 text-xs text-[var(--mv-neglected)]">
                            descuidado
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="text-right font-semibold">
                      {formatSets(row.sets)}
                      {approx > 0 && (
                        <span className="text-muted-foreground block text-[10px] font-normal">
                          ≈{formatSets(approx)} aprox.
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'text-right',
                        row.diff > 0.05 && 'text-emerald-700 dark:text-emerald-400',
                        row.diff < -0.05 && 'text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {formatDiff(row.diff)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-muted-foreground mt-3 text-xs">
            Series efectivas (sin calentamiento): 1 si el músculo es principal y 0,5 si es
            secundario. Cardio y deportes suman una parte <strong>aproximada</strong>: ≈2 series por
            cada 30 min en los músculos que más usan (yoga 0,5).
          </p>
        </CardContent>
      </Card>

      <MuscleDetailSheet
        muscleId={selected}
        volume={selected ? current.get(selected) : undefined}
        previousSets={selected ? setsOf(previous, selected) : null}
        neglectedWeeks={selectedNeglect}
        exerciseName={(id) => catalog.byId.get(id)?.name ?? id}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
