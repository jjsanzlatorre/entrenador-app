import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BookOpen, ChevronRight, CloudUpload, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Page } from '@/components/page'
import { StartSessionButtons } from '@/components/workout/start-session'
import { SyncBadge } from '@/components/workout/sync-badge'
import { loadActiveSession, useActiveSession } from '@/lib/workout/active-session'
import { sessionStats } from '@/lib/workout/calc'
import { formatDateShort, formatTime } from '@/lib/workout/format'
import { useCatalog, useHistory } from '@/lib/workout/hooks'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import { activityEmoji, activityKey, activityLabel } from '@/lib/activities/catalog'
import { cn } from '@/lib/utils'
import { historySummary } from '@/lib/workout/summary'

export const Route = createFileRoute('/_app/entrenar/')({
  ssr: false,
  component: TrainPage,
})

function TrainPage() {
  const { auth } = Route.useRouteContext()
  const userId = auth.userId
  const { session } = useActiveSession()
  const history = useHistory(userId)
  const catalog = useCatalog(userId)

  useEffect(() => {
    void loadActiveSession(userId)
  }, [userId])

  const stats = session ? sessionStats(session) : null
  // Filtro por tipo (deporte, clase o actividad personalizada) con los que hay en el historial.
  const [filter, setFilter] = useState<string | null>(null)
  const items = history.data?.items ?? []
  const kinds = [...new Set(items.map(activityKey))]
  const shown = filter ? items.filter((i) => activityKey(i) === filter) : items

  return (
    <Page title="Entrenar">
      {session ? (
        <Link
          to="/entrenar/sesion"
          className="bg-primary text-primary-foreground flex items-center gap-3 rounded-2xl p-4 shadow"
        >
          <Play className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">
              {session.mode === 'edit' ? 'Continuar edición' : 'Continuar sesión'}
            </p>
            <p className="truncate text-sm opacity-90">
              {session.title} · {stats?.completedSets ?? 0} series ·{' '}
              {session.mode === 'live' ? `desde las ${formatTime(session.startedAt)}` : 'editando'}
            </p>
          </div>
          <ChevronRight className="size-6" />
        </Link>
      ) : (
        <StartSessionButtons userId={userId} />
      )}

      <Button asChild variant="outline" size="lg" className="justify-between">
        <Link to="/entrenar/ejercicios">
          <span className="flex items-center gap-2">
            <BookOpen /> Biblioteca de ejercicios
          </span>
          <ChevronRight />
        </Link>
      </Button>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Historial</h2>
          <SyncBadge />
        </div>
        {history.data?.offline && (
          <p className="text-muted-foreground text-sm">
            Sin conexión: se muestran las sesiones guardadas en este móvil.
          </p>
        )}
        {history.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
        {history.data && history.data.items.length === 0 && (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
            Aún no has registrado ninguna sesión.
          </p>
        )}
        {kinds.length > 1 && (
          <div
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
            role="group"
            aria-label="Filtrar por tipo"
          >
            {[null, ...kinds].map((k) => (
              <button
                key={k ?? 'all'}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-3 text-sm font-medium whitespace-nowrap',
                  filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card',
                )}
              >
                {k ? `${activityEmoji(k)} ${activityLabel(k)}` : 'Todas'}
              </button>
            ))}
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                to="/entrenar/historial/$sessionId"
                params={{ sessionId: item.id }}
                className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="bg-muted flex w-12 shrink-0 flex-col items-center rounded-lg py-1 text-xs font-medium">
                  <span aria-hidden className="text-base">
                    {sessionTypeEmoji(item.sessionType, item.activityTypeId)}
                  </span>
                  {formatDateShort(item.startedAt)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {historySummary(item, (id) => catalog.byId.get(id)?.name ?? id)}
                  </p>
                </div>
                {item.pendingSync && (
                  <CloudUpload
                    className="text-warning size-5"
                    aria-label="Pendiente de sincronizar"
                  />
                )}
                <ChevronRight className="text-muted-foreground size-5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
