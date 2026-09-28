import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Dumbbell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Page } from '@/components/page'
import { SessionScreen } from '@/components/workout/session-screen'
import { loadActiveSession, startNewSession, useActiveSession } from '@/lib/workout/active-session'

// Sesión en curso. Solo cliente: el estado vive en IndexedDB y funciona sin conexión.
export const Route = createFileRoute('/_app/entrenar/sesion')({
  ssr: false,
  component: SessionPage,
})

function SessionPage() {
  const { auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const { session, loadedFor } = useActiveSession()
  const [loading, setLoading] = useState(loadedFor !== auth.userId)

  useEffect(() => {
    let cancelled = false
    void loadActiveSession(auth.userId).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [auth.userId])

  if (loading) return <p className="text-muted-foreground p-6 text-center">Cargando sesión…</p>

  if (!session) {
    return (
      <Page title="Sesión">
        <p className="text-muted-foreground">No tienes ninguna sesión en curso.</p>
        <Button
          size="lg"
          className="h-16 text-lg"
          onClick={async () => {
            await startNewSession(auth.userId)
          }}
        >
          <Dumbbell className="size-6" /> Empezar entreno libre
        </Button>
        <Button variant="ghost" onClick={() => void navigate({ to: '/entrenar' })}>
          Volver
        </Button>
      </Page>
    )
  }

  return <SessionScreen session={session} />
}
