import { createFileRoute } from '@tanstack/react-router'
import { useEquivalenceContext } from '@/components/progress/achievements'
import { AchievementsView } from '@/components/progress/achievements-view'
import { BackLink } from '@/components/progress/common'
import { useSessionLog, useShownMilestones } from '@/lib/progress/hooks'

export const Route = createFileRoute('/_app/progreso/logros')({
  ssr: false,
  component: AchievementsPage,
})

function AchievementsPage() {
  const { auth } = Route.useRouteContext()
  const log = useSessionLog(auth.userId)
  const shown = useShownMilestones(auth.userId)
  const { ctx, isPending: catalogPending, error } = useEquivalenceContext(auth.profile)

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Mis logros</h1>
      {log.isPending || catalogPending ? (
        <p className="text-muted-foreground p-6 text-center">Cargando…</p>
      ) : (
        <AchievementsView
          sessions={log.data?.sessions ?? []}
          offline={log.data?.offline ?? false}
          ctx={ctx}
          catalogError={Boolean(error)}
          milestones={shown.data?.items ?? []}
        />
      )}
    </div>
  )
}
