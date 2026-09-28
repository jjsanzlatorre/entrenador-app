import { useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, CloudUpload, Pencil, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SyncBadge } from '@/components/workout/sync-badge'
import { listOutbox } from '@/lib/offline/outbox'
import { deleteSession, editSession, getLocalSession } from '@/lib/workout/active-session'
import { fetchPreviousPerformance, fetchSession, isOnline } from '@/lib/workout/api'
import { effectiveSetsByMuscle, sessionStats, tonnage } from '@/lib/workout/calc'
import { setFields } from '@/lib/workout/fields'
import { formatClock, formatDateLong, formatInt, formatKg, formatTime } from '@/lib/workout/format'
import { historyQueryKey, useCatalog } from '@/lib/workout/hooks'
import { muscleName } from '@/lib/workout/labels'
import {
  formatDistance,
  formatPace,
  paceKindForExercise,
  paceKindForSession,
} from '@/lib/workout/pace'
import { totalDistanceM } from '@/lib/workout/session-ops'
import { CARDIO_TYPES, sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { isTimedBlock } from '@/lib/workout/timed-blocks'
import type { Exercise, SetEntry } from '@/lib/workout/types'
import { BLOCK_LABELS, describeTimer, resultSummary } from '@/components/workout/timed-block-card'
import { cn } from '@/lib/utils'
import { fetchSessionRecords } from '@/lib/progress/api'
import {
  formatPrevious,
  formatRecordValue,
  PR_LABELS,
  sessionImprovements,
  type PersonalRecord,
} from '@/lib/progress/records'
import type { SessionType } from '@/types/database'

const QUICK_TYPES = new Set<SessionType>(['yoga', 'surf', 'padel_fronton', 'other'])

export const Route = createFileRoute('/_app/entrenar/historial/$sessionId')({
  ssr: false,
  validateSearch: z.object({ nueva: z.coerce.number().optional() }),
  component: SessionDetailPage,
})

// Lee la sesión: la copia local si está pendiente de subir (o no hay red); si no, el servidor.
async function loadSession(sessionId: string, userId: string) {
  const local = await getLocalSession(sessionId)
  const pending = (await listOutbox(userId)).find((i) => i.sessionId === sessionId)
  if (local && (pending?.kind === 'save' || !isOnline())) return { session: local, pending: true }
  try {
    const remote = await fetchSession(sessionId)
    if (remote) return { session: remote, pending: false }
  } catch (error) {
    if (local) return { session: local, pending: Boolean(pending) }
    throw error
  }
  if (local) return { session: local, pending: Boolean(pending) }
  return null
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams()
  const { nueva } = Route.useSearch()
  const { auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useCatalog(auth.userId)

  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => loadSession(sessionId, auth.userId),
    networkMode: 'always',
  })
  const session = query.data?.session ?? null

  const exerciseIds = useMemo(
    () =>
      session
        ? [...new Set(session.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)))]
        : [],
    [session],
  )
  const previous = useQuery({
    queryKey: ['previous', sessionId, exerciseIds],
    queryFn: () => fetchPreviousPerformance(exerciseIds, sessionId, session?.startedAt ?? ''),
    enabled: Boolean(session?.startedAt) && exerciseIds.length > 0,
    networkMode: 'always',
    retry: false,
  })

  const pending = query.data?.pending ?? false
  const prs = useQuery({
    queryKey: ['session-prs', sessionId],
    queryFn: () => fetchSessionRecords(sessionId),
    enabled: Boolean(session?.endedAt) && !pending,
    networkMode: 'always',
    retry: false,
  })

  if (query.isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  if (query.isError || !session) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <BackLink />
        <p className="text-muted-foreground">
          {query.isError ? query.error.message : 'No se ha encontrado la sesión.'}
        </p>
      </div>
    )
  }

  const stats = sessionStats(session)
  const muscles = effectiveSetsByMuscle(
    session.blocks.flatMap((b) => b.sets),
    catalog.byId,
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

  async function handleEdit() {
    if (!session) return
    try {
      await editSession(session)
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDelete() {
    if (!session || !confirm('¿Borrar esta sesión? No se puede deshacer.')) return
    await deleteSession(session.id, session.userId)
    await queryClient.invalidateQueries({ queryKey: historyQueryKey(auth.userId) })
    queryClient.removeQueries({ queryKey: ['session', session.id] })
    await navigate({ to: '/entrenar', replace: true })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />

      {nueva ? (
        <div className="rounded-2xl bg-emerald-600 p-4 text-white">
          <p className="text-2xl font-bold">¡Sesión guardada! 💪</p>
          <p className="text-sm opacity-90">
            {query.data?.pending
              ? 'Guardada en el móvil. Se subirá sola en cuanto haya conexión.'
              : 'Guardada y sincronizada.'}
          </p>
        </div>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold">
          <span aria-hidden>{sessionTypeEmoji(session.sessionType)} </span>
          {session.title || 'Entreno'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {sessionTypeLabel(session.sessionType)} ·{' '}
          <span className="first-letter:uppercase">{formatDateLong(session.startedAt)}</span> ·{' '}
          {formatTime(session.startedAt)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {query.data?.pending && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
              <CloudUpload className="size-4" /> Pendiente de sincronizar
            </span>
          )}
          <SyncBadge />
        </div>
      </div>

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
          pending={pending}
          loading={prs.isPending && prs.fetchStatus !== 'idle'}
          unavailable={prs.isError}
          records={prs.data ? sessionImprovements(prs.data) : []}
          names={(id) => catalog.byId.get(id)?.name ?? id}
        />
      )}

      {muscles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Músculos trabajados</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {muscles.map((m) => (
                <li
                  key={m.muscleId}
                  className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm"
                >
                  <span className="truncate">{muscleName(m.muscleId)}</span>
                  <span className="bg-muted h-2.5 overflow-hidden rounded-full">
                    <span
                      className="bg-primary block h-full rounded-full"
                      style={{ width: `${(m.sets / maxMuscle) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{formatKg(m.sets)}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">
              Series efectivas: 1 por músculo principal y 0,5 por secundario. El mapa corporal llega
              en la fase 4.
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
                      const exercise = catalog.byId.get(be.exerciseId)
                      const sets = block.sets.filter((s) => s.exerciseId === be.exerciseId)
                      const prev = previous.data?.get(be.exerciseId)
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
                          previousLoading={previous.isPending && previous.fetchStatus !== 'idle'}
                          previousUnavailable={previous.isError}
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

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={() => void handleEdit()}>
          <Pencil /> Editar
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="text-destructive"
          onClick={() => void handleDelete()}
        >
          <Trash2 /> Borrar
        </Button>
      </div>
      {nueva ? (
        <Button size="lg" asChild>
          <Link to="/">Volver a Hoy</Link>
        </Button>
      ) : null}
    </div>
  )
}

function SessionRecords({
  pending,
  loading,
  unavailable,
  records,
  names,
}: {
  pending: boolean
  loading: boolean
  unavailable: boolean
  records: PersonalRecord[]
  names: (exerciseId: string) => string
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
    <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
      <CardHeader>
        <CardTitle>
          🏆 {records.length === 1 ? 'Nuevo récord' : `${records.length} récords nuevos`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5 text-sm">
          {records.map((r) => (
            <li key={r.id}>
              <Link
                to="/progreso/ejercicio/$exerciseId"
                params={{ exerciseId: r.exerciseId }}
                className="flex flex-wrap items-baseline gap-x-1.5"
              >
                <span className="font-semibold">{names(r.exerciseId)}</span>
                <span className="text-muted-foreground">{PR_LABELS[r.prType]}:</span>
                <strong className="tabular-nums">{formatRecordValue(r)}</strong>
                <span className="text-muted-foreground text-xs">({formatPrevious(r)})</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function BackLink() {
  return (
    <Link
      to="/entrenar"
      className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
    >
      <ChevronLeft className="size-4" /> Entrenar
    </Link>
  )
}

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
  previousLoading,
  previousUnavailable,
}: {
  name: string
  exercise: Exercise | undefined
  superset: boolean
  sets: SetEntry[]
  previousTonnage: number | null
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
      {current > 0 && (
        <p className="mt-1 text-xs">
          {diff !== null ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                diff >= 0 ? 'text-emerald-600' : 'text-amber-600',
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
