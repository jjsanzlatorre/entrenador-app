import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight, Play } from 'lucide-react'
import { ComingSoon, Page } from '@/components/page'
import { StartSessionButtons } from '@/components/workout/start-session'
import { loadActiveSession, useActiveSession } from '@/lib/workout/active-session'
import { sessionStats } from '@/lib/workout/calc'

export const Route = createFileRoute('/_app/')({
  component: TodayPage,
})

function TodayPage() {
  const { auth } = Route.useRouteContext()
  const { session } = useActiveSession()
  const name = auth.profile.display_name

  useEffect(() => {
    void loadActiveSession(auth.userId)
  }, [auth.userId])

  return (
    <Page title={name ? `Hola, ${name}` : 'Hoy'}>
      <ComingSoon phase={3}>Aquí verás tu barra de cumplimiento de la semana.</ComingSoon>
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
      ) : (
        <StartSessionButtons userId={auth.userId} label="Entreno libre" />
      )}
      <ComingSoon phase={5}>La sesión planificada para hoy.</ComingSoon>
    </Page>
  )
}
