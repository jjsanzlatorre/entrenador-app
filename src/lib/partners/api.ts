// Datos de las personas vinculadas (fase 7A). Cada lectura pasa por la RLS o por una RPC que
// comprueba el permiso correspondiente en la base de datos; nada se guarda en el móvil, así que
// quitar un permiso tiene efecto en la siguiente consulta.
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, toExercise, withTimeout } from '@/lib/workout/api'
import { fromServerRows } from '@/lib/workout/payload'
import type { Exercise, LocalSession } from '@/lib/workout/types'
import type { ExerciseSetCount } from '@/lib/progress/muscle-volume'
import type { Home } from '@/lib/progress/equivalences'
import type { SessionLogEntry } from '@/lib/progress/types'
import type {
  ExerciseRow,
  Json,
  MuscleRole,
  PairInviteStatus,
  ReactionEmoji,
  ReactionKind,
} from '@/types/database'
import type { PairTemplate } from './pair'

function db() {
  return getSupabaseBrowserClient()
}

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(friendly(res.error.message))
  return res.data as NonNullable<T>
}

function friendly(message: string) {
  if (/vinculados/.test(message)) return 'ya no estáis vinculados'
  if (/ya no está pendiente/.test(message)) return 'la invitación ya no está pendiente'
  if (/No te comparte/.test(message)) return 'esa persona ya no te lo comparte'
  return message
}

function requireOnline(message = 'Necesitas conexión') {
  if (!isOnline()) throw new OfflineError(message)
}

const num = (v: number | string | null) => (v === null ? null : Number(v))

// ── Lecturas de la otra persona ─────────────────────────────

// Sesiones para el mapa/carga (RPE) y los logros (distancia, tonelaje, reps); cada columna
// llega vacía si ese permiso no está activado.
export async function fetchPartnerSessionLog(partnerId: string): Promise<SessionLogEntry[]> {
  const rows = check(await withTimeout(db().rpc('partner_sessions', { p_partner: partnerId })))
  return (rows ?? []).map((r) => ({
    id: r.id,
    sessionType: r.session_type,
    activityTypeId: r.activity_type_id ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMin: r.duration_min,
    rpe: r.rpe,
    distanceM: num(r.distance_m),
    tonnageKg: num(r.tonnage_kg) ?? 0,
    totalReps: num(r.total_reps) ?? 0,
  }))
}

export async function fetchPartnerSetCounts(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<ExerciseSetCount[]> {
  const rows = check(
    await withTimeout(
      db().rpc('partner_exercise_sets', {
        p_partner: partnerId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      }),
    ),
  )
  return (rows ?? []).map((r) => ({
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    sets: Number(r.sets),
  }))
}

export async function fetchPartnerHome(partnerId: string): Promise<Home | null> {
  const rows = check(await withTimeout(db().rpc('partner_home', { p_partner: partnerId })))
  const r = rows?.[0]
  if (!r?.home_city || r.home_lat === null || r.home_lng === null) return null
  return { city: r.home_city, lat: r.home_lat, lng: r.home_lng }
}

// Ejercicios propios de la otra persona (para ver sus nombres y músculos).
export async function fetchPartnerExercises(partnerId: string): Promise<Exercise[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('exercises')
        .select('*, exercise_muscles(muscle_id, role)')
        .eq('owner_id', partnerId),
    ),
  )
  type Row = ExerciseRow & { exercise_muscles: { muscle_id: string; role: MuscleRole }[] }
  return (rows as Row[]).map(toExercise)
}

// Sesión de la otra persona en solo lectura (requiere que comparta sus entrenos).
export async function fetchPartnerSession(
  partnerId: string,
  sessionId: string,
): Promise<LocalSession | null> {
  const client = db()
  const [session, blocks, sets] = await withTimeout(
    Promise.all([
      client
        .from('workout_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', partnerId)
        .maybeSingle(),
      client
        .from('session_blocks')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', partnerId),
      client.from('exercise_sets').select('*').eq('session_id', sessionId).eq('user_id', partnerId),
    ]),
  )
  const error = session.error ?? blocks.error ?? sets.error
  if (error) throw new Error(error.message)
  if (!session.data) return null
  return fromServerRows(session.data, blocks.data ?? [], sets.data ?? [], 'edit')
}

// ── Entreno en pareja ───────────────────────────────────────

export type PairInvite = {
  id: string
  pairGroupId: string
  fromUser: string
  toUser: string
  payload: Json
  status: PairInviteStatus
  createdAt: string
}

