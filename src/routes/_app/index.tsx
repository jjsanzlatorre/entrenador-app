import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, MessageCircle, Play } from 'lucide-react'
import { Tip } from '@/components/help/tip'
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
      {/* Primero lo importante: la sesión en curso o la de hoy, empezar y la semana. */}
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
      <PairInviteCards userId={auth.userId} canStart={!session} />
      <TodayPlan userId={auth.userId} today={today} sex={auth.profile.sex} canStart={!session} />
      {!session && <StartSessionButtons userId={auth.userId} label="Entreno libre" />}
      <WeekAdherenceCard userId={auth.userId} />
      <AcwrAlert userId={auth.userId} />
      <Tip id="today" title="Tu día de un vistazo">
        Arriba, lo que toca hoy y el botón para empezar; en «Empezar entreno» puedes repetir el
        último o usar una plantilla. Lo demás está en «Más de hoy».
      </Tip>
      <ReactionsNotice userId={auth.userId} />
      <MoreToday>
        <WeeklyReviewCard review={review} />
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
      </MoreToday>
      {!session && <MonthSummaryPopup profile={auth.profile} />}
    </Page>
  )
}

const MORE_KEY = 'today-more-open'

// «Más de hoy»: check-in, revisión semanal, entrenador y pareja, plegados (se recuerda en el
// dispositivo). El contenido se monta igualmente (la revisión semanal se genera sola).
function MoreToday({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(MORE_KEY) === '1'
    } catch {
      return false
    }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(MORE_KEY, next ? '1' : '0')
    } catch {
      // sin almacenamiento: no se recuerda
    }
  }
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="today-more"
        onClick={toggle}
        className="bg-card flex min-h-12 items-center gap-2 rounded-2xl border px-4 py-2 text-left"
      >
        <span className="flex-1">
          <span className="block font-semibold">Más de hoy</span>
          <span className="text-muted-foreground block text-xs">
            Check-in, revisión semanal, entrenador y pareja
          </span>
        </span>
        <ChevronDown
          className={
            open ? 'size-5 rotate-180 transition-transform' : 'size-5 transition-transform'
          }
        />
      </button>
      <div id="today-more" hidden={!open} className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  )
}
