import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sharedSummary } from '@/components/partners/permissions'
import { invitePartner, respondPartner, revokePartner, type PartnerLink } from '@/lib/progress/api'
import { partnersKey, usePartnerLinks } from '@/lib/progress/hooks'
import { notifyError, notifySaved } from '@/lib/notify'

export const Route = createFileRoute('/_app/perfil/vinculos/')({
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
        Vincúlate con quien ya use la app (tu pareja o amigos) para ver vuestro cumplimiento juntos
        en la tarjeta «Nosotros» y entrenar juntos. Cada uno decide, persona a persona, qué
        comparte. Las fotos nunca se comparten.
      </p>

      <InviteForm userId={auth.userId} />

      {links.isPending && <p className="text-muted-foreground">Cargando…</p>}
      {links.isError && <p className="text-destructive text-sm">{links.error.message}</p>}

      {received.map((l) => (
        <ReceivedCard key={l.partnerId} userId={auth.userId} link={l} />
      ))}
      {accepted.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Personas vinculadas">
          {accepted.map((l) => (
            <LinkedRow key={l.partnerId} link={l} />
          ))}
        </ul>
      )}
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
          por tipo). Entrenos, mapa muscular, logros y medidas solo si cada uno lo activa. Las
          fotos, nunca.
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

function LinkedRow({ link }: { link: PartnerLink }) {
  return (
    <li>
      <Link
        to="/perfil/vinculos/$partnerId"
        params={{ partnerId: link.partnerId }}
        className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{link.displayName}</p>
          <p className="text-muted-foreground text-xs">Compartes: {sharedSummary(link.iShare)}</p>
          <p className="text-muted-foreground text-xs">
            Te comparte: {sharedSummary(link.theyShare)}
          </p>
        </div>
        <ChevronRight className="text-muted-foreground size-5 shrink-0" />
      </Link>
    </li>
  )
}
