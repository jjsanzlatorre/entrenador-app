import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Dumbbell, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ComingSoon, Page } from '@/components/page'
import { loadActiveSession, startNewSession, useActiveSession } from '@/lib/workout/active-session'
import { sessionStats } from '@/lib/workout/calc'

export const Route = createFileRoute('/_app/')({
  component: TodayPage,
})

function TodayPage() {
  const { auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const { session } = useActiveSession()
  const name = auth.profile.display_name

  useEffect(() => {
    void loadActiveSession(auth.userId)
  }, [auth.userId])

  async function start() {
    await startNewSession(auth.userId)
    await navigate({ to: '/entrenar/sesion' })
  }

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
        <Button size="lg" className="h-16 text-lg" onClick={() => void start()}>
          <Dumbbell className="size-6" /> Entreno libre
        </Button>
      )}
      <ComingSoon phase={2}>«Registrar actividad» rápida para surf, frontón o yoga.</ComingSoon>
      <ComingSoon phase={5}>La sesión planificada para hoy.</ComingSoon>
    </Page>
  )
}
