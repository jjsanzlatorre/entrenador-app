import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Copy, KeyRound, MessageCircle, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/page'
import { Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { InviteList, inviteCodesKey } from '@/components/partners/invite-link'
import {
  inviteUser,
  listUsers,
  setTemporaryPassword,
  setUserActive,
  type AdminUser,
} from '@/server/admin.functions'
import {
  fetchInviteCodes,
  fetchInviteSettings,
  revokeInviteCode,
  saveInviteSettings,
  type InviteSettings,
} from '@/lib/invites/api'
import { whatsappShareUrl } from '@/lib/invites/invite'
import { notifyError, notifySaved } from '@/lib/notify'

const usersQueryKey = ['admin', 'users'] as const

export const Route = createFileRoute('/_app/admin/invitaciones')({
  beforeLoad: ({ context }) => {
    if (context.auth.profile.role !== 'admin') throw redirect({ to: '/' })
  },
  component: InvitationsPage,
})

function InvitationsPage() {
  const { auth } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const listUsersFn = useServerFn(listUsers)
  const inviteFn = useServerFn(inviteUser)
  const setActiveFn = useServerFn(setUserActive)
  const tempPasswordFn = useServerFn(setTemporaryPassword)
  const [email, setEmail] = useState('')
  // Contraseña temporal recién generada: se enseña una sola vez (no se guarda en ningún sitio).
  const [temp, setTemp] = useState<{ user: AdminUser; password: string } | null>(null)

  const users = useQuery({ queryKey: usersQueryKey, queryFn: () => listUsersFn(), retry: 1 })

  const invite = useMutation({
    mutationFn: (value: string) => inviteFn({ data: { email: value } }),
    onError: (error) => notifyError(error, 'enviar la invitación'),
    onSuccess: (_data, value) => {
      notifySaved(`Invitación enviada a ${value}`)
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: usersQueryKey })
    },
  })

  const toggle = useMutation({
    mutationFn: (u: AdminUser) => setActiveFn({ data: { userId: u.id, active: !u.active } }),
    onSuccess: (_data, u) => notifySaved(u.active ? 'Usuario desactivado' : 'Usuario reactivado'),
    onError: (error) => notifyError(error, 'cambiar el acceso'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  })

  const tempPassword = useMutation({
    mutationFn: (u: AdminUser) => tempPasswordFn({ data: { userId: u.id } }),
    onSuccess: ({ password }, u) => {
      setTemp({ user: u, password })
      void queryClient.invalidateQueries({ queryKey: usersQueryKey })
    },
    onError: (error) => notifyError(error, 'generar la contraseña'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate(email)
  }

  return (
    <Page title="Invitaciones">
      <p className="text-muted-foreground text-sm">
        Para invitar con un enlace (WhatsApp, sin email), usa Perfil → Pareja y amigos → «Invitar
        con enlace».
      </p>
      <InviteSettingsCard />
      <AllInvitesCard userId={auth.userId} />

      <Card>
        <CardHeader>
          <CardTitle>Invitar por email</CardTitle>
          <CardDescription>Recibirá un email con un enlace para entrar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Label htmlFor="invite_email">Email</Label>
            <Input
              id="invite_email"
              type="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                invite.reset()
              }}
            />
            <Button type="submit" size="lg" disabled={invite.isPending}>
              <Send /> {invite.isPending ? 'Enviando…' : 'Enviar invitación'}
            </Button>
            {invite.isSuccess && <p className="text-sm">Invitación enviada.</p>}
            {invite.isError && (
              <p role="alert" className="text-destructive text-sm">
                {invite.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
        </CardHeader>
        <CardContent>
          {users.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
          {users.isError && <p className="text-destructive text-sm">{users.error.message}</p>}
          {toggle.isError && <p className="text-destructive text-sm">{toggle.error.message}</p>}
          <ul className="divide-y">
            {users.data?.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.displayName ?? u.email}</p>
                  <p className="text-muted-foreground truncate text-xs">{u.email}</p>
                  <div className="mt-1 flex gap-1">
                    {u.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
                    {!u.active && <Badge variant="destructive">Desactivado</Badge>}
                    {!u.lastSignInAt && <Badge variant="outline">Invitación pendiente</Badge>}
                    {u.mustChangePassword && <Badge variant="outline">Contraseña temporal</Badge>}
                  </div>
                </div>
                {u.id !== auth.userId && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Button
                      variant={u.active ? 'outline' : 'default'}
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => {
                        if (u.active && !confirm(`¿Desactivar a ${u.email}?`)) return
                        toggle.mutate(u)
                      }}
                    >
                      {u.active ? 'Desactivar' : 'Reactivar'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={tempPassword.isPending}
                      onClick={() => {
                        if (
                          !confirm(
                            `¿Generar una contraseña temporal para ${u.displayName ?? u.email}? Su contraseña actual dejará de valer.`,
                          )
                        )
                          return
                        tempPassword.mutate(u)
                      }}
                    >
                      <KeyRound /> Generar contraseña temporal
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {temp && (
        <TempPasswordSheet
          user={temp.user}
          password={temp.password}
          onClose={() => setTemp(null)}
        />
      )}
    </Page>
  )
}

function TempPasswordSheet({
  user,
  password,
  onClose,
}: {
  user: AdminUser
  password: string
  onClose: () => void
}) {
  const text = `Tu contraseña temporal de Entrenador es: ${password}\nEntra con tu email (${user.email ?? ''}) en ${window.location.origin}/login y te pedirá cambiarla.`
  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      notifySaved('Contraseña copiada')
    } catch (error) {
      notifyError(error, 'copiar la contraseña')
    }
  }
  return (
    <Sheet open onClose={onClose} title="Contraseña temporal">
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Contraseña para <strong>{user.displayName ?? user.email}</strong>. Solo se muestra ahora:
          cópiala y envíasela. Al entrar tendrá que cambiarla.
        </p>
        <p
          className="bg-muted rounded-lg p-3 text-center font-mono text-xl font-semibold tracking-wider select-all"
          data-testid="temp-password"
        >
          {password}
        </p>
        <Button size="lg" onClick={() => void copy()}>
          <Copy /> Copiar contraseña
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Enviar por WhatsApp
          </a>
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Hecho
        </Button>
      </div>
    </Sheet>
  )
}

const settingsKey = ['admin', 'invite-settings'] as const

function InviteSettingsCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: settingsKey, queryFn: fetchInviteSettings })
  const [max, setMax] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (s: InviteSettings) => saveInviteSettings(s),
    onSuccess: () => notifySaved('Ajustes guardados'),
    onError: (error) => notifyError(error, 'guardar los ajustes'),
    onSettled: () => {
      setMax(null)
      void queryClient.invalidateQueries({ queryKey: settingsKey })
      void queryClient.invalidateQueries({ queryKey: ['invite-status'] })
    },
  })
  const s = settings.data
  const maxValue = max ?? String(s?.maxActivePerUser ?? 3)
  const parsedMax = Number(maxValue)
  const maxValid = Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= 50

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitaciones por enlace</CardTitle>
        <CardDescription>
          Tú siempre puedes invitar. Si lo activas, el resto también (desde Pareja y amigos).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {settings.isError && <p className="text-destructive text-sm">{settings.error.message}</p>}
        <div className="flex items-center justify-between gap-3">
          <span id="members_can_invite" className="text-sm font-medium">
            Permitir que los usuarios inviten
          </span>
          <Switch
            labelledBy="members_can_invite"
            checked={s?.membersCanInvite ?? false}
            disabled={!s || save.isPending}
            onChange={(next) =>
              s && save.mutate({ membersCanInvite: next, maxActivePerUser: s.maxActivePerUser })
            }
          />
        </div>
        {s?.membersCanInvite && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (maxValid) save.mutate({ membersCanInvite: true, maxActivePerUser: parsedMax })
            }}
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="max_active">Máximo de invitaciones activas por usuario</Label>
              <Input
                id="max_active"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={maxValue}
                onChange={(e) => setMax(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={!maxValid || save.isPending || max === null}
            >
              Guardar
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function AllInvitesCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const codes = useQuery({
    queryKey: inviteCodesKey(userId, true),
    queryFn: () => fetchInviteCodes(true),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInviteCode(id),
    onSuccess: () => notifySaved('Invitación anulada'),
    onError: (error) => notifyError(error, 'anular la invitación'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['invite-codes'] }),
  })
  if (!codes.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enlaces creados</CardTitle>
        <CardDescription>Los de todos los usuarios (los últimos 100).</CardDescription>
      </CardHeader>
      <CardContent>
        <InviteList
          codes={codes.data}
          showCreator
          busy={revoke.isPending}
          onRevoke={(c) => {
            if (confirm(`¿Anular la invitación ${c.code}?`)) revoke.mutate(c.id)
          }}
        />
      </CardContent>
    </Card>
  )
}
