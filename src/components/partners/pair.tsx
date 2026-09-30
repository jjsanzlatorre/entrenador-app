// Entreno en pareja (§7, fase 7A): «Entrenar con…», invitación en «Hoy», aviso en la sesión en
// curso y comparación lado a lado en el resumen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { ReactionBar } from '@/components/partners/reactions'
import { createCustomActivity, fetchActivityTypes } from '@/lib/activities/api'
import { addActivityTypes, customActivities } from '@/lib/activities/catalog'
import { activityTypesQueryKey } from '@/lib/activities/hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet } from '@/components/ui/sheet'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import {
  cancelPairInvite,
  createPairInvite,
  fetchPairInvites,
  fetchPairPartnerSession,
  respondPairInvite,
  updatePairInvite,
  type PairInvite,
} from '@/lib/partners/api'
import { pairInvitesKey, usePairInvites, usePendingPairInvites } from '@/lib/partners/hooks'
import { pushPairInvite } from '@/lib/notifications/push'
import {
  comparePairSessions,
  matchPairActivity,
  pairTemplateFromSession,
  pairTemplateSignature,
  parsePairTemplate,
  sessionFromPairTemplate,
  templateExerciseCount,
  type PairTemplate,
} from '@/lib/partners/pair'
import type { PartnerLink } from '@/lib/progress/api'
import { usePartnerLinks } from '@/lib/progress/hooks'
import { preparePlannedSession } from '@/lib/plan/start'
import type { PlannedSession } from '@/lib/plan/api'
import { loadActiveSession, startPreparedSession } from '@/lib/workout/active-session'
import { getLastPerformance } from '@/lib/workout/api'
import { sessionStats } from '@/lib/workout/calc'
import { formatInt, formatKg } from '@/lib/workout/format'
import { useCatalog } from '@/lib/workout/hooks'
import {
  createActivitySession,
  createSessionOfType,
  sessionTypeEmoji,
} from '@/lib/workout/session-kinds'
import type { Exercise, LocalSession } from '@/lib/workout/types'
import type { SessionType } from '@/types/database'

// Los ejercicios propios (ids «u_…») no se mandan: la otra persona no los tiene.
const isShareable = (exerciseId: string) => !exerciseId.startsWith('u_')

export function useAcceptedPartners(userId: string) {
  const links = usePartnerLinks(userId)
  return (links.data ?? []).filter((l) => l.status === 'accepted')
}

type Partner = Pick<PartnerLink, 'partnerId' | 'displayName'>
type Startable = Pick<PlannedSession, 'id' | 'sessionType' | 'title' | 'blocks'>

// Empieza mi sesión con un pair_group_id nuevo y manda la estructura a la otra persona.
export function usePairStart(userId: string) {
  const navigate = useNavigate()
  const catalog = useCatalog(userId)
  const [busy, setBusy] = useState(false)

  async function start(build: () => Promise<LocalSession>, partner: Partner) {
    setBusy(true)
    try {
      if (await loadActiveSession(userId)) {
        notifyError('ya tienes una sesión en curso; termínala o descártala antes', 'empezar')
        return
      }
      const pairGroupId = crypto.randomUUID()
      const session = { ...(await build()), pairGroupId }
      const { template, skipped } = pairTemplateFromSession(session, isShareable)
      const inviteId = await createPairInvite(partner.partnerId, pairGroupId, template)
      pushPairInvite(inviteId)
      await startPreparedSession(session)
      notifySaved(`Invitación enviada a ${partner.displayName}`)
      if (skipped > 0) notifyWarning('Tus ejercicios propios no se comparten: no los tiene.')
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'invitar a entrenar juntos')
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    startFree: (type: SessionType, partner: Partner) =>
      start(async () => createSessionOfType(userId, type, Date.now()), partner),
    startPlanned: (planned: Startable, partner: Partner) =>
      start(() => preparePlannedSession(planned, userId, catalog.byId), partner),
    // Deportes, clases y actividades personalizadas (cronómetro continuo).
    startActivity: (activityId: string, partner: Partner) =>
      start(async () => createActivitySession(userId, activityId, Date.now()), partner),
  }
}

// Actividad personalizada de la invitación: la mía con el mismo nombre o, si no tengo, una nueva
// con su nombre, emoji y músculos. null si no se puede (se entrena como «otra»).
async function resolvePairActivity(
  userId: string,
  activity: NonNullable<PairTemplate['activity']>,
): Promise<{ id: string; created: boolean } | null> {
  try {
    await fetchActivityTypes(userId)
    const mine = matchPairActivity(activity, customActivities(userId))
    if (mine) return { id: mine.id, created: false }
    const created = await createCustomActivity(userId, {
      name: activity.name,
      emoji: activity.emoji,
      muscles: activity.muscles,
    })
    addActivityTypes([created])
    return { id: created.id, created: true }
  } catch (error) {
    console.error('[pair] actividad personalizada', error)
    return null
  }
}

