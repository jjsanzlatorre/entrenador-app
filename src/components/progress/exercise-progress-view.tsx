// Récords y gráficas de un ejercicio (propio o, en solo lectura, de una persona vinculada que
// comparte sus entrenos).
import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { SeriesChart, type ChartPoint } from '@/components/progress/line-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchExerciseSamples, fetchRecords } from '@/lib/progress/api'
import { exerciseSeries, type ExercisePoint } from '@/lib/progress/exercise-progress'
import {
  currentRecords,
  formatPrevious,
  formatRecordValue,
  PR_LABELS,
  sessionImprovements,
} from '@/lib/progress/records'
import { formatClock, formatDateShort, formatInt, formatKg } from '@/lib/workout/format'
import { useOwnerCatalog, type DataOwner } from '@/lib/partners/hooks'
import { formatDistance, formatPaceClock, paceKindForExercise } from '@/lib/workout/pace'

const speed = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })

export function ExerciseProgressView({
  owner,
  exerciseId,
}: {
  owner: DataOwner
  exerciseId: string
}) {
  const catalog = useOwnerCatalog(owner)
  const exercise = catalog.byId.get(exerciseId)
  const paceKind = paceKindForExercise(exerciseId)

  const samples = useQuery({
    queryKey: ['exercise-samples', owner.userId, exerciseId],
    queryFn: () => fetchExerciseSamples(owner.userId, exerciseId),
  })
  const records = useQuery({
    queryKey: ['records', owner.userId, exerciseId],
    queryFn: () => fetchRecords(owner.userId, exerciseId),
  })

  const points = samples.data ? exerciseSeries(samples.data, paceKind) : []
  const series = (pick: (p: ExercisePoint) => number | null): ChartPoint[] =>
    points.flatMap((p) => {
      const y = pick(p)
      return y === null || y === 0 ? [] : [{ x: p.endedAt, y }]
    })
  const current = records.data ? currentRecords(records.data) : null
  const history = records.data ? sessionImprovements(records.data).reverse() : []
  const tracking = exercise?.trackingType ?? 'weight_reps'
  const xFormat = (x: string) => formatDateShort(x)

  return (
    <>
      <h1 className="text-2xl font-bold">{exercise?.name ?? exerciseId}</h1>

      {(samples.isError || records.isError) && (
        <p className="text-destructive text-sm">
          {(samples.error ?? records.error)?.message ?? 'No se han podido cargar los datos'}
        </p>
      )}

      {current && (current.main.length > 0 || current.reps.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-5 text-amber-500" /> Récords
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
              {current.main.map((r) => (
                <div key={r.id} className="contents">
                  <dt className="text-muted-foreground">{PR_LABELS[r.prType]}</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {formatRecordValue(r)}{' '}
                    <span className="text-muted-foreground text-xs font-normal">
                      {formatDateShort(r.achievedAt)}
                    </span>
                  </dd>
                </div>
              ))}
              {current.reps.slice(0, 4).map((r, i) => (
                <div key={r.id} className="contents">
                  <dt className="text-muted-foreground">{i === 0 ? PR_LABELS[r.prType] : ''}</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {formatRecordValue(r)}{' '}
                    <span className="text-muted-foreground text-xs font-normal">
                      {formatDateShort(r.achievedAt)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {samples.isPending ? (
        <p className="text-muted-foreground text-center">Cargando…</p>
      ) : paceKind ? (
        <>
          <SeriesChart
            title="Distancia"
            points={series((p) => p.distanceM)}
            formatY={(v) => formatDistance(v, paceKind)}
            formatX={xFormat}
          />
          <SeriesChart
            title={paceKind === 'bike' ? 'Velocidad' : 'Ritmo'}
            points={series((p) => p.pace)}
            formatY={(v) =>
              paceKind === 'bike'
                ? `${speed.format(v)} km/h`
                : `${formatPaceClock(v)}${paceKind === 'swim' ? '/100 m' : '/km'}`
            }
            formatX={xFormat}
            reversed={paceKind !== 'bike'}
            note={
              paceKind === 'bike'
                ? undefined
                : 'Más arriba = más rápido. Sobre el tiempo en movimiento (sin recuperaciones).'
            }
          />
        </>
      ) : tracking === 'weight_reps' ? (
        <>
          <SeriesChart
            title="1RM estimado"
            points={series((p) => p.est1rm)}
            formatY={(v) => `${formatKg(v)} kg`}
            formatX={xFormat}
            note="Epley: peso × (1 + reps/30), con series de hasta 10 reps."
          />
          <SeriesChart
            title="Peso máximo"
            points={series((p) => p.maxWeight)}
            formatY={(v) => `${formatKg(v)} kg`}
            formatX={xFormat}
          />
          <SeriesChart
            title="Volumen"
            points={series((p) => p.volume)}
            formatY={(v) => `${formatInt(v)} kg`}
            formatX={xFormat}
            note="Σ peso × reps de las series efectivas de la sesión."
          />
        </>
      ) : tracking === 'time' || tracking === 'duration_only' ? (
        <SeriesChart
          title="Tiempo total"
          points={series((p) => p.durationS)}
          formatY={formatClock}
          formatX={xFormat}
        />
      ) : (
        <SeriesChart
          title="Repeticiones"
          points={series((p) => p.reps)}
          formatY={(v) => formatInt(v)}
          formatX={xFormat}
        />
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de récords</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {history.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2">
                  <span>
                    🏆 {PR_LABELS[r.prType]}: <strong>{formatRecordValue(r)}</strong>{' '}
                    <span className="text-muted-foreground text-xs">{formatPrevious(r)}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatDateShort(r.achievedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}
