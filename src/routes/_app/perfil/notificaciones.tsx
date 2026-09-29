import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Copy, KeyRound, Send, Smartphone } from 'lucide-react'
import { BackLink } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import {
  currentSubscription,
  disablePush,
  enablePush,
  fetchNotificationSettings,
  generateVapidKeys,
  notificationSettingsKey,
  pushSupport,
  randomSecret,
  REMINDER_TIMES,
  saveNotificationSettings,
  sendTestNotification,
  usePushServerStatus,
  type NotificationSettings,
  type PushSupport,
} from '@/lib/notifications/push'

export const Route = createFileRoute('/_app/perfil/notificaciones')({
  component: NotificationsPage,
})

function NotificationsPage() {
  const { auth } = Route.useRouteContext()
  const server = usePushServerStatus()
  const isAdmin = auth.profile.role === 'admin'

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="text-2xl font-bold">Notificaciones</h1>

      {server.isPending && <p className="text-muted-foreground">Cargando…</p>}
      {server.isError && (
        <p className="text-muted-foreground">
          Necesitas conexión para configurar las notificaciones.
        </p>
      )}
      {server.data && !server.data.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellOff className="size-5" /> Notificaciones sin configurar
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? `Falta configurar las claves en Vercel (${server.data.problem ?? 'sin claves'}).`
                : 'El administrador aún no ha activado las notificaciones.'}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {server.data?.configured && server.data.publicKey && (
        <>
          <DeviceCard publicKey={server.data.publicKey} />
          <PreferencesCard userId={auth.userId} />
        </>
      )}
      {isAdmin && <KeysCard configured={Boolean(server.data?.configured)} />}
    </div>
  )
}

function supportText(s: PushSupport) {
  if (s.ok) return null
  if (s.reason === 'ios_not_installed')
    return 'En iPhone y iPad las notificaciones solo funcionan con la app instalada: en Safari, Compartir → «Añadir a pantalla de inicio», y ábrela desde el icono.'
  if (s.reason === 'denied')
    return 'Has bloqueado las notificaciones para esta app. Actívalas en los ajustes del navegador o del sistema y vuelve aquí.'
  return 'Este navegador no admite notificaciones push.'
}

