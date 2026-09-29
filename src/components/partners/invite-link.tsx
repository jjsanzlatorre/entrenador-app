// «Invitar con enlace» (Perfil → Pareja y amigos): crea un código, lo comparte (hoja nativa,
// WhatsApp o copiar) y lista las invitaciones con su estado.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, MessageCircle, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet } from '@/components/ui/sheet'
import {
  createInviteCode,
  fetchInviteCodes,
  fetchInviteStatus,
  revokeInviteCode,
  type InviteCode,
} from '@/lib/invites/api'
import { inviteMessage, inviteStateLabel, inviteUrl, whatsappShareUrl } from '@/lib/invites/invite'
import { notifyError, notifySaved } from '@/lib/notify'
import { cn } from '@/lib/utils'

export const inviteStatusKey = (userId: string) => ['invite-status', userId] as const
export const inviteCodesKey = (userId: string, all = false) =>
  ['invite-codes', userId, all ? 'all' : 'mine'] as const

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })

export function InviteLinkCard({ userId, name }: { userId: string; name: string | null }) {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: inviteStatusKey(userId), queryFn: fetchInviteStatus })
  const codes = useQuery({ queryKey: inviteCodesKey(userId), queryFn: () => fetchInviteCodes() })
  const [sharing, setSharing] = useState<string | null>(null)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['invite-status', userId] }),
      queryClient.invalidateQueries({ queryKey: ['invite-codes', userId] }),
    ])

  const create = useMutation({
    mutationFn: () => createInviteCode(),
    onSuccess: async (code) => {
      setSharing(code)
      await refresh()
      // Hoja nativa de compartir al momento; si el navegador no la deja abrir (sin gesto
      // reciente), quedan los botones de la hoja.
      void nativeShare(messageFor(name, code), true)
    },
    onError: (error) => notifyError(error, 'crear la invitación'),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInviteCode(id),
    onSuccess: () => notifySaved('Invitación anulada'),
    onError: (error) => notifyError(error, 'anular la invitación'),
    onSettled: () => refresh(),
  })

  const s = status.data
  const list = codes.data ?? []
  // Sin permiso para invitar y sin invitaciones antiguas: no se muestra nada.
  if (!s?.canInvite && list.length === 0) return null
  const atLimit = s && !s.canInvite && s.maxActive !== null && s.activeCount >= s.maxActive

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-5" /> Invitar con enlace
        </CardTitle>
        <CardDescription>
          Para quien aún no usa la app: crea su cuenta con el enlace y quedáis vinculados (solo el
          cumplimiento). Caduca a los 7 días y sirve para una persona.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {s?.canInvite ? (
          <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending}>
            <Share2 /> {create.isPending ? 'Creando…' : 'Invitar con enlace'}
          </Button>
        ) : atLimit ? (
          <p className="text-muted-foreground text-sm">
            {s.activeCount === 1
              ? 'Tienes 1 invitación pendiente, el máximo.'
              : `Tienes ${s.activeCount} invitaciones pendientes, el máximo.`}{' '}
            Anula alguna para crear otra.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Ahora mismo solo el admin puede crear invitaciones.
          </p>
        )}
        {list.length > 0 && (
          <InviteList
            codes={list}
            onShare={(c) => setSharing(c.code)}
            onRevoke={(c) => {
              if (confirm(`¿Anular la invitación ${c.code}? El enlace dejará de funcionar.`))
                revoke.mutate(c.id)
            }}
            busy={revoke.isPending}
          />
        )}
      </CardContent>
      {sharing && <ShareInviteSheet code={sharing} name={name} onClose={() => setSharing(null)} />}
    </Card>
  )
}

export function InviteList({
  codes,
  onShare,
  onRevoke,
  busy,
  showCreator = false,
}: {
  codes: InviteCode[]
  onShare?: (c: InviteCode) => void
  onRevoke: (c: InviteCode) => void
  busy?: boolean
  showCreator?: boolean
}) {
  return (
    <ul className="divide-y" aria-label="Invitaciones">
      {codes.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold tracking-wide">{c.code}</p>
            <p
              className={cn(
                'text-xs',
                c.state === 'active' ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {inviteStateLabel(c)}
              {c.state === 'active' && ` · caduca el ${dateFmt.format(new Date(c.expiresAt))}`}
            </p>
            {showCreator && (
              <p className="text-muted-foreground truncate text-xs">
                De {c.createdByName ?? 'alguien'} · {dateFmt.format(new Date(c.createdAt))}
              </p>
            )}
          </div>
          {c.state === 'active' && (
            <div className="flex shrink-0 gap-1">
              {onShare && (
                <Button variant="ghost" size="sm" onClick={() => onShare(c)}>
                  Compartir
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onRevoke(c)}>
                Anular
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function messageFor(name: string | null, code: string) {
  return inviteMessage(name, inviteUrl(window.location.origin, code))
}

// Devuelve true si se abrió la hoja nativa. `silent`: sin avisos si el navegador no la deja abrir.
async function nativeShare(text: string, silent = false) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  try {
    await navigator.share({ text })
    return true
  } catch (error) {
    if (!silent && !(error instanceof DOMException && error.name === 'AbortError')) {
      notifyError(error, 'abrir el menú de compartir')
    }
    return false
  }
}

function ShareInviteSheet({
  code,
  name,
  onClose,
}: {
  code: string
  name: string | null
  onClose: () => void
}) {
  const url = inviteUrl(window.location.origin, code)
  const text = inviteMessage(name, url)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      notifySaved('Enlace copiado')
    } catch (error) {
      notifyError(error, 'copiar el enlace')
    }
  }

  return (
    <Sheet open onClose={onClose} title="Invitar con enlace">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Envía este enlace a la persona que quieras invitar. Caduca en 7 días y solo sirve para una
          cuenta.
        </p>
        <p
          className="bg-muted rounded-lg p-3 font-mono text-sm break-all select-all"
          data-testid="invite-url"
        >
          {url}
        </p>
        {canShare && (
          <Button size="lg" onClick={() => void nativeShare(text)}>
            <Share2 /> Compartir…
          </Button>
        )}
        <Button size="lg" variant={canShare ? 'outline' : 'default'} asChild>
          <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Compartir por WhatsApp
          </a>
        </Button>
        <Button size="lg" variant="outline" onClick={() => void copy()}>
          <Copy /> Copiar enlace
        </Button>
      </div>
    </Sheet>
  )
}
