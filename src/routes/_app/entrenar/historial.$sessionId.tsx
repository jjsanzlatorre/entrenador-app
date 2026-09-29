import { useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, CloudUpload, Pencil, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { PairComparison } from '@/components/partners/pair'
import { ReceivedReactions } from '@/components/partners/reactions'
import { SessionBody } from '@/components/workout/session-view'
import { SyncBadge } from '@/components/workout/sync-badge'
import { listOutbox } from '@/lib/offline/outbox'
import { deleteSession, editSession, getLocalSession } from '@/lib/workout/active-session'
import { fetchPreviousPerformance, fetchSession, isOnline } from '@/lib/workout/api'
import { formatDateLong, formatTime } from '@/lib/workout/format'
import { historyQueryKey, useCatalog } from '@/lib/workout/hooks'
import { totalDistanceM } from '@/lib/workout/session-ops'
import { CARDIO_TYPES, sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import { fetchSessionRecords } from '@/lib/progress/api'
import { HomeCityPrompt, SessionMilestonePopup } from '@/components/progress/achievements'
import { notifyError, notifySaved } from '@/lib/notify'

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

  const cardio = CARDIO_TYPES.has(session.sessionType)
  const distance = session.distanceM ?? totalDistanceM(session)

  async function handleEdit() {
    if (!session) return
    try {
      await editSession(session)
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'abrir la sesión para editarla')
    }
  }

  async function handleDelete() {
    if (!session || !confirm('¿Borrar esta sesión? No se puede deshacer.')) return
    try {
      await deleteSession(session.id, session.userId)
    } catch (error) {
      notifyError(error, 'borrar la sesión')
      return
    }
    notifySaved('Sesión borrada')
    await queryClient.invalidateQueries({ queryKey: historyQueryKey(auth.userId) })
    queryClient.removeQueries({ queryKey: ['session', session.id] })
    await navigate({ to: '/entrenar', replace: true })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />

      {nueva ? (
        <div className="rounded-2xl bg-emerald-700 p-4 text-white">
          <p className="text-2xl font-bold">¡Sesión guardada! 💪</p>
          <p className="text-sm opacity-90">
            {query.data?.pending
              ? 'Guardada en el móvil. Se subirá sola en cuanto haya conexión.'
              : 'Guardada y sincronizada.'}
          </p>
        </div>
      ) : null}
      {nueva && session.endedAt ? (
        <SessionMilestonePopup
          profile={auth.profile}
          sessionId={session.id}
          startedAt={session.startedAt}
        />
      ) : null}
      {nueva && cardio && distance && !auth.profile.home_city ? (
        <HomeCityPrompt from="sesion" />
      ) : null}

      <div>
        <h1 className="text-2xl font-bold">
          <span aria-hidden>{sessionTypeEmoji(session.sessionType, session.activityTypeId)} </span>
          {session.title || 'Entreno'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {sessionTypeLabel(session.sessionType, session.activityTypeId)} ·{' '}
          <span className="first-letter:uppercase">{formatDateLong(session.startedAt)}</span> ·{' '}
          {formatTime(session.startedAt)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {query.data?.pending && (
            <span className="text-warning inline-flex items-center gap-1 text-xs">
              <CloudUpload className="size-4" /> Pendiente de sincronizar
            </span>
          )}
          <SyncBadge />
        </div>
      </div>

      <SessionBody
        session={session}
        byId={catalog.byId}
        records={{
          pending,
          loading: prs.isPending && prs.fetchStatus !== 'idle',
          unavailable: prs.isError,
          list: prs.data,
        }}
        previous={{
          data: previous.data,
          loading: previous.isPending && previous.fetchStatus !== 'idle',
          unavailable: previous.isError,
        }}
        renderExerciseLink={(exerciseId, className, children) => (
          <Link to="/progreso/ejercicio/$exerciseId" params={{ exerciseId }} className={className}>
            {children}
          </Link>
        )}
      />

      {session.pairGroupId && session.endedAt && (
        <PairComparison userId={auth.userId} session={session} byId={catalog.byId} />
      )}
      {session.endedAt && !pending && (
        <ReceivedReactions userId={auth.userId} kind="session" targetKey={session.id} />
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
