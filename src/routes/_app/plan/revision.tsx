import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, MessageCircle } from 'lucide-react'
import { WeeklyReviewView } from '@/components/ai/weekly-review'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { useWeeklyReview } from '@/lib/ai/client'
import { useCatalog } from '@/lib/workout/hooks'

export const Route = createFileRoute('/_app/plan/revision')({
  ssr: false,
  component: ReviewPage,
})

function ReviewPage() {
  const { auth } = Route.useRouteContext()
  const review = useWeeklyReview(auth.userId, { auto: true })
  const catalog = useCatalog(auth.userId)
  const name = (id: string) => catalog.byId.get(id)?.name ?? id
  return (
    <Page title="Revisión semanal">
      <div className="-mt-2 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/plan">
            <ChevronLeft /> Plan
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/entrenador">
            <MessageCircle /> Preguntar
          </Link>
        </Button>
      </div>
      <WeeklyReviewView userId={auth.userId} review={review} sex={auth.profile.sex} name={name} />
    </Page>
  )
}
