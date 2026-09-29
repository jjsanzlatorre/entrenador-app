import { useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetAuthState, signOut } from '@/lib/auth'
import { notifySaved } from '@/lib/notify'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { changeTemporaryPassword } from '@/server/account.functions'

// Obligatoria tras entrar con una contraseña temporal del admin (profiles.must_change_password).
export const Route = createFileRoute('/_app/cambiar-contrasena')({
  ssr: false,
  component: ChangePasswordPage,
})

function ChangePasswordPage() {
  const { auth } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const change = useServerFn(changeTemporaryPassword)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres')
    if (password !== confirmPassword) return setError('Las contraseñas no coinciden')
    setBusy(true)
    try {
      await change({ data: { password } })
      // Se vuelve a entrar con la contraseña nueva por si el cambio cerró la sesión.
      if (auth.email) {
        await getSupabaseBrowserClient().auth.signInWithPassword({ email: auth.email, password })
      }
      notifySaved('Contraseña cambiada')
      await resetAuthState(queryClient)
      await router.invalidate()
      await router.navigate({ to: '/', replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido cambiar la contraseña')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen-safe pb-safe-6 flex flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" /> Elige tu contraseña
          </CardTitle>
          <CardDescription>
            Has entrado con una contraseña temporal. Pon una nueva para seguir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new_pw">Nueva contraseña (mínimo 8 caracteres)</Label>
              <Input
                id="new_pw"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new_pw2">Repite la contraseña</Label>
              <Input
                id="new_pw2"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar y entrar'}
            </Button>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      <Button
        variant="link"
        onClick={() =>
          void signOut(queryClient).then(async () => {
            await router.invalidate()
            await router.navigate({ to: '/login' })
          })
        }
      >
        Cerrar sesión
      </Button>
    </div>
  )
}
