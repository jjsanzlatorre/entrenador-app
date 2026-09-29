import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { z } from 'zod'
import { ReactionBar } from '@/components/partners/reactions'
import { AdherenceOverview } from '@/components/progress/adherence'
import { AchievementsView } from '@/components/progress/achievements-view'
import { MetricsChart, MetricsReadOnlyList } from '@/components/progress/body-metrics'
import { LoadView } from '@/components/progress/load-view'
import { MuscleMapView } from '@/components/progress/muscle-map-view'
import { RecordsList } from '@/components/progress/records-list'
import { Button } from '@/components/ui/button'
import { fetchPartnerHome } from '@/lib/partners/api'
import {
  useOwnerCatalog,
  useOwnerSessionLog,
  usePartnerLink,
  type DataOwner,
} from '@/lib/partners/hooks'
import { currentCommitment } from '@/lib/progress/adherence'
import { fetchBodyMetrics, fetchShownMilestones, type SharePerm } from '@/lib/progress/api'
import { localDateKey, weekStartOf } from '@/lib/progress/dates'
import type { EquivalenceContext } from '@/lib/progress/equivalences'
import { useEquivalenceCatalog, usePartnerAdherence } from '@/lib/progress/hooks'
import { fetchHistory } from '@/lib/workout/api'
import { formatDateShort } from '@/lib/workout/format'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import { historySummary } from '@/lib/workout/summary'
import { cn } from '@/lib/utils'

const SECTIONS: { key: SharePerm; label: string }[] = [
  { key: 'adherence', label: 'Cumplimiento' },
  { key: 'sessions', label: 'Entrenos' },
  { key: 'muscles', label: 'Músculos' },
  { key: 'achievements', label: 'Logros' },
  { key: 'metrics', label: 'Medidas' },
]

export const Route = createFileRoute('/_app/pareja/$partnerId/')({
  ssr: false,
  validateSearch: z.object({
    ver: z.enum(['adherence', 'sessions', 'muscles', 'achievements', 'metrics']).optional(),
  }),
  component: PartnerEvolutionPage,
})

