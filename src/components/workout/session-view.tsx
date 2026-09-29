// Cuerpo del detalle de una sesión (estadísticas, récords, músculos, ejercicios, notas y datos
// del reloj). Se usa en el historial propio y, en solo lectura, en la evolución de una persona
// vinculada que comparte sus entrenos.
import type { CSSProperties, ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShareCardButton } from '@/components/share/share-card-button'
import { recordCard } from '@/lib/share/cards'
import { BodyMap, BodyMapLegend } from '@/components/progress/body-map'
import { BLOCK_LABELS, describeTimer, resultSummary } from '@/components/workout/timed-block-card'
import { formatSets, localSetCounts, muscleVolume } from '@/lib/progress/muscle-volume'
import {
  formatPrevious,
  formatRecordValue,
  PR_LABELS,
  sessionImprovements,
  type PersonalRecord,
} from '@/lib/progress/records'
import { sessionStats, tonnage } from '@/lib/workout/calc'
import { setFields } from '@/lib/workout/fields'
import { formatClock, formatInt, formatKg } from '@/lib/workout/format'
import { muscleName } from '@/lib/workout/labels'
import {
  formatDistance,
  formatPace,
  paceKindForExercise,
  paceKindForSession,
} from '@/lib/workout/pace'
import { totalDistanceM } from '@/lib/workout/session-ops'
import { CARDIO_TYPES } from '@/lib/workout/session-kinds'
import { isTimedBlock } from '@/lib/workout/timed-blocks'
import type { Exercise, LastPerformance, LocalSession, SetEntry } from '@/lib/workout/types'
import type { SessionType } from '@/types/database'
import { cn } from '@/lib/utils'

export const QUICK_TYPES = new Set<SessionType>(['yoga', 'surf', 'padel_fronton', 'other'])

export type ExerciseLinkRenderer = (
  exerciseId: string,
  className: string,
  children: ReactNode,
) => ReactNode

