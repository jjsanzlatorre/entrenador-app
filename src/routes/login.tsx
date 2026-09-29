import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Dumbbell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { resetAuthState } from '@/lib/auth'
import { savePendingInvite } from '@/lib/invites/invite'
import { Screen } from '@/components/layout/safe-area'

export const Route = createFileRoute('/login')({
  // ?invitacion=CÓDIGO: viene de /unirse con un email que ya tenía cuenta; al entrar se aplica.
  validateSearch: (search: Record<string, unknown>): { invitacion?: string } =>
    typeof search.invitacion === 'string' && search.invitacion.length <= 40
      ? { invitacion: search.invitacion }
      : {},
  beforeLoad: ({ context }) => {
    if (context.auth.status === 'active') throw redirect({ to: '/' })
  },
  component: LoginPage,
})

type Mode = 'magic' | 'code' | 'password'

function LoginPage() {
  const { invitacion } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('magic')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // También para el enlace mágico, que vuelve por /auth/callback.
  useEffect(() => {
    if (invitacion) savePendingInvite(invitacion)
  }, [invitacion])

  async function afterLogin() {
    await resetAuthState(queryClient)
    await router.invalidate()
    await router.navigate({ to: '/' })
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo ha fallado. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  function sendMagicLink(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) {
        throw new Error(
          /signup|not allowed|not found/i.test(error.message)
            ? 'Este email no tiene acceso. Pide una invitación al admin.'
            : error.message,
        )
      }
      setInfo('Te hemos enviado un email. Pulsa el enlace o escribe aquí el código.')
      setMode('code')
    })
  }

  function verifyCode(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const { error } = await getSupabaseBrowserClient().auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (error) throw new Error('Código incorrecto o caducado')
      await afterLogin()
    })
  }

  function loginWithPassword(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw new Error('Email o contraseña incorrectos')
      await afterLogin()
    })
  }

  return (
    <Screen>
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-primary text-primary-foreground rounded-2xl p-3">
          <Dumbbell className="size-8" />
        </div>
        <h1 className="text-2xl font-bold">Entrenador</h1>
        <p className="text-muted-foreground text-sm">
          {invitacion
            ? 'Entra con tu cuenta: al entrar se aplicará la invitación.'
            : 'Acceso solo por invitación'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {mode === 'password' ? 'Entrar con contraseña' : 'Entrar con email'}
          </CardTitle>
          <CardDescription>
            {mode === 'code'
              ? info
              : mode === 'password'
                ? 'Si ya te has puesto una contraseña en tu perfil.'
                : 'Te enviamos un enlace y un código de acceso.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === 'magic' && (
            <form onSubmit={sendMagicLink} className="flex flex-col gap-4">
              <EmailField value={email} onChange={setEmail} />
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviarme el enlace'}
              </Button>
            </form>
          )}

          {mode === 'code' && (
            <form onSubmit={verifyCode} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Código</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Comprobando…' : 'Entrar'}
              </Button>
            </form>
          )}

          {mode === 'password' && (
            <form onSubmit={loginWithPassword} className="flex flex-col gap-4">
              <EmailField value={email} onChange={setEmail} />
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-destructive mt-4 text-sm">
              {error}
            </p>
          )}

          <Button
            variant="link"
            className="mt-2 w-full"
            onClick={() => {
              setError(null)
              setMode(mode === 'password' ? 'magic' : 'password')
            }}
          >
            {mode === 'password' ? 'Prefiero recibir un enlace' : 'Entrar con contraseña'}
          </Button>
        </CardContent>
      </Card>
    </Screen>
  )
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
