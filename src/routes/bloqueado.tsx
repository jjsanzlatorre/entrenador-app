import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { resetAuthState } from '@/lib/auth'

export const Route = createFileRoute('/bloqueado')({
  beforeLoad: ({ context }) => {
    if (context.auth.status === 'anonymous') throw redirect({ to: '/login' })
    if (context.auth.status === 'active') throw redirect({ to: '/' })
  },
  component: BlockedPage,
})

function BlockedPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut()
    await resetAuthState(queryClient)
    await router.invalidate()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Acceso desactivado</h1>
      <p className="text-muted-foreground">
        Tu cuenta está desactivada. Si crees que es un error, habla con el admin.
      </p>
      <Button variant="outline" onClick={signOut}>
        Cerrar sesión
      </Button>
    </main>
  )
}