// «Evolución de {nombre}»: solo lectura y solo las secciones que esa persona me comparte.
function PartnerEvolutionPage() {
  const { partnerId } = Route.useParams()
  const { ver } = Route.useSearch()
  const { auth } = Route.useRouteContext()
  const { link, isPending, error } = usePartnerLink(auth.userId, partnerId)
  const owner: DataOwner = { viewerId: auth.userId, userId: partnerId }

  const back = (
    <Link to="/" className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium">
      <ChevronLeft className="size-4" /> Hoy
    </Link>
  )

  if (isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  if (!link) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {back}
        <p className="text-muted-foreground">
          {error ? error.message : 'Ya no estás vinculado con esta persona.'}
        </p>
      </div>
    )
  }

  const sections = SECTIONS.filter((s) => link.theyShare[s.key])
  const active = sections.find((s) => s.key === ver)?.key ?? sections[0]?.key
  const name = link.displayName

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        {back}
        <Button asChild variant="ghost" size="sm">
          <Link to="/perfil/vinculos/$partnerId" params={{ partnerId }}>
            <Settings /> Qué comparto
          </Link>
        </Button>
      </div>
      <h1 className="text-2xl font-bold">Evolución de {name}</h1>

      {sections.length === 0 ? (
        <p className="text-muted-foreground">{name} aún no te comparte nada.</p>
      ) : (
        <>
          {sections.length > 1 && (
            <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label="Secciones">
              {sections.map((s) => (
                <Link
                  key={s.key}
                  to="/pareja/$partnerId"
                  params={{ partnerId }}
                  search={{ ver: s.key }}
                  replace
                  aria-current={s.key === active ? 'page' : undefined}
                  className={cn(
                    'h-9 shrink-0 rounded-full border px-3 text-sm leading-9 font-medium',
                    s.key === active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card',
                  )}
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          )}
          {active === 'adherence' && (
            <AdherenceSection userId={auth.userId} partnerId={partnerId} name={name} />
          )}
          {active === 'sessions' && <SessionsSection owner={owner} />}
          {active === 'muscles' && <MusclesSection owner={owner} />}
          {active === 'achievements' && <AchievementsSection owner={owner} />}
          {active === 'metrics' && <MetricsSection partnerId={partnerId} name={name} />}
        </>
      )}
      <p className="text-muted-foreground text-xs">
        Solo lectura. {name} decide qué te comparte y puede dejar de hacerlo cuando quiera.
      </p>
    </div>
  )
}

function AdherenceSection({
  userId,
  partnerId,
  name,
}: {
  userId: string
  partnerId: string
  name: string
}) {
  const data = usePartnerAdherence(partnerId)
  const today = localDateKey(new Date())
  if (data.isPending) return <p className="text-muted-foreground text-center">Cargando…</p>
  if (data.isError) return <p className="text-destructive text-sm">{data.error.message}</p>
  const { commitments, days } = data.data
  return (
    <>
      {currentCommitment(commitments, today) ? (
        <AdherenceOverview commitments={commitments} days={days} today={today} self={false} />
      ) : (
        <p className="text-muted-foreground text-sm">
          {commitments.length === 0
            ? `${name} aún no ha definido su compromiso.`
            : `Ahora mismo ${name} no tiene compromiso.`}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Reacciona a su semana</p>
        <ReactionBar
          userId={userId}
          to={partnerId}
          toName={name}
          kind="week"
          targetKey={weekStartOf(today)}
        />
      </div>
    </>
  )
}

function SessionsSection({ owner }: { owner: DataOwner }) {
  const partnerId = owner.userId
  const catalog = useOwnerCatalog(owner)
  const history = useQuery({
    queryKey: ['partner-history', partnerId],
    queryFn: () => fetchHistory(partnerId),
    staleTime: 30_000,
  })
  const items = (history.data ?? []).filter((i) => i.endedAt)
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Historial</h2>
        {history.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
        {history.isError && <p className="text-destructive text-sm">{history.error.message}</p>}
        {history.data && items.length === 0 && (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
            Aún no hay sesiones.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/pareja/$partnerId/sesion/$sessionId"
                params={{ partnerId, sessionId: item.id }}
                className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="bg-muted flex w-12 shrink-0 flex-col items-center rounded-lg py-1 text-xs font-medium">
                  <span aria-hidden className="text-base">
                    {sessionTypeEmoji(item.sessionType)}
                  </span>
                  {formatDateShort(item.startedAt)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {historySummary(item, (id) => catalog.byId.get(id)?.name ?? id)}
                  </p>
                </div>
                <ChevronRight className="text-muted-foreground size-5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Récords y gráficas</h2>
        <RecordsList
          owner={owner}
          emptyText="Aún no hay récords."
          renderLink={(exerciseId, className, children) => (
            <Link
              to="/pareja/$partnerId/ejercicio/$exerciseId"
              params={{ partnerId, exerciseId }}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      </section>
    </>
  )
}

function MusclesSection({ owner }: { owner: DataOwner }) {
  const log = useOwnerSessionLog(owner)
  return (
    <>
      <h2 className="text-lg font-semibold">Mapa muscular</h2>
      <MuscleMapView owner={owner} />
      <h2 className="text-lg font-semibold">Carga</h2>
      {log.isPending ? (
        <p className="text-muted-foreground text-center">Cargando…</p>
      ) : (
        <LoadView sessions={log.data?.sessions ?? []} hasActivePlan={false} self={false} />
      )}
    </>
  )
}

function AchievementsSection({ owner }: { owner: DataOwner }) {
  const partnerId = owner.userId
  const log = useOwnerSessionLog(owner)
  const catalog = useEquivalenceCatalog()
  const home = useQuery({
    queryKey: ['partner-home', partnerId],
    queryFn: () => fetchPartnerHome(partnerId),
    staleTime: 60_000,
  })
  const milestones = useQuery({
    queryKey: ['partner-milestones', partnerId],
    queryFn: () => fetchShownMilestones(partnerId),
    staleTime: 60_000,
  })
  const ctx = useMemo<EquivalenceContext | null>(
    () => (catalog.data ? { ...catalog.data, home: home.data ?? null } : null),
    [catalog.data, home.data],
  )
  if (log.isPending || catalog.isPending || home.isPending) {
    return <p className="text-muted-foreground text-center">Cargando…</p>
  }
  return (
    <AchievementsView
      sessions={log.data?.sessions ?? []}
      offline={false}
      ctx={ctx}
      catalogError={catalog.isError}
      milestones={milestones.data ?? []}
      self={false}
    />
  )
}

function MetricsSection({ partnerId, name }: { partnerId: string; name: string }) {
  const metrics = useQuery({
    queryKey: ['partner-metrics', partnerId],
    queryFn: () => fetchBodyMetrics(partnerId),
    staleTime: 60_000,
  })
  if (metrics.isPending) return <p className="text-muted-foreground text-center">Cargando…</p>
  if (metrics.isError) return <p className="text-destructive text-sm">{metrics.error.message}</p>
  const list = metrics.data
  if (list.length === 0) {
    return <p className="text-muted-foreground text-sm">{name} aún no ha registrado medidas.</p>
  }
  return (
    <>
      <MetricsChart list={list} />
      <MetricsReadOnlyList list={list} />
    </>
  )
}
