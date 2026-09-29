import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { ReactionBar } from '@/components/partners/reactions'
import { SessionBody } from '@/components/workout/session-view'
import { fetchPartnerSession } from '@/lib/partners/api'
import { useOwnerCatalog, usePartnerLink } from '@/lib/partners/hooks'
import { fetchSessionRecords } from '@/lib/progress/api'
import { formatDateLong, formatTime } from '@/lib/workout/format'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'

export const Route = createFileRoute('/_app/pareja/$partnerId/sesion/$sessionId')({
  ssr: false,
  component: PartnerSessionPage,
})

// Sesión de una persona vinculada que comparte sus entrenos: solo lectura (sin editar, borrar ni
// comparar con «la vez anterior»), con reacciones.
function PartnerSessionPage() {
  const { partnerId, sessionId } = Route.useParams()
  const { auth } = Route.useRouteContext()
  const { link } = usePartnerLink(auth.userId, partnerId)
  const owner = { viewerId: auth.userId, userId: partnerId }
  const catalog = useOwnerCatalog(owner)
  const query = useQuery({
    queryKey: ['partner-session', partnerId, sessionId],
    queryFn: () => fetchPartnerSession(partnerId, sessionId),
  })
  const prs = useQuery({
    queryKey: ['session-prs', sessionId],
    queryFn: () => fetchSessionRecords(sessionId),
    enabled: Boolean(query.data?.endedAt),
    retry: false,
  })
  const session = query.data

  const back = (
    <Link
      to="/pareja/$partnerId"
      params={{ partnerId }}
      search={{ ver: 'sessions' }}
      className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
    >
      <ChevronLeft className="size-4" /> {link ? `Evolución de ${link.displayName}` : 'Volver'}
    </Link>
  )

  if (query.isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  if (query.isError || !session) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {back}
        <p className="text-muted-foreground">
          {query.isError ? query.error.message : 'No se ha encontrado la sesión.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {back}
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
      </div>
      {link && session.endedAt && (
        <ReactionBar
          userId={auth.userId}
          to={partnerId}
          toName={link.displayName}
          kind="session"
          targetKey={session.id}
        />
      )}
      <SessionBody
        session={session}
        byId={catalog.byId}
        records={{
          pending: false,
          loading: prs.isPending && prs.fetchStatus !== 'idle',
          unavailable: prs.isError,
          list: prs.data,
        }}
        previous={null}
        renderExerciseLink={(exerciseId, className, children) => (
          <Link
            to="/pareja/$partnerId/ejercicio/$exerciseId"
            params={{ partnerId, exerciseId }}
            className={className}
          >
            {children}
          </Link>
        )}
      />
    </div>
  )
}
