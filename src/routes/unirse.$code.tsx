import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Dumbbell, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetAuthState } from '@/lib/auth'
import { inviteProblemText, markJustJoined, savePendingInvite } from '@/lib/invites/invite'
import { notifyError, notifySaved } from '@/lib/notify'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { getInvite, redeemInvite, registerWithInvite } from '@/server/invite.functions'

const OG_TITLE = 'Te han invitado a Entrenador'
const OG_DESCRIPTION =
  'Únete para entrenar juntos: registra tus entrenos, marca tu compromiso semanal y ved vuestro progreso.'

export const Route = createFileRoute('/unirse/$code')({
  loader: ({ params }) => getInvite({ data: { code: params.code } }),
  // Vista previa en WhatsApp: Open Graph sin datos personales (ni el nombre de quien invita).
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? ''
    const image = `${origin}/og-invite.png`
    return {
      meta: [
        { title: OG_TITLE },
        { name: 'description', content: OG_DESCRIPTION },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Entrenador' },
        { property: 'og:locale', content: 'es_ES' },
        { property: 'og:title', content: OG_TITLE },
        { property: 'og:description', content: OG_DESCRIPTION },
        { property: 'og:image', content: image },
        { property: 'og:image:type', content: 'image/png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: 'Entrenador: entrena en compañía' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: OG_TITLE },
        { name: 'twitter:description', content: OG_DESCRIPTION },
        { name: 'twitter:image', content: image },
        { name: 'robots', content: 'noindex' },
      ],
    }
  },
  component: JoinPage,
})

function JoinPage() {
  const invite = Route.useLoaderData()
  const { auth } = Route.useRouteContext()
  const problem = inviteProblemText(invite.status, invite.inviterName)
  const inviter = invite.inviterName?.trim() || 'Alguien'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-primary text-primary-foreground rounded-2xl p-3">
          <Dumbbell className="size-8" />
        </div>
        <h1 className="text-2xl font-bold">Entrenador</h1>
      </div>

      {problem ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitación no válida</CardTitle>
            <CardDescription role="alert">{problem}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/login">Ya tengo cuenta: entrar</Link>
            </Button>
          </CardContent>
        </Card>
      ) : auth.status === 'active' ? (
        <LoggedInJoin code={invite.code} inviter={inviter} />
      ) : (
        <RegisterForm code={invite.code} inviter={inviter} />
      )}
    </main>
  )
}

function RegisterForm({ code, inviter }: { code: string; inviter: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const register = useServerFn(registerWithInvite)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailExists, setEmailExists] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEmailExists(false)
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres')
    if (password !== confirmPassword) return setError('Las contraseñas no coinciden')
    setBusy(true)
    try {
      const cleanEmail = email.trim().toLowerCase()
      const result = await register({
        data: { code, name: name.trim(), email: cleanEmail, password, passwordConfirm: password },
      })
      if (result.status === 'email_exists') {
        // Al entrar con esa cuenta se aplicará el vínculo de este código.
        savePendingInvite(code)
        setEmailExists(true)
        return
      }
      if (result.status !== 'ok') {
        setError(inviteProblemText(result.status === 'own' ? 'not_found' : result.status, inviter))
        return
      }
      const { error: signInError } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: cleanEmail,
        password,
      })
      if (signInError) {
        setError('Cuenta creada, pero no hemos podido iniciar sesión. Entra con tu email.')
        return
      }
      markJustJoined()
      notifySaved(`¡Bienvenida/o! Ya estás vinculado con ${inviter}`)
      await resetAuthState(queryClient)
      await router.invalidate()
      await router.navigate({ to: '/onboarding', replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo ha fallado. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{inviter} te ha invitado</CardTitle>
        <CardDescription>
          Crea tu cuenta para entrenar juntos. Quedaréis vinculados y veréis el cumplimiento del
          otro; lo demás lo decide cada uno.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field id="join_name" label="Nombre">
            <Input
              id="join_name"
              autoComplete="given-name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="join_email" label="Email">
            <Input
              id="join_email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field id="join_password" label="Contraseña (mínimo 8 caracteres)">
            <Input
              id="join_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field id="join_password2" label="Repite la contraseña">
            <Input
              id="join_password2"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            <UserPlus /> {busy ? 'Creando la cuenta…' : 'Crear cuenta'}
          </Button>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {emailExists && (
            <div role="alert" className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
              <p className="font-medium">Ya tienes cuenta, inicia sesión.</p>
              <p className="text-muted-foreground">
                Al entrar quedarás vinculado con {inviter} igualmente.
              </p>
              <Button asChild>
                <Link to="/login" search={{ invitacion: code }}>
                  Iniciar sesión
                </Link>
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function LoggedInJoin({ code, inviter }: { code: string; inviter: string }) {
  const router = useRouter()
  const redeem = useServerFn(redeemInvite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const result = await redeem({ data: { code } })
      if (result.status === 'linked' || result.status === 'already_linked') {
        notifySaved(
          result.status === 'linked'
            ? `Ya estás vinculado con ${inviter}`
            : `Ya estabas vinculado con ${inviter}`,
        )
        await router.navigate({ to: '/perfil/vinculos' })
        return
      }
      setError(
        result.status === 'own'
          ? 'Es tu propia invitación: envíasela a la persona que quieras invitar.'
          : inviteProblemText(result.status, inviter),
      )
    } catch (err) {
      notifyError(err, 'aceptar la invitación')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{inviter} te ha invitado</CardTitle>
        <CardDescription>
          Ya tienes sesión iniciada. Acepta para quedar vinculados y ver el cumplimiento del otro.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button size="lg" onClick={() => void join()} disabled={busy}>
          {busy ? 'Vinculando…' : `Vincularme con ${inviter}`}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">Ir a Hoy</Link>
        </Button>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