// Hoja para elegir con quién entrenar (personas con el vínculo aceptado).
export function PartnerPickerSheet({
  open,
  partners,
  onClose,
  onPick,
}: {
  open: boolean
  partners: PartnerLink[]
  onClose: () => void
  onPick: (partner: PartnerLink) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="¿Con quién entrenas?">
      <div className="flex flex-col gap-2 pb-2">
        {partners.map((p) => (
          <button
            key={p.partnerId}
            type="button"
            onClick={() => onPick(p)}
            className="bg-secondary flex h-14 items-center gap-3 rounded-2xl px-4 text-lg font-semibold active:scale-[0.98]"
          >
            <Users className="size-5" /> {p.displayName}
          </button>
        ))}
        <p className="text-muted-foreground text-center text-sm">
          Le llegará la misma sesión a su móvil y cada uno apuntará sus pesos.
        </p>
      </div>
    </Sheet>
  )
}

// Botón «Entrenar con…» para una sesión planificada.
export function PlannedPairButton({
  userId,
  planned,
  disabled,
}: {
  userId: string
  planned: Startable
  disabled?: boolean
}) {
  const partners = useAcceptedPartners(userId)
  const pair = usePairStart(userId)
  const [open, setOpen] = useState(false)
  if (partners.length === 0) return null
  return (
    <>
      <Button
        variant="outline"
        size="lg"
        disabled={disabled || pair.busy}
        onClick={() => setOpen(true)}
      >
        <Users /> Entrenar con…
      </Button>
      <PartnerPickerSheet
        open={open}
        partners={partners}
        onClose={() => setOpen(false)}
        onPick={(p) => {
          setOpen(false)
          void pair.startPlanned(planned, p)
        }}
      />
    </>
  )
}

// «Hoy»: invitaciones recibidas para entrenar juntos.
export function PairInviteCards({ userId, canStart }: { userId: string; canStart: boolean }) {
  const invites = usePendingPairInvites(userId)
  const partners = useAcceptedPartners(userId)
  const names = new Map(partners.map((p) => [p.partnerId, p.displayName]))
  const list = (invites.data ?? []).filter((i) => names.has(i.fromUser))
  if (list.length === 0) return null
  return (
    <>
      {list.map((invite) => (
        <PairInviteCard
          key={invite.id}
          userId={userId}
          invite={invite}
          name={names.get(invite.fromUser)!}
          canStart={canStart}
        />
      ))}
    </>
  )
}

