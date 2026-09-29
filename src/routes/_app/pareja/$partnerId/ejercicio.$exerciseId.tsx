import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { ExerciseProgressView } from '@/components/progress/exercise-progress-view'
import { usePartnerLink } from '@/lib/partners/hooks'

export const Route = createFileRoute('/_app/pareja/$partnerId/ejercicio/$exerciseId')({
  ssr: false,
  component: PartnerExercisePage,
})

// Récords y gráficas de un ejercicio de una persona que comparte sus entrenos (solo lectura).
function PartnerExercisePage() {
  const { partnerId, exerciseId } = Route.useParams()
  const { auth } = Route.useRouteContext()
  const { link } = usePartnerLink(auth.userId, partnerId)
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/pareja/$partnerId"
        params={{ partnerId }}
        search={{ ver: 'sessions' }}
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> {link ? `Evolución de ${link.displayName}` : 'Volver'}
      </Link>
      {link && <p className="text-muted-foreground -mb-2 text-sm">{link.displayName}</p>}
      <ExerciseProgressView
        owner={{ viewerId: auth.userId, userId: partnerId }}
        exerciseId={exerciseId}
      />
    </div>
  )
}
