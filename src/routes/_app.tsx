import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { BottomNav } from '@/components/bottom-nav'

// Layout de la app autenticada: guarda de acceso + navegación inferior.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => {
    const { auth } = context
    if (auth.status === 'anonymous') throw redirect({ to: '/login' })
    if (auth.status === 'inactive') throw redirect({ to: '/bloqueado' })
    return { auth }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <div
      className="mx-auto min-h-dvh max-w-lg pb-24"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
