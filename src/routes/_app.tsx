import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { BottomNav } from '@/components/bottom-nav'
import { onSessionsSynced, startSyncEngine } from '@/lib/offline/sync-engine'
import { refreshPushSubscription } from '@/lib/notifications/push'
import { warmPageCache } from '@/lib/pwa'
import { applyPendingInvite } from '@/lib/invites/pending'
import { loadActiveSession, pruneLocalSessions } from '@/lib/workout/active-session'
import { fetchCatalog } from '@/lib/workout/api'
import { catalogQueryKey, historyQueryKey } from '@/lib/workout/hooks'

// Layout de la app autenticada: guarda de acceso + navegación inferior.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { auth } = context
    if (auth.status === 'anonymous') throw redirect({ to: '/login' })
    if (auth.status === 'inactive') throw redirect({ to: '/bloqueado' })
    // Contraseña temporal del admin: hay que cambiarla antes de usar la app.
    if (auth.profile.must_change_password && location.pathname !== '/cambiar-contrasena') {
      throw redirect({ to: '/cambiar-contrasena' })
    }
    return { auth }
  },
  component: AppLayout,
})

// Pantallas a pantalla completa, sin navegación inferior.
const FULL_SCREEN = ['/entrenar/sesion', '/onboarding', '/instalar', '/cambiar-contrasena']

function AppLayout() {
  const { auth } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const pathname = useLocation({ select: (l) => l.pathname })
  const inSession = FULL_SCREEN.some((p) => pathname.startsWith(p))

  // Arranque en el navegador: sincronización, sesión en curso, catálogo y páginas offline.
  useEffect(() => {
    const userId = auth.userId
    startSyncEngine(userId)
    void loadActiveSession(userId)
    void pruneLocalSessions(userId)
    void queryClient.prefetchQuery({
      queryKey: catalogQueryKey(userId),
      queryFn: () => fetchCatalog(userId),
      networkMode: 'always',
    })
    warmPageCache()
    void refreshPushSubscription()
    void applyPendingInvite(queryClient, userId)
    return onSessionsSynced((ids) => {
      void queryClient.invalidateQueries({ queryKey: historyQueryKey(userId) })
      // Récords y cumplimiento dependen de las sesiones del servidor.
      for (const key of [
        'session-log',
        'records',
        'exercise-samples',
        'session-prs',
        'active-plan',
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: ['session', id] })
    })
  }, [auth.userId, queryClient])

  return (
    <div
      className={inSession ? 'mx-auto min-h-dvh max-w-lg' : 'mx-auto min-h-dvh max-w-lg pb-24'}
      style={inSession ? undefined : { paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main>
        <Outlet />
      </main>
      {!inSession && <BottomNav />}
    </div>
  )
}
