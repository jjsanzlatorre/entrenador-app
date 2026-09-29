import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { PERMISSION_INFO, sharedSummary } from '@/components/partners/permissions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { notifyError, notifySaved } from '@/lib/notify'
import { usePartnerLink } from '@/lib/partners/hooks'
import { revokePartner, updateSharing, type SharePerm } from '@/lib/progress/api'
import { partnersKey } from '@/lib/progress/hooks'

export const Route = createFileRoute('/_app/perfil/vinculos/$partnerId')({
  ssr: false,
  component: PartnerSettingsPage,
})

function PartnerSettingsPage() {
  const { partnerId } = Route.useParams()
  const { auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { link, isPending, error } = usePartnerLink(auth.userId, partnerId)
  const [saving, setSaving] = useState<SharePerm | null>(null)

  const back = (
    <Link
      to="/perfil/vinculos"
      className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
    >
      <ChevronLeft className="size-4" /> Pareja y amigos
    </Link>
  )

  if (isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>
  if (!link) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {back}
        <p className="text-muted-foreground">
          {error ? error.message : 'Ya no estás vinculado con esta persona.'}
        </p>
      </div>
    )
  }
  const name = link.displayName

  async function toggle(key: SharePerm, value: boolean) {
    setSaving(key)
    try {
      await updateSharing(auth.userId, partnerId, { [key]: value })
      await queryClient.invalidateQueries({ queryKey: partnersKey(auth.userId) })
      const label = PERMISSION_INFO.find((p) => p.key === key)!.label
      notifySaved(value ? `${name} ya ve: ${label}` : `${name} ya no ve: ${label}`)
    } catch (e) {
      notifyError(e, 'guardar el permiso')
    } finally {
      setSaving(null)
    }
  }

  async function revoke() {
    if (!confirm(`¿Deshacer el vínculo con ${name}? Dejaréis de ver vuestros datos.`)) return
    try {
      await revokePartner(partnerId)
      await queryClient.invalidateQueries({ queryKey: partnersKey(auth.userId) })
      notifySaved('Vínculo deshecho')
      await navigate({ to: '/perfil/vinculos', replace: true })
    } catch (e) {
      notifyError(e, 'deshacer el vínculo')
    }
  }

  const theyShareAny = Object.values(link.theyShare).some(Boolean)

  return (
    <div className="flex flex-col gap-4 p-4">
      {back}
      <h1 className="text-2xl font-bold">{name}</h1>

      {theyShareAny && (
        <Button asChild size="lg" variant="outline" className="justify-between">
          <Link to="/pareja/$partnerId" params={{ partnerId }}>
            Ver la evolución de {name}
            <ChevronRight />
          </Link>
        </Button>
      )}
      <p className="text-muted-foreground text-sm">Te comparte: {sharedSummary(link.theyShare)}.</p>

      <Card>
        <CardHeader>
          <CardTitle>Lo que compartes con {name}</CardTitle>
          <CardDescription>
            Solo con esta persona. Cada cambio vale al momento: si lo desactivas, deja de verlo en
            cuanto vuelva a cargar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {PERMISSION_INFO.map((p) => {
              const on = link.iShare[p.key]
              const id = `perm-${p.key}`
              return (
                <li key={p.key} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p id={id} className="font-medium">
                      {p.label}
                    </p>
                    <p className="text-muted-foreground text-xs">{p.hint}</p>
                  </div>
                  <Switch
                    checked={on}
                    labelledBy={id}
                    disabled={saving !== null}
                    onChange={(next) => void toggle(p.key, next)}
                  />
                </li>
              )
            })}
            <li className="text-muted-foreground flex items-center gap-3 py-3">
              <Lock className="size-5 shrink-0" />
              <p className="text-sm">
                <span className="font-medium">Fotos de progreso:</span> siempre privadas. No se
                pueden compartir.
              </p>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Button variant="ghost" className="text-destructive self-start" onClick={() => void revoke()}>
        Deshacer vínculo
      </Button>
    </div>
  )
}
