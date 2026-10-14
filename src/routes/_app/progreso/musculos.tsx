import { createFileRoute } from '@tanstack/react-router'
import { Tip } from '@/components/help/tip'
import { BackLink } from '@/components/progress/common'
import { MuscleMapView } from '@/components/progress/muscle-map-view'

export const Route = createFileRoute('/_app/progreso/musculos')({
  ssr: false,
  component: MusclesPage,
})

function MusclesPage() {
  const { auth } = Route.useRouteContext()
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Mapa muscular</h1>
      <Tip id="muscles" title="Series efectivas">
        Cada serie cuenta 1 en los músculos principales y 0,5 en los secundarios; el cardio y los
        deportes suman una parte aproximada. Toca un músculo para ver de dónde salen.
      </Tip>
      <MuscleMapView owner={{ viewerId: auth.userId, userId: auth.userId }} />
    </div>
  )
}
