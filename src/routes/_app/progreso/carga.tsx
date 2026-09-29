import { createFileRoute } from '@tanstack/react-router'
import { BackLink } from '@/components/progress/common'
import { useHasActivePlan } from '@/components/progress/load'
import { LoadView } from '@/components/progress/load-view'
import { useSessionLog } from '@/lib/progress/hooks'

export const Route = createFileRoute('/_app/progreso/carga')({
  ssr: false,
  component: LoadPage,
})

function LoadPage() {
  const { auth } = Route.useRouteContext()
  const log = useSessionLog(auth.userId)
  const hasActivePlan = useHasActivePlan(auth.userId)
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Carga</h1>
      {log.isPending ? (
        <p className="text-muted-foreground text-center">Cargando…</p>
      ) : (
        <LoadView sessions={log.data?.sessions ?? []} hasActivePlan={hasActivePlan} />
      )}
    </div>
  )
}