function PairInviteCard({
  userId,
  invite,
  name,
  canStart,
}: {
  userId: string
  invite: PairInvite
  name: string
  canStart: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const [busy, setBusy] = useState(false)
  const template = parsePairTemplate(invite.payload)

  async function join() {
    if (!template) return
    setBusy(true)
    try {
      if (await loadActiveSession(userId)) {
        notifyError('ya tienes una sesión en curso; termínala o descártala antes', 'unirte')
        return
      }
      // La estructura puede haber cambiado desde la última consulta: se usa la más reciente.
      let latest = template
      try {
        const fresh = (await fetchPairInvites(invite.pairGroupId)).find((i) => i.id === invite.id)
        latest = (fresh && parsePairTemplate(fresh.payload)) || template
      } catch {
        // sin conexión se usará la copia que ya tenemos (y fallará al responder)
      }
      const ids = [...new Set(latest.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id)))]
      let last = new Map()
      try {
        last = await getLastPerformance(userId, ids, null)
      } catch {
        // sin precarga de pesos
      }
      const activity = latest.activity ? await resolvePairActivity(userId, latest.activity) : null
      if (latest.activity && !activity) {
        notifyWarning(`No se ha podido crear «${latest.activity.name}»: se guardará como «Otra».`)
      }
      if (activity?.created) {
        notifySaved(`«${latest.activity!.name}» añadida a tus actividades`)
        void queryClient.invalidateQueries({ queryKey: activityTypesQueryKey(userId) })
      }
      const session = sessionFromPairTemplate(latest, {
        userId,
        pairGroupId: invite.pairGroupId,
        known: (id) => catalog.byId.size === 0 || catalog.byId.has(id),
        last,
        activityTypeId: activity?.id ?? null,
      })
      await respondPairInvite(invite.id, true)
      await startPreparedSession(session)
      await queryClient.invalidateQueries({ queryKey: pairInvitesKey(userId) })
      await navigate({ to: '/entrenar/sesion' })
    } catch (error) {
      notifyError(error, 'unirte al entreno')
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    setBusy(true)
    try {
      await respondPairInvite(invite.id, false)
      await queryClient.invalidateQueries({ queryKey: pairInvitesKey(userId) })
    } catch (error) {
      notifyError(error, 'rechazar la invitación')
    } finally {
      setBusy(false)
    }
  }

  const count = template ? templateExerciseCount(template) : 0
  return (
    <div className="border-primary bg-primary/5 flex flex-col gap-3 rounded-2xl border-2 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-3xl">
          {template ? (template.activity?.emoji ?? sessionTypeEmoji(template.session_type)) : '🤝'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-tight font-bold">{name} te invita a entrenar juntos</p>
          {template ? (
            <p className="text-muted-foreground text-sm">
              {template.activity && template.activity.name !== template.title
                ? `${template.activity.name} · `
                : ''}
              {template.title}
              {count > 0 ? ` · ${count} ${count === 1 ? 'ejercicio' : 'ejercicios'}` : ''}. Cada uno
              apunta sus pesos en su móvil.
            </p>
          ) : (
            <p className="text-destructive text-sm">
              La invitación no se puede leer. Pídele que la vuelva a enviar.
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" disabled={busy || !template || !canStart} onClick={() => void join()}>
          Unirme
        </Button>
        <Button size="lg" variant="outline" disabled={busy} onClick={() => void decline()}>
          Ahora no
        </Button>
      </div>
      {!canStart && (
        <p className="text-muted-foreground text-xs">
          Termina o descarta tu sesión en curso para unirte.
        </p>
      )}
    </div>
  )
}

// Aviso en la sesión en curso: con quién se entrena y, mientras la otra persona no se haya unido,
// la estructura se le reenvía sola al añadir, quitar o reordenar ejercicios (fase 7B). El botón
// manual solo aparece si la sincronización falla.
const PAIR_SYNC_DELAY_MS = 1500

export function PairBanner({ session }: { session: LocalSession }) {
  const invites = usePairInvites(session.pairGroupId, session.mode === 'live')
  const partners = useAcceptedPartners(session.userId)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('idle')
  const [online, setOnline] = useState(0)
  const lastSent = useRef<string | null>(null)
  const invite = invites.data?.[0]
  const sent = invite?.fromUser === session.userId
  const syncing = Boolean(invite && sent && invite.status === 'pending' && session.mode === 'live')
  const template = useMemo(
    () =>
      pairTemplateFromSession(
        {
          sessionType: session.sessionType,
          activityTypeId: session.activityTypeId,
          title: session.title,
          location: session.location,
          blocks: session.blocks,
        },
        isShareable,
      ).template,
    [session.sessionType, session.activityTypeId, session.title, session.location, session.blocks],
  )
  const signature = pairTemplateSignature(template)

  // Lo último que tiene la otra persona es lo que hay en la invitación.
  useEffect(() => {
    if (invite && lastSent.current === null)
      lastSent.current = pairTemplateSignature(invite.payload)
  }, [invite])

  useEffect(() => {
    const onOnline = () => setOnline((n) => n + 1)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  useEffect(() => {
    if (!syncing || !invite || lastSent.current === null || lastSent.current === signature) return
    const timer = setTimeout(() => {
      setSyncState('syncing')
      updatePairInvite(invite.id, template)
        .then(() => {
          lastSent.current = signature
          setSyncState('idle')
        })
        .catch((error: unknown) => {
          // Si ya se ha unido (o rechazado), no es un fallo: se actualiza el estado.
          if (error instanceof Error && /ya no está pendiente/.test(error.message)) {
            setSyncState('idle')
            void queryClient.invalidateQueries({ queryKey: ['pair-group', session.pairGroupId] })
            return
          }
          console.warn('[pair] no se pudo sincronizar la estructura', error)
          setSyncState('error')
        })
    }, PAIR_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
  }, [syncing, invite, signature, template, online, queryClient, session.pairGroupId])

  if (!session.pairGroupId) return null
  const otherId = invite
    ? invite.fromUser === session.userId
      ? invite.toUser
      : invite.fromUser
    : null
  const name = partners.find((p) => p.partnerId === otherId)?.displayName ?? 'tu compañero'

  async function run(action: () => Promise<void>, ok: string, label: string) {
    setBusy(true)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['pair-group', session.pairGroupId] })
      notifySaved(ok)
    } catch (error) {
      notifyError(error, label)
    } finally {
      setBusy(false)
    }
  }

  const text = !invite
    ? 'Entreno en pareja'
    : !sent
      ? `Entrenando con ${name}`
      : invite.status === 'pending'
        ? `Esperando a que ${name} se una`
        : invite.status === 'accepted'
          ? `${name} se ha unido`
          : invite.status === 'declined'
            ? `${name} no se une esta vez`
            : 'Invitación cancelada'

  return (
    <div className="bg-muted flex flex-col gap-2 rounded-xl p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Users className="text-primary size-4" /> {text}
      </p>
      {syncing && invite && (
        <>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {syncState === 'error'
              ? 'No se ha podido enviar el último cambio.'
              : syncState === 'syncing'
                ? 'Enviando los cambios…'
                : 'Los cambios en los ejercicios le llegan solos hasta que se una.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {syncState === 'error' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => {
                      await updatePairInvite(invite.id, template)
                      lastSent.current = signature
                      setSyncState('idle')
                    },
                    `Estructura enviada a ${name}`,
                    'enviar la estructura',
                  )
                }
              >
                Enviarle la estructura actual
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => cancelPairInvite(invite.id), 'Invitación cancelada', 'cancelar')
              }
            >
              Cancelar invitación
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function best(stats: { bestKg: number | null; bestReps: number | null; sets: number }) {
  if (stats.sets === 0) return '—'
  if (stats.bestKg !== null) return `${formatKg(stats.bestKg)} kg × ${stats.bestReps ?? 0}`
  return stats.bestReps ? `${stats.bestReps} reps` : `${stats.sets} series`
}

// Resumen: comparación lado a lado si los dos os compartís los entrenos.
export function PairComparison({
  userId,
  session,
  byId,
}: {
  userId: string
  session: LocalSession
  byId: Map<string, Exercise>
}) {
  const invites = usePairInvites(session.pairGroupId)
  const links = usePartnerLinks(userId)
  const invite = invites.data?.[0]
  const partnerId = invite ? (invite.fromUser === userId ? invite.toUser : invite.fromUser) : null
  const link = links.data?.find((l) => l.partnerId === partnerId && l.status === 'accepted')
  const both = Boolean(link?.iShare.sessions && link.theyShare.sessions)
  const theirs = useQuery({
    queryKey: ['pair-partner-session', session.pairGroupId, partnerId],
    queryFn: () => fetchPairPartnerSession(session.pairGroupId!, partnerId!),
    enabled: both && Boolean(partnerId),
    retry: false,
  })

  if (!invite || !link) return null
  const name = link.displayName

  if (!both) {
    return (
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <Users className="mt-0.5 size-4 shrink-0" />
        Entreno con {name}. Para compararos aquí, los dos tenéis que compartir «Entrenos» (Perfil →
        Pareja y amigos).
      </p>
    )
  }

  const other = theirs.data
  const rows = other ? comparePairSessions(session, other) : []
  const a = sessionStats(session)
  const b = other ? sessionStats(other) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" /> Con {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {theirs.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
        {theirs.isError && (
          <p className="text-muted-foreground text-sm">La comparación necesita conexión.</p>
        )}
        {theirs.isSuccess && !other && (
          <p className="text-muted-foreground text-sm">{name} aún no ha guardado su sesión.</p>
        )}
        {other && b && (
          <>
            {!other.endedAt && (
              <p className="text-muted-foreground text-xs">{name} aún no ha terminado.</p>
            )}
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="pb-1 font-normal" />
                  <th className="pb-1 text-right font-normal">Tú</th>
                  <th className="max-w-24 truncate pb-1 text-right font-normal">{name}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t">
                  <td className="py-1.5">Duración</td>
                  <td className="text-right">{session.durationMin ?? '—'} min</td>
                  <td className="text-right">{other.durationMin ?? '—'} min</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5">Volumen</td>
                  <td className="text-right">{formatInt(a.tonnageKg)} kg</td>
                  <td className="text-right">{formatInt(b.tonnageKg)} kg</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5">Series</td>
                  <td className="text-right">{a.completedSets}</td>
                  <td className="text-right">{b.completedSets}</td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.exerciseId} className="border-t">
                    <td className="py-1.5 pr-2">
                      <span className="block truncate">
                        {byId.get(r.exerciseId)?.name ?? r.exerciseId}
                      </span>
                      <span className="text-muted-foreground text-[11px]">mejor serie</span>
                    </td>
                    <td className="text-right">{best(r.mine)}</td>
                    <td className="text-right">{best(r.theirs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {other.endedAt && (
              <ReactionBar
                userId={userId}
                to={link.partnerId}
                toName={name}
                kind="session"
                targetKey={other.id}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