type InviteRow = {
  id: string
  pair_group_id: string
  from_user: string
  to_user: string
  payload: Json
  status: PairInviteStatus
  created_at: string
}

const toInvite = (r: InviteRow): PairInvite => ({
  id: r.id,
  pairGroupId: r.pair_group_id,
  fromUser: r.from_user,
  toUser: r.to_user,
  payload: r.payload,
  status: r.status,
  createdAt: r.created_at,
})

// Las invitaciones caducan a las 12 h: pasado ese tiempo ya no tiene sentido unirse.
export const PAIR_INVITE_TTL_MS = 12 * 3600 * 1000

export async function fetchPendingPairInvites(userId: string, now = Date.now()) {
  const since = new Date(now - PAIR_INVITE_TTL_MS).toISOString()
  const rows = check(
    await withTimeout(
      db()
        .from('pair_invites')
        .select('id, pair_group_id, from_user, to_user, payload, status, created_at')
        .eq('to_user', userId)
        .eq('status', 'pending')
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
    ),
  )
  return (rows as InviteRow[]).map(toInvite)
}

export async function fetchPairInvites(pairGroupId: string) {
  const rows = check(
    await withTimeout(
      db()
        .from('pair_invites')
        .select('id, pair_group_id, from_user, to_user, payload, status, created_at')
        .eq('pair_group_id', pairGroupId),
    ),
  )
  return (rows as InviteRow[]).map(toInvite)
}

export async function createPairInvite(
  partnerId: string,
  pairGroupId: string,
  template: PairTemplate,
) {
  requireOnline('Necesitas conexión para invitar a entrenar juntos')
  return check(
    await withTimeout(
      db().rpc('create_pair_invite', {
        p_partner: partnerId,
        p_pair_group_id: pairGroupId,
        p_payload: template as unknown as Json,
      }),
    ),
  )
}

export async function updatePairInvite(inviteId: string, template: PairTemplate) {
  requireOnline()
  check(
    await withTimeout(
      db().rpc('update_pair_invite', {
        p_invite: inviteId,
        p_payload: template as unknown as Json,
      }),
    ),
  )
}

export async function respondPairInvite(inviteId: string, accept: boolean) {
  requireOnline()
  check(
    await withTimeout(db().rpc('respond_pair_invite', { p_invite: inviteId, p_accept: accept })),
  )
}

export async function cancelPairInvite(inviteId: string) {
  requireOnline()
  check(await withTimeout(db().rpc('cancel_pair_invite', { p_invite: inviteId })))
}

// Sesión de la otra persona del mismo entreno en pareja (solo si me comparte sus entrenos).
export async function fetchPairPartnerSession(pairGroupId: string, partnerId: string) {
  const { data, error } = await withTimeout(
    db()
      .from('workout_sessions')
      .select('id')
      .eq('pair_group_id', pairGroupId)
      .eq('user_id', partnerId)
      .limit(1),
  )
  if (error) throw new Error(error.message)
  const id = data?.[0]?.id
  return id ? fetchPartnerSession(partnerId, id) : null
}

// ── Reacciones ──────────────────────────────────────────────

export type Reaction = {
  id: string
  fromUser: string
  toUser: string
  kind: ReactionKind
  key: string
  emoji: ReactionEmoji
  createdAt: string
  seenAt: string | null
}

export { REACTION_EMOJI, REACTION_LABEL } from './labels'

// Reacciones que he puesto o recibido (las de los últimos 60 días bastan para la UI).
export async function fetchReactions(now = Date.now()): Promise<Reaction[]> {
  const since = new Date(now - 60 * 24 * 3600 * 1000).toISOString()
  const rows = check(
    await withTimeout(
      db()
        .from('reactions')
        .select('id, from_user, to_user, target_kind, target_key, emoji, created_at, seen_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
    ),
  )
  return rows.map((r) => ({
    id: r.id,
    fromUser: r.from_user,
    toUser: r.to_user,
    kind: r.target_kind,
    key: r.target_key,
    emoji: r.emoji,
    createdAt: r.created_at,
    seenAt: r.seen_at,
  }))
}

export async function toggleReaction(
  to: string,
  kind: ReactionKind,
  key: string,
  emoji: ReactionEmoji,
) {
  requireOnline('Necesitas conexión para reaccionar')
  return check(
    await withTimeout(
      db().rpc('toggle_reaction', { p_to: to, p_kind: kind, p_key: key, p_emoji: emoji }),
    ),
  )
}

export async function markReactionsSeen() {
  requireOnline()
  return check(await withTimeout(db().rpc('mark_reactions_seen')))
}