export function SessionBody({
  session,
  byId,
  records,
  previous,
  renderExerciseLink,
}: {
  session: LocalSession
  byId: Map<string, Exercise>
  records: {
    pending: boolean
    loading: boolean
    unavailable: boolean
    list: PersonalRecord[] | undefined
  }
  // null = sin comparación con la vez anterior (sesiones de otra persona).
  previous: {
    data: Map<string, LastPerformance> | undefined
    loading: boolean
    unavailable: boolean
  } | null
  renderExerciseLink: ExerciseLinkRenderer
}) {
  const stats = sessionStats(session)
  // Series por músculo de esta sesión, con la aproximación de cardio y deportes (§6).
  const muscleSets = muscleVolume(
    [
      {
        id: session.id,
        sessionType: session.sessionType,
        startedAt: session.startedAt,
        endedAt: session.endedAt ?? session.startedAt,
        durationMin: session.durationMin,
      },
    ],
    localSetCounts(session),
    byId,
  )
  const muscles = [...muscleSets.values()].sort(
    (a, b) => b.sets - a.sets || a.muscleId.localeCompare(b.muscleId),
  )
  const maxMuscle = Math.max(1, ...muscles.map((m) => m.sets))
  const load = session.rpe && session.durationMin ? session.rpe * session.durationMin : null
  const paceKind = paceKindForSession(session.sessionType)
  const cardio = CARDIO_TYPES.has(session.sessionType)
  const quick = QUICK_TYPES.has(session.sessionType)
  const distance = session.distanceM ?? totalDistanceM(session)
  // Ritmo medio sobre el tiempo en movimiento (series con distancia), sin recuperaciones.
  const movingS = session.blocks
    .flatMap((b) => b.sets)
    .reduce((acc, s) => (s.completed && s.distanceM && s.durationS ? acc + s.durationS : acc), 0)
  const avgPace =
    paceKind && distance
      ? formatPace(paceKind, distance, movingS || (session.durationMin ?? 0) * 60)
      : null

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Duración"
          value={session.durationMin !== null ? `${session.durationMin} min` : '—'}
        />
        <Stat label="RPE" value={session.rpe?.toString() ?? '—'} />
        <Stat label="Carga" value={load !== null ? formatInt(load) : '—'} hint="RPE × min" />
        {cardio ? (
          <>
            <Stat label="Distancia" value={distance ? formatDistance(distance, paceKind) : '—'} />
            <Stat
              label={paceKind === 'bike' ? 'Velocidad media' : 'Ritmo medio'}
              value={avgPace ?? '—'}
            />
            <Stat label="FC media" value={session.avgHr?.toString() ?? '—'} />
          </>
        ) : quick ? null : (
          <>
            <Stat label="Volumen" value={`${formatInt(stats.tonnageKg)} kg`} />
            <Stat label="Series" value={String(stats.completedSets)} />
            <Stat label="Reps" value={formatInt(stats.totalReps)} />
          </>
        )}
      </div>

      {session.endedAt && !quick && (
        <SessionRecords
          pending={records.pending}
          loading={records.loading}
          unavailable={records.unavailable}
          records={records.list ? sessionImprovements(records.list) : []}
          names={(id) => byId.get(id)?.name ?? id}
          renderExerciseLink={renderExerciseLink}
          shareable={previous !== null}
        />
      )}

      {muscles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Músculos trabajados</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <BodyMap size="mini" sets={(id) => muscleSets.get(id)?.sets ?? 0} />
            <BodyMapLegend />
            <ul className="flex flex-col gap-1.5">
              {muscles.map((m) => (
                <li
                  key={m.muscleId}
                  className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm"
                >
                  <span className="truncate">{muscleName(m.muscleId)}</span>
                  <span className="bg-muted h-2.5 overflow-hidden rounded-full">
                    <span
                      className="bg-primary block h-full rounded-full"
                      style={{ width: `${(m.sets / maxMuscle) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">
                    {m.approxSets > 0 ? '≈' : ''}
                    {formatSets(m.sets)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              Series efectivas: 1 por músculo principal y 0,5 por secundario.
              {muscles.some((m) => m.approxSets > 0) &&
                ' ≈ incluye una parte aproximada por el tiempo de cardio o deporte (≈2 series por cada 30 min).'}
            </p>
          </CardContent>
        </Card>
      )}

      {!quick && (
        <Card>
          <CardHeader>
            <CardTitle>{cardio ? 'Bloques' : 'Ejercicios'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {session.blocks.length === 0 && (
              <p className="text-muted-foreground text-sm">Sin ejercicios.</p>
            )}
            {session.blocks.map((block) => {
              const special = block.blockType !== 'straight' && block.blockType !== 'superset'
              const summary = resultSummary(block)
              return (
                <div key={block.id} className={cn(special && 'rounded-xl border p-3')}>
                  {special && (
                    <p className="mb-2 text-sm font-semibold">
                      {BLOCK_LABELS[block.blockType]}
                      {isTimedBlock(block) && (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          · {describeTimer(block.settings)}
                        </span>
                      )}
                      {block.settings?.kind === 'circuit' && (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          · {block.settings.rounds} rondas
                        </span>
                      )}
                      {summary && (
                        <span className="text-primary block text-base font-bold">{summary}</span>
                      )}
                    </p>
                  )}
                  <div className="flex flex-col gap-4">
                    {block.exercises.map((be) => {
                      const exercise = byId.get(be.exerciseId)
                      const sets = block.sets.filter((s) => s.exerciseId === be.exerciseId)
                      const prev = previous?.data?.get(be.exerciseId)
                      return (
                        <ExerciseSummary
                          key={`${block.id}-${be.exerciseId}`}
                          name={exercise?.name ?? be.exerciseId}
                          exercise={exercise}
                          superset={block.blockType === 'superset'}
                          sets={sets}
                          previousTonnage={
                            prev ? tonnage(prev.sets.map((s) => ({ ...s, completed: true }))) : null
                          }
                          compare={previous !== null}
                          previousLoading={previous?.loading ?? false}
                          previousUnavailable={previous?.unavailable ?? false}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {session.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{session.notes}</CardContent>
        </Card>
      )}

      {(session.avgHr || session.maxHr || session.calories) && (
        <p className="text-muted-foreground text-sm">
          Reloj: {session.avgHr ? `FC media ${session.avgHr}` : ''}
          {session.maxHr ? ` · FC máx ${session.maxHr}` : ''}
          {session.calories ? ` · ${session.calories} kcal` : ''}
        </p>
      )}
    </>
  )
}

function SessionRecords({
  pending,
  loading,
  unavailable,
  records,
  names,
  renderExerciseLink,
  shareable,
}: {
  pending: boolean
  loading: boolean
  unavailable: boolean
  records: PersonalRecord[]
  names: (exerciseId: string) => string
  renderExerciseLink: ExerciseLinkRenderer
  shareable: boolean
}) {
  if (pending) {
    return (
      <p className="text-muted-foreground text-sm">
        🏆 Los récords se calculan al sincronizar la sesión.
      </p>
    )
  }
  if (loading || unavailable || records.length === 0) return null
  return (
    <Card className="pr-pop relative overflow-hidden border-amber-400 bg-amber-50 dark:bg-amber-950/30">
      <CardHeader>
        <CardTitle role="status">
          <span className="relative mr-1 inline-block" aria-hidden>
            <span className="pr-trophy">🏆</span>
            {SPARKS.map(([dx, dy, e], i) => (
              <span
                key={i}
                className="pr-spark top-1/2 left-1/2 text-base"
                style={{ '--dx': `${dx}px`, '--dy': `${dy}px` } as CSSProperties}
              >
                {e}
              </span>
            ))}
          </span>
          {records.length === 1 ? 'Nuevo récord' : `${records.length} récords nuevos`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5 text-sm">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              {renderExerciseLink(
                r.exerciseId,
                'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5',
                <>
                  <span className="font-semibold">{names(r.exerciseId)}</span>
                  <span className="text-muted-foreground">{PR_LABELS[r.prType]}:</span>
                  <strong className="tabular-nums">{formatRecordValue(r)}</strong>
                  <span className="text-muted-foreground text-xs">({formatPrevious(r)})</span>
                </>,
              )}
              {shareable && (
                <ShareCardButton
                  size="icon"
                  variant="ghost"
                  label="Compartir récord"
                  card={recordCard(r, names(r.exerciseId))}
                />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// Destellos alrededor del trofeo (desplazamiento x, y en px y emoji).
const SPARKS: [number, number, string][] = [
  [-34, -30, '✨'],
  [30, -34, '⭐'],
  [40, 6, '✨'],
  [-40, 10, '⭐'],
  [-10, 36, '✨'],
  [18, 30, '🎉'],
]

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[10px]">{hint}</p>}
    </div>
  )
}

function formatSet(set: SetEntry, exercise: Exercise | undefined) {
  const fields = setFields(exercise?.trackingType ?? 'weight_reps', exercise?.category)
  return fields
    .map((f) => {
      const v = set[f]
      if (v === null) return '—'
      if (f === 'weightKg') return `${formatKg(v)} kg`
      if (f === 'reps') return `${v} reps`
      if (f === 'durationS') return formatClock(v)
      if (f === 'distanceM') return `${formatKg(v)} m`
      return `${v} kcal`
    })
    .join(' × ')
}

function paceText(set: SetEntry) {
  const kind = paceKindForExercise(set.exerciseId)
  return kind ? formatPace(kind, set.distanceM, set.durationS) : null
}

function ExerciseSummary({
  name,
  exercise,
  superset,
  sets,
  previousTonnage,
  compare,
  previousLoading,
  previousUnavailable,
}: {
  name: string
  exercise: Exercise | undefined
  superset: boolean
  sets: SetEntry[]
  previousTonnage: number | null
  // false en sesiones de otra persona: «la vez anterior» solo existe para las propias.
  compare: boolean
  previousLoading: boolean
  previousUnavailable: boolean
}) {
  const current = tonnage(sets)
  const diff = previousTonnage !== null && previousTonnage > 0 ? current - previousTonnage : null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {name}
          {superset && <span className="text-primary ml-1 text-xs">superserie</span>}
        </h3>
        {current > 0 && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {formatInt(current)} kg
          </span>
        )}
      </div>
      <ol className="mt-1 flex flex-col gap-0.5 text-sm">
        {sets.map((s) => (
          <li
            key={s.id}
            className={cn('flex gap-2', !s.completed && 'text-muted-foreground line-through')}
          >
            <span className="w-6 text-right tabular-nums">{s.isWarmup ? 'C' : s.setIndex + 1}</span>
            <span className="tabular-nums">{formatSet(s, exercise)}</span>
            {paceText(s) && <span className="text-muted-foreground">{paceText(s)}</span>}
            {s.rir !== null && <span className="text-muted-foreground">RIR {s.rir}</span>}
          </li>
        ))}
      </ol>
      {current > 0 && compare && (
        <p className="mt-1 text-xs">
          {diff !== null ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                diff >= 0 ? 'text-success' : 'text-warning',
              )}
            >
              {diff >= 0 ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {diff >= 0 ? '+' : '−'}
              {formatInt(Math.abs(diff))} kg frente a la vez anterior
            </span>
          ) : previousLoading ? (
            <span className="text-muted-foreground">Comparando con la vez anterior…</span>
          ) : previousUnavailable ? (
            <span className="text-muted-foreground">
              La comparación con la vez anterior necesita conexión.
            </span>
          ) : (
            <span className="text-muted-foreground">Primera vez registrada.</span>
          )}
        </p>
      )}
    </div>
  )
}
