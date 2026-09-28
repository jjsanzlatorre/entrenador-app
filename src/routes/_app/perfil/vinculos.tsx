import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  invitePartner,
  respondPartner,
  revokePartner,
  updateSharing,
  type PartnerLink,
} from '@/lib/progress/api'
import { partnersKey, usePartnerLinks } from '@/lib/progress/hooks'
import { notifyError, notifySaved } from '@/lib/notify'

export const Route = createFileRoute('/_app/perfil/vinculos')({
  ssr: false,
  component: PartnersPage,
})

function PartnersPage() {
  const { auth } = Route.useRouteContext()
  const links = usePartnerLinks(auth.userId)
  const received = links.data?.filter((l) => l.status === 'received') ?? []
  const sent = links.data?.filter((l) => l.status === 'sent') ?? []
  const accepted = links.data?.filter((l) => l.status === 'accepted') ?? []

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/perfil"
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> Perfil
      </Link>
      <h1 className="text-2xl font-bold">Pareja y amigos</h1>
      <p className="text-muted-foreground text-sm">
        Vincúlate con alguien que ya use la app para ver vuestro cumplimiento juntos en la tarjeta
        «Nosotros». Cada uno decide qué comparte. Las fotos nunca se comparten.
      </p>

      <InviteForm userId={auth.userId} />

      {links.isPending && <p className="text-muted-foreground">Cargando…</p>}
      {links.isError && <p className="text-destructive text-sm">{links.error.message}</p>}

      {received.map((l) => (
        <ReceivedCard key={l.partnerId} userId={auth.userId} link={l} />
      ))}
      {accepted.map((l) => (
        <LinkedCard key={l.partnerId} userId={auth.userId} link={l} />
      ))}
      {sent.map((l) => (
        <SentCard key={l.partnerId} userId={auth.userId} link={l} />
      ))}
    </div>
  )
}

function useRefresh(userId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: partnersKey(userId) })
}

function InviteForm({ userId }: { userId: string }) {
  const refresh = useRefresh(userId)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await invitePartner(email.trim())
      setEmail('')
      setStatus({ ok: true, text: 'Invitación enviada. Le aparecerá en Perfil → Pareja y amigos.' })
      notifySaved('Invitación enviada')
      await refresh()
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      notifyError(error, 'enviar la invitación')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5" /> Invitar
        </CardTitle>
        <CardDescription>Email con el que esa persona entra en la app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="partner_email" className="sr-only">
            Email
          </Label>
          <div className="flex gap-2">
            <Input
              id="partner_email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@ejemplo.com"
            />
            <Button type="submit" size="lg" disabled={busy}>
              Invitar
            </Button>
          </div>
          {status && (
            <p className={status.ok ? 'text-sm text-emerald-700' : 'text-destructive text-sm'}>
              {status.text}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function ReceivedCard({ userId, link }: { userId: string; link: PartnerLink }) {
  const refresh = useRefresh(userId)
  const [error, setError] = useState<string | null>(null)
  async function respond(accept: boolean) {
    try {
      await respondPartner(link.partnerId, accept)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      notifyError(e, accept ? 'aceptar el vínculo' : 'rechazar el vínculo')
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{link.displayName} quiere vincularse contigo</CardTitle>
        <CardDescription>
          Al aceptar, los dos veréis el cumplimiento del otro (porcentajes, rachas y nº de sesiones
          por tipo). Ni pesos, ni notas, ni medidas, salvo que lo actives.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => void respond(true)}>
          <Check /> Aceptar
        </Button>
        <Button size="lg" variant="outline" onClick={() => void respond(false)}>
          <X /> Rechazar
        </Button>
        {error && <p className="text-destructive col-span-2 text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}

function SentCard({ userId, link }: { userId: string; link: PartnerLink }) {
  const refresh = useRefresh(userId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{link.displayName}</CardTitle>
        <CardDescription>Invitación enviada, pendiente de que la acepte.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() =>
            void revokePartner(link.partnerId).then(
              () => refresh(),
              (e: unknown) => notifyError(e, 'cancelar la invitación'),
            )
          }
        >
          Cancelar invitación
        </Button>
      </CardContent>
    </Card>
  )
}

const PERMISSIONS: { key: keyof PartnerLink['iShare']; label: string; hint: string }[] = [
  {
    key: 'adherence',
    label: 'Mi cumplimiento',
    hint: 'Porcentajes, rachas y nº de sesiones por tipo.',
  },
  {
    key: 'sessions',
    label: 'Mis sesiones',
    hint: 'Ejercicios, pesos y series (se podrán ver en la fase 7).',
  },
  { key: 'metrics', label: 'Mi peso y medidas', hint: 'Nunca las fotos.' },
]

function LinkedCard({ userId, link }: { userId: string; link: PartnerLink }) {
  const refresh = useRefresh(userId)
  const [error, setError] = useState<string | null>(null)

  async function toggle(key: keyof PartnerLink['iShare'], value: boolean) {
    setError(null)
    try {
      await updateSharing(userId, link.partnerId, { [key]: value })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      notifyError(e, 'guardar el permiso')
    }
  }

  async function revoke() {
    if (!confirm(`¿Deshacer el vínculo con ${link.displayName}? Dejaréis de ver vuestros datos.`))
      return
    try {
      await revokePartner(link.partnerId)
      await refresh()
    } catch (e) {
      notifyError(e, 'deshacer el vínculo')
    }
  }

  const theyShare = PERMISSIONS.filter((p) => link.theyShare[p.key]).map((p) =>
    p.label.replace('Mi ', 'su ').replace('Mis ', 'sus '),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{link.displayName}</CardTitle>
        <CardDescription>
          Te comparte: {theyShare.length > 0 ? theyShare.join(', ') : 'nada por ahora'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm font-medium">Lo que compartes tú</p>
        {PERMISSIONS.map((p) => (
          <label key={p.key} className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5"
              checked={link.iShare[p.key]}
              onChange={(e) => void toggle(p.key, e.target.checked)}
            />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="text-muted-foreground block">{p.hint}</span>
            </span>
          </label>
        ))}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button
          variant="ghost"
          className="text-destructive self-start"
          onClick={() => void revoke()}
        >
          Deshacer vínculo
        </Button>
      </CardContent>
    </Card>
  )
}