function DeviceCard({ publicKey }: { publicKey: string }) {
  const [support, setSupport] = useState<PushSupport | null>(() =>
    typeof window === 'undefined' ? null : pushSupport(),
  )
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(Boolean(s)))
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      if (next) {
        await enablePush(publicKey)
        notifySaved('Notificaciones activadas en este dispositivo')
      } else {
        await disablePush()
        notifySaved('Notificaciones desactivadas en este dispositivo')
      }
      setSubscribed(next)
    } catch (error) {
      notifyError(error, next ? 'activar las notificaciones' : 'desactivarlas')
    } finally {
      setSupport(pushSupport())
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const res = await sendTestNotification()
      if (res.sent > 0) notifySaved('Enviada. Debería llegar en unos segundos.')
      else if (res.skipped === 'no_subscriptions')
        notifyWarning('Este usuario no tiene ningún dispositivo con notificaciones activadas.')
      else notifyWarning('No se ha podido entregar. Prueba a desactivar y activar de nuevo.')
    } catch (error) {
      notifyError(error, 'enviar la prueba')
    } finally {
      setBusy(false)
    }
  }

  const problem = support ? supportText(support) : null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" /> Este dispositivo
        </CardTitle>
        <CardDescription>
          Se activan en cada móvil por separado. Puedes desactivarlas cuando quieras.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {problem ? (
          <p className="bg-muted rounded-xl p-3 text-sm">{problem}</p>
        ) : (
          <div className="flex items-center gap-3">
            <p id="push-device" className="flex-1 font-medium">
              Recibir notificaciones aquí
            </p>
            <Switch
              checked={Boolean(subscribed)}
              labelledBy="push-device"
              disabled={busy || subscribed === null}
              onChange={(next) => void toggle(next)}
            />
          </div>
        )}
        {subscribed && (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void test()}>
            <Send /> Enviar una prueba
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

const PREFS: {
  key: 'pairInvites' | 'reactions' | 'planReminder' | 'behindNudge'
  label: string
  hint: string
}[] = [
  {
    key: 'pairInvites',
    label: 'Invitaciones a entrenar juntos',
    hint: 'Cuando alguien vinculado te invita a su entreno.',
  },
  {
    key: 'reactions',
    label: 'Reacciones 👏 🔥 💪',
    hint: 'Una por persona y semana o sesión, aunque cambie de emoji.',
  },
  {
    key: 'planReminder',
    label: 'Recordatorio de la sesión del día',
    hint: 'Si tienes una sesión planificada pendiente para hoy.',
  },
  {
    key: 'behindNudge',
    label: 'Aviso si la semana va por detrás',
    hint: 'Suave, como mucho uno al día y solo si hoy aún no has entrenado.',
  },
]

function PreferencesCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const key = notificationSettingsKey(userId)
  const settings = useQuery({ queryKey: key, queryFn: () => fetchNotificationSettings(userId) })
  const [saving, setSaving] = useState(false)

  async function save(next: NotificationSettings, message: string) {
    setSaving(true)
    try {
      const saved = await saveNotificationSettings(userId, next)
      queryClient.setQueryData(key, saved)
      notifySaved(message)
    } catch (error) {
      notifyError(error, 'guardar la preferencia')
    } finally {
      setSaving(false)
    }
  }

  if (settings.isPending) return <p className="text-muted-foreground">Cargando…</p>
  if (settings.isError || !settings.data)
    return <p className="text-muted-foreground">No se han podido cargar tus preferencias.</p>
  const s = settings.data
  const timed = s.planReminder || s.behindNudge

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5" /> Qué quieres recibir
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <ul className="flex flex-col divide-y">
          {PREFS.map((p) => {
            const id = `pref-${p.key}`
            return (
              <li key={p.key} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p id={id} className="font-medium">
                    {p.label}
                  </p>
                  <p className="text-muted-foreground text-sm">{p.hint}</p>
                </div>
                <Switch
                  checked={s[p.key]}
                  labelledBy={id}
                  disabled={saving}
                  onChange={(on) =>
                    void save(
                      { ...s, [p.key]: on },
                      `${p.label}: ${on ? 'activado' : 'desactivado'}`,
                    )
                  }
                />
              </li>
            )
          })}
        </ul>
        {timed && (
          <div className="flex flex-col gap-2 pt-2">
            <Label htmlFor="reminder-time">Hora del aviso diario</Label>
            <select
              id="reminder-time"
              value={s.reminderTime}
              disabled={saving}
              onChange={(e) =>
                void save({ ...s, reminderTime: e.target.value }, `Aviso a las ${e.target.value}`)
              }
              className="border-input bg-background h-12 rounded-md border px-3 text-base"
            >
              {REMINDER_TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-sm">
              Como mucho una notificación al día, que junta la sesión de hoy y el aviso de la
              semana. Puede llegar hasta 15 min más tarde. Se usa la zona horaria de este móvil.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Solo admin: generar las claves VAPID y el secreto del cron sin terminal.
function KeysCard({ configured }: { configured: boolean }) {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string; cron: string } | null>(
    null,
  )

  async function generate() {
    try {
      const vapid = await generateVapidKeys()
      setKeys({ ...vapid, cron: randomSecret() })
    } catch (error) {
      notifyError(error, 'generar las claves')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" /> Claves (solo admin)
        </CardTitle>
        <CardDescription>
          {configured
            ? 'Las claves ya están configuradas. Si las cambias, cada persona tendrá que volver a activar las notificaciones en su móvil.'
            : 'Genera las claves aquí (no salen de este navegador) y pégalas en Vercel → Settings → Environment Variables. Después, Redeploy. Pasos completos en el README.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button variant="outline" size="lg" onClick={() => void generate()}>
          <KeyRound /> Generar claves nuevas
        </Button>
        {keys && (
          <>
            <SecretRow name="VAPID_PUBLIC_KEY" value={keys.publicKey} />
            <SecretRow name="VAPID_PRIVATE_KEY" value={keys.privateKey} />
            <SecretRow name="CRON_SECRET" value={keys.cron} />
            <p className="text-muted-foreground text-sm">
              Añade también <code>VAPID_SUBJECT</code> = <code>mailto:tu@email</code>. El mismo
              CRON_SECRET va en <code>supabase/snippets/push_cron.sql</code>. No compartas la clave
              privada ni el secreto.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SecretRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold">{name}</p>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 rounded-md p-2 text-xs break-all">{value}</code>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copiar ${name}`}
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => notifySaved(`${name} copiada`))
              .catch((e: unknown) => notifyError(e, 'copiar'))
          }
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}
