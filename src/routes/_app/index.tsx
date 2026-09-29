import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, MessageCircle, Play } from 'lucide-react'
import { WeeklyReviewCard } from '@/components/ai/weekly-review'
import { PairInviteCards } from '@/components/partners/pair'
import { ReactionsNotice } from '@/components/partners/reactions'
import { Page } from '@/components/page'
import { UsCard, WeekAdherenceCard } from '@/components/progress/adherence'
import { MonthSummaryPopup } from '@/components/progress/achievements'
import { AcwrAlert } from '@/components/progress/load'
import { CheckinCard } from '@/components/today/checkin-card'
import { TodayPlan } from '@/components/today/today-plan'
import { StartSessionButtons } from '@/components/workout/start-session'
import { localDateKey } from '@/lib/progress/dates'
import { loadActiveSession, useActiveSession } from '@/lib/workout/active-session'
import { sessionStats } from '@/lib/workout/calc'
import { useTrainingProfile } from '@/lib/plan/hooks'
import { useAiStatus, useWeeklyReview } from '@/lib/ai/client'

export const Route = createFileRoute('/_app/')({
  component: TodayPage,
})

function TodayPage() {
  const { auth } = Route.useRouteContext()
  const { session } = useActiveSession()
  const name = auth.profile.display_name
  const navigate = useNavigate()
  const training = useTrainingProfile(auth.userId)
  const today = localDateKey(new Date())
  const ai = useAiStatus()
  // La revisión de la semana pasada se genera sola la primera vez que se abre la app en la
  // semana (una vez por dispositivo); después se lee la guardada.
  const review = useWeeklyReview(auth.userId, {
    auto: training.data != null,
    enabled: training.isFetched,
  })

  useEffect(() => {
    void loadActiveSession(auth.userId)
  }, [auth.userId])

  // Primera vez (sin perfil de entrenamiento): onboarding. Sin conexión y sin copia no se sabe,
  // así que no se redirige.
  const needsOnboarding = training.isSuccess && training.data === null
  useEffect(() => {
    if (needsOnboarding) void navigate({ to: '/onboarding', replace: true })
  }, [needsOnboarding, navigate])

  return (
    <Page title={name ? `Hola, ${name}` : 'Hoy'}>
      <WeekAdherenceCard userId={auth.userId} />
      <ReactionsNotice userId={auth.userId} />
      <AcwrAlert userId={auth.userId} />
      <PairInviteCards userId={auth.userId} canStart={!session} />
      {session ? (
        <Link
          to="/entrenar/sesion"
          className="bg-primary text-primary-foreground flex items-center gap-3 rounded-2xl p-4 shadow"
        >
          <Play className="size-8 shrink-0" />
          <div className="flex-1">
            <p className="text-lg font-bold">Continuar sesión</p>
            <p className="text-sm opacity-90">
              {session.title} · {sessionStats(session).completedSets} series hechas
            </p>
          </div>
          <ChevronRight className="size-6" />
        </Link>
      ) : null}
      <WeeklyReviewCard review={review} />
      <TodayPlan userId={auth.userId} today={today} sex={auth.profile.sex} canStart={!session} />
      {!session && <StartSessionButtons userId={auth.userId} label="Entreno libre" />}
      <CheckinCard userId={auth.userId} today={today} />
      {ai.data?.configured && (
        <Link
          to="/entrenador"
          className="bg-muted flex items-center gap-3 rounded-2xl p-3 text-sm font-medium"
        >
          <MessageCircle className="text-primary size-5" />
          <span className="flex-1">Pregunta a tu entrenador</span>
          <ChevronRight className="size-5" />
        </Link>
      )}
      <UsCard userId={auth.userId} myName={name ?? 'Yo'} />
      {!session && <MonthSummaryPopup profile={auth.profile} />}
    </Page>
  )
}
