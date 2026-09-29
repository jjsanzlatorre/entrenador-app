import { createFileRoute } from '@tanstack/react-router'
import { BackLink } from '@/components/progress/common'
import { ExerciseProgressView } from '@/components/progress/exercise-progress-view'

export const Route = createFileRoute('/_app/progreso/ejercicio/$exerciseId')({
  ssr: false,
  component: ExerciseProgressPage,
})

function ExerciseProgressPage() {
  const { exerciseId } = Route.useParams()
  const { auth } = Route.useRouteContext()
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/progreso/records" label="Récords" />
      <ExerciseProgressView
        owner={{ viewerId: auth.userId, userId: auth.userId }}
        exerciseId={exerciseId}
      />
    </div>
  )
}
