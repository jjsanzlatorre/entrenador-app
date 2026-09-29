import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  ChevronRight,
  Download,
  ClipboardList,
  Info,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  PartyPopper,
  Shapes,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/page'
import { Switch } from '@/components/ui/switch'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { resetAuthState, signOut } from '@/lib/auth'
import { notifyError, notifySaved } from '@/lib/notify'
import { updateOwnProfile, updateProfileSettings } from '@/lib/progress/api'

export const Route = createFileRoute('/_app/perfil/')({
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
          <CardDescription>Altura y año de nacimiento.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <dl className="grid grid-cols-2 gap-2">
            <dt>Altura</dt>
            <dd>{profile.height_cm ? `${profile.height_cm} cm` : '—'}</dd>
            <dt>Año de nacimiento</dt>
            <dd>{profile.birth_year ?? '—'}</dd>
          </dl>
          <p className="mt-3 text-xs">Se editan en el perfil de entrenamiento.</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/onboarding">
            <span className="flex items-center gap-2">
              <ClipboardList /> Perfil de entrenamiento
              <span className="text-muted-foreground font-normal">objetivos, días…</span>
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/actividades">
            <span className="flex items-center gap-2">
              <Shapes /> Mis actividades
              <span className="text-muted-foreground font-normal">clases, deportes…</span>
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/compromiso">
            <span className="flex items-center gap-2">
              <Target /> Mi compromiso
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/ciudad">
            <span className="flex min-w-0 items-center gap-2">
              <MapPin /> Ciudad de referencia
              <span className="text-muted-foreground truncate font-normal">
                {profile.home_city ?? 'sin elegir'}
              </span>
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/vinculos">
            <span className="flex items-center gap-2">
              <Users /> Pareja y amigos
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/notificaciones">
            <span className="flex items-center gap-2">
              <Bell /> Notificaciones
            </span>
            <ChevronRight />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="justify-between">
          <Link to="/perfil/exportar">
            <span className="flex items-center gap-2">
              <Download /> Exportar mis datos
            </span>
            <ChevronRight />
          </Link>
        </Button>
      </div>

      <PopupsToggle enabled={profile.show_equivalence_popups} />

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

      <Button asChild variant="ghost" size="lg" className="justify-between">
        <Link to="/perfil/creditos">
          <span className="flex items-center gap-2">
            <Info /> Créditos
          </span>
          <ChevronRight />
        </Link>
      </Button>

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

  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateOwnProfile(auth.userId, { display_name: name.trim() || null })
      setStatus('Guardado')
      notifySaved('Nombre guardado')
      await resetAuthState(queryClient)
      await router.invalidate()
    } catch (error) {
      setStatus('No se pudo guardar')
      notifyError(error, 'guardar el nombre')
    } finally {
      setSaving(false)
    }
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
        <Button type="submit" size="lg" disabled={saving}>
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

  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password })
      if (error) throw new Error(passwordError(error.message))
      setStatus('Contraseña guardada')
      notifySaved('Contraseña guardada')
      setPassword('')
    } catch (error) {
      setStatus(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`)
      notifyError(error, 'guardar la contraseña')
    } finally {
      setSaving(false)
    }
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
        <Button type="submit" size="lg" disabled={saving}>
          Guardar
        </Button>
      </div>
      {status && <p className="text-muted-foreground text-sm">{status}</p>}
    </form>
  )
}

// Mensajes de Supabase Auth más habituales al cambiar la contraseña.
function passwordError(message: string) {
  if (/different from the old/i.test(message)) return 'tiene que ser distinta de la actual'
  if (/at least|should be|weak/i.test(message)) return 'es demasiado corta o débil'
  if (/reauthent/i.test(message)) return 'vuelve a entrar en la app e inténtalo de nuevo'
  return message
}

// Pop-ups de logros (fin de sesión y resumen del mes): show_equivalence_popups.
function PopupsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { auth } = Route.useRouteContext()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function toggle() {
    setSaving(true)
    setStatus(null)
    try {
      await updateProfileSettings(auth.userId, { showPopups: !enabled })
      await resetAuthState(queryClient)
      await router.invalidate()
      notifySaved(enabled ? 'Pop-ups de logros desactivados' : 'Pop-ups de logros activados')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo guardar')
      notifyError(error, 'guardar la preferencia')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <PartyPopper className="text-primary size-6 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">Pop-ups de logros</p>
          <p className="text-muted-foreground text-sm">
            Al terminar una sesión que supera un objeto o un destino, y el resumen de cada mes.
          </p>
          {status && <p className="text-destructive text-sm">{status}</p>}
        </div>
        <Switch
          checked={enabled}
          label="Pop-ups de logros"
          disabled={saving}
          onChange={() => void toggle()}
        />
      </CardContent>
    </Card>
  )
}
