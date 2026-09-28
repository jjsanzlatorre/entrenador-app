import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Mail, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/page'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { resetAuthState, signOut } from '@/lib/auth'

export const Route = createFileRoute('/_app/perfil')({
  component: ProfilePage,
})

function ProfilePage() {
  const { auth } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { profile } = auth

  async function handleSignOut() {
    await signOut(queryClient)
    await router.invalidate()
    await router.navigate({ to: '/login' })
  }

  return (
    <Page title="Perfil">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {profile.display_name ?? 'Sin nombre'}
            {profile.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <Mail className="size-4" /> {auth.email}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayNameForm initial={profile.display_name ?? ''} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos personales</CardTitle>
          <CardDescription>Altura, año de nacimiento y ciudad de referencia.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <dl className="grid grid-cols-2 gap-2">
            <dt>Altura</dt>
            <dd>{profile.height_cm ? `${profile.height_cm} cm` : '—'}</dd>
            <dt>Año de nacimiento</dt>
            <dd>{profile.birth_year ?? '—'}</dd>
            <dt>Ciudad</dt>
            <dd>{profile.home_city ?? '—'}</dd>
          </dl>
          <p className="mt-3 text-xs">Se completarán en el onboarding (fase 5).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Contraseña
          </CardTitle>
          <CardDescription>
            Opcional. Útil en la app instalada, donde el enlace del email se abre en el navegador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      {profile.role === 'admin' && (
        <Button asChild variant="outline" size="lg">
          <Link to="/admin/invitaciones">
            <ShieldCheck /> Invitaciones y usuarios
          </Link>
        </Button>
      )}

      <Button variant="ghost" size="lg" onClick={handleSignOut}>
        <LogOut /> Cerrar sesión
      </Button>
    </Page>
  )
}

function DisplayNameForm({ initial }: { initial: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { auth } = Route.useRouteContext()
  const [name, setName] = useState(initial)
  const [status, setStatus] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await getSupabaseBrowserClient()
      .from('profiles')
      .update({ display_name: name.trim() || null })
      .eq('id', auth.userId)
    if (error) {
      setStatus('No se pudo guardar')
      return
    }
    setStatus('Guardado')
    await resetAuthState(queryClient)
    await router.invalidate()
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Label htmlFor="display_name">Nombre</Label>
      <div className="flex gap-2">
        <Input
          id="display_name"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value)
            setStatus(null)
          }}
        />
        <Button type="submit" size="lg">
          Guardar
        </Button>
      </div>
      {status && <p className="text-muted-foreground text-sm">{status}</p>}
    </form>
  )
}

function PasswordForm() {
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password })
    setStatus(error ? `No se pudo guardar: ${error.message}` : 'Contraseña guardada')
    if (!error) setPassword('')
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Label htmlFor="new_password">Nueva contraseña</Label>
      <div className="flex gap-2">
        <Input
          id="new_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" size="lg">
          Guardar
        </Button>
      </div>
      {status && <p className="text-muted-foreground text-sm">{status}</p>}
    </form>
  )
}
