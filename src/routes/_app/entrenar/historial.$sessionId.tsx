import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CloudUpload, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { PairComparison } from '@/components/partners/pair'
import { ReceivedReactions } from '@/components/partners/reactions'
import { SessionBody } from '@/components/workout/session-view'
import { SyncBadge } from '@/components/workout/sync-badge'
import { SaveTemplateButton } from '@/components/workout/templates'
import { BackLink } from '@/components/layout/back-link'
import { useActiveSession } from '@/lib/workout/active-session'
import { isRepeatable } from '@/lib/workout/templates'
import { useStartFromStructure } from '@/lib/workout/templates-api'
import { listOutbox } from '@/lib/offline/outbox'
import {
  deleteSession,
  editSession,
  getLocalSession,
  rescheduleSession,
} from '@/lib/workout/active-session'
import { Sheet } from '@/components/ui/sheet'
import { WhenField } from '@/components/workout/when-field'
import { whenFromInstant, whenProblem, whenToMs } from '@/lib/workout/when'
import { sessionLogKey } from '@/lib/progress/hooks'
import type { LocalSession } from '@/lib/workout/types'
import { fetchPreviousPerformance, fetchSession, isOnline } from '@/lib/workout/api'
import { formatDateLong, formatTime } from '@/lib/workout/format'
import { historyQueryKey, useCatalog, useNow } from '@/lib/workout/hooks'
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
  const starter = useStartFromStructure(auth.userId)
  const active = useActiveSession()

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
        <BackLink to="/entrenar" label="Entrenar" />
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
      <BackLink to="/entrenar" label="Entrenar" />

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

      {session.endedAt && isRepeatable(session) && (
        <div className="grid grid-cols-2 gap-2">
          {!active.session && (
            <Button size="lg" disabled={starter.busy} onClick={() => void starter.repeat(session)}>
              <RotateCcw /> Repetir
            </Button>
          )}
          <SaveTemplateButton
            userId={auth.userId}
            session={session}
            className={active.session ? 'col-span-2' : undefined}
          />
        </div>
      )}
      {session.endedAt && (
        <ChangeDateButton
          session={session}
          onMoved={async (moved) => {
            queryClient.setQueryData(['session', moved.id], { session: moved, pending: true })
            for (const key of [
              historyQueryKey(auth.userId),
              sessionLogKey(auth.userId),
              ['exercise-set-counts'],
              ['weekly-review'],
              ['active-plan'],
              ['previous', moved.id],
            ])
              void queryClient.invalidateQueries({ queryKey: key })
          }}
        />
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

// «Cambiar fecha»: mueve la sesión a otro día u hora (sin fechas futuras). Se guarda en el móvil
// y se sube con la nueva fecha; récords, cumplimiento, mapa, carga y logros se recalculan.
function ChangeDateButton({
  session,
  onMoved,
}: {
  session: LocalSession
  onMoved: (moved: LocalSession) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState(() => whenFromInstant(session.startedAt))
  const [saving, setSaving] = useState(false)
  const initial = whenFromInstant(session.startedAt)
  const unchanged = when.date === initial.date && when.time === initial.time
  const now = useNow(30_000)
  const invalid = Boolean(whenProblem(when, now))

  async function save() {
    const ms = whenToMs(when)
    if (ms === null || invalid) return
    setSaving(true)
    try {
      const moved = await rescheduleSession(session, new Date(ms).toISOString())
      await onMoved(moved)
      notifySaved('Fecha cambiada')
      setOpen(false)
    } catch (error) {
      notifyError(error, 'cambiar la fecha')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => {
          setWhen(whenFromInstant(session.startedAt))
          setOpen(true)
        }}
      >
        <CalendarClock /> Cambiar fecha
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cambiar fecha y hora"
        footer={
          <Button
            size="lg"
            className="h-14 w-full text-lg"
            disabled={saving || invalid || unchanged}
            onClick={() => void save()}
          >
            {saving ? 'Guardando…' : 'Guardar fecha'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <WhenField id="change-when" label="¿Cuándo empezó?" value={when} onChange={setWhen} />
          <p className="text-muted-foreground text-sm">
            Se recalculan los récords, el cumplimiento de las semanas afectadas, la carga y los
            logros. La duración no cambia.
          </p>
        </div>
      </Sheet>
    </>
  )
}
