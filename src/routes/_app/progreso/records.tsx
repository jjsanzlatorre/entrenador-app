import { createFileRoute, Link } from '@tanstack/react-router'
import { BackLink } from '@/components/progress/common'
import { RecordsList } from '@/components/progress/records-list'

export const Route = createFileRoute('/_app/progreso/records')({
  ssr: false,
  component: RecordsPage,
})

function RecordsPage() {
  const { auth } = Route.useRouteContext()
  const owner = { viewerId: auth.userId, userId: auth.userId }
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Récords y gráficas</h1>
      <RecordsList
        owner={owner}
        emptyText="Termina alguna sesión y aquí verás tus marcas por ejercicio."
        renderLink={(exerciseId, className, children) => (
          <Link to="/progreso/ejercicio/$exerciseId" params={{ exerciseId }} className={className}>
            {children}
          </Link>
        )}
      />
    </div>
  )
}
