import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/page'
import { inviteUser, listUsers, setUserActive, type AdminUser } from '@/server/admin.functions'

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
  const [email, setEmail] = useState('')

  const users = useQuery({ queryKey: usersQueryKey, queryFn: () => listUsersFn(), retry: 1 })

  const invite = useMutation({
    mutationFn: (value: string) => inviteFn({ data: { email: value } }),
    onSuccess: () => {
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: usersQueryKey })
    },
  })

  const toggle = useMutation({
    mutationFn: (u: AdminUser) => setActiveFn({ data: { userId: u.id, active: !u.active } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate(email)
  }

  return (
    <Page title="Invitaciones">
      <Card>
        <CardHeader>
          <CardTitle>Invitar a alguien</CardTitle>
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
                  </div>
                </div>
                {u.id !== auth.userId && (
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
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Page>
  )
}
