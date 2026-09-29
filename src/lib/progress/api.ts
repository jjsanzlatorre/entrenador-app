// Acceso a datos de Progreso (Supabase + RLS). Todas las consultas filtran por user_id:
// con los vínculos, la RLS también deja leer datos que la pareja comparte.
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import type { Json, PhotoPose, SessionType, TablesUpdate } from '@/types/database'
import type { EquivalenceCatalog, Home } from './equivalences'
import type { ExerciseSetSample } from './exercise-progress'
import type { ExerciseSetCount } from './muscle-volume'
import type { PersonalRecord } from './records'
import type { ActivityDay, Commitment, SessionLogEntry } from './types'

function db() {
  return getSupabaseBrowserClient()
}

// Lanza el error de Supabase; si no hay error, las consultas de lista siempre traen datos.
function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message)
  return res.data as NonNullable<T>
}

const num = (v: number | string | null) => (v === null ? null : Number(v))

// ── Sesiones (para resúmenes y cumplimiento) ────────────────

export async function fetchSessionLog(userId: string): Promise<SessionLogEntry[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('workout_sessions')
        .select(
          'id, session_type, started_at, ended_at, duration_min, rpe, distance_m, planned_session_id',
        )
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .order('started_at'),
    ),
  )
  return rows.map((r) => ({
    id: r.id,
    sessionType: r.session_type,
    startedAt: r.started_at,
    endedAt: r.ended_at!,
    durationMin: r.duration_min,
    rpe: r.rpe,
    distanceM: num(r.distance_m),
    plannedSessionId: r.planned_session_id,
  }))
}

// ── Compromiso ──────────────────────────────────────────────

type CommitmentRowLite = {
  id: string
  valid_from: string
  valid_to: string | null
  sessions_per_week: number
  minutes_per_week: number | null
  by_type: Json | null
  counts_free_activities: boolean
}

function toCommitment(r: CommitmentRowLite): Commitment {
  return {
    id: r.id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    sessionsPerWeek: r.sessions_per_week,
    minutesPerWeek: r.minutes_per_week,
    byType:
      r.by_type && typeof r.by_type === 'object' && !Array.isArray(r.by_type)
        ? (r.by_type as Partial<Record<SessionType, number>>)
        : null,
    countsFreeActivities: r.counts_free_activities,
  }
}

export async function fetchCommitments(userId: string): Promise<Commitment[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('commitments')
        .select(
          'id, valid_from, valid_to, sessions_per_week, minutes_per_week, by_type, counts_free_activities',
        )
        .eq('user_id', userId)
        .order('valid_from'),
    ),
  )
  return rows.map(toCommitment)
}

export type CommitmentInput = {
  validFrom: string
  sessionsPerWeek: number
  minutesPerWeek: number | null
  byType: Partial<Record<SessionType, number>> | null
  countsFreeActivities: boolean
}

export async function saveCommitment(input: CommitmentInput) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para guardar el compromiso')
  check(
    await withTimeout(
      db().rpc('set_commitment', {
        p_valid_from: input.validFrom,
        p_sessions_per_week: input.sessionsPerWeek,
        p_minutes_per_week: input.minutesPerWeek,
        p_by_type: input.byType,
        p_counts_free_activities: input.countsFreeActivities,
      }),
    ),
  )
}

// Quitar el compromiso: cierra el vigente hoy (valid_to = today) y conserva el historial.
export async function endCommitment(today: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para quitar el compromiso')
  const closed = check(await withTimeout(db().rpc('end_commitment', { p_today: today })))
  if (closed === 0) throw new Error('No tienes ningún compromiso vigente que quitar')
}

// Borrar una entrada del historial (creada por error).
export async function deleteCommitment(id: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para borrar el compromiso')
  const rows = check(await withTimeout(db().from('commitments').delete().eq('id', id).select('id')))
  if (rows.length === 0) throw new Error('No se ha podido borrar: el compromiso ya no existe')
}

// ── Récords ─────────────────────────────────────────────────

const PR_COLUMNS =
  'id, exercise_id, pr_type, value, unit, weight_kg, previous_value, session_id, achieved_at'

type PrRowLite = {
  id: string
  exercise_id: string
  pr_type: PersonalRecord['prType']
  value: number
  unit: string
  weight_kg: number | null
  previous_value: number | null
  session_id: string
  achieved_at: string
}

function toRecord(r: PrRowLite): PersonalRecord {
  return {
    id: r.id,
    exerciseId: r.exercise_id,
    prType: r.pr_type,
    value: Number(r.value),
    unit: r.unit,
    weightKg: num(r.weight_kg),
    previousValue: num(r.previous_value),
    sessionId: r.session_id,
    achievedAt: r.achieved_at,
  }
}

export async function fetchRecords(userId: string, exerciseId?: string) {
  let q = db().from('personal_records').select(PR_COLUMNS).eq('user_id', userId)
  if (exerciseId) q = q.eq('exercise_id', exerciseId)
  const rows = check(await withTimeout(q.order('achieved_at')))
  return (rows as PrRowLite[]).map(toRecord)
}

export async function fetchSessionRecords(sessionId: string) {
  const rows = check(
    await withTimeout(db().from('personal_records').select(PR_COLUMNS).eq('session_id', sessionId)),
  )
  return (rows as PrRowLite[]).map(toRecord)
}

// ── Gráficas por ejercicio ──────────────────────────────────

export async function fetchExerciseSamples(
  userId: string,
  exerciseId: string,
): Promise<ExerciseSetSample[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('exercise_sets')
        .select(
          'session_id, is_warmup, completed, weight_kg, reps, duration_s, distance_m, workout_sessions!inner(ended_at)',
        )
        .eq('user_id', userId)
        .eq('exercise_id', exerciseId)
        .eq('completed', true)
        .not('workout_sessions.ended_at', 'is', null),
    ),
  )
  type Row = {
    session_id: string
    is_warmup: boolean
    completed: boolean
    weight_kg: number | null
    reps: number | null
    duration_s: number | null
    distance_m: number | null
    workout_sessions: { ended_at: string | null } | { ended_at: string | null }[] | null
  }
  return (rows as unknown as Row[]).flatMap((r) => {
    const ws = Array.isArray(r.workout_sessions) ? r.workout_sessions[0] : r.workout_sessions
    if (!ws?.ended_at) return []
    return [
      {
        sessionId: r.session_id,
        endedAt: ws.ended_at,
        isWarmup: r.is_warmup,
        completed: r.completed,
        weightKg: num(r.weight_kg),
        reps: r.reps,
        durationS: r.duration_s,
        distanceM: num(r.distance_m),
      },
    ]
  })
}

// ── Peso y medidas ──────────────────────────────────────────

export type BodyMetric = {
  id: string
  date: string
  weightKg: number | null
  bodyFatPct: number | null
  waistCm: number | null
  hipCm: number | null
  chestCm: number | null
  armCm: number | null
  thighCm: number | null
  notes: string | null
}

export type BodyMetricInput = Omit<BodyMetric, 'id'>

export async function fetchBodyMetrics(userId: string): Promise<BodyMetric[]> {
  const rows = check(
    await withTimeout(
      db().from('body_metrics').select('*').eq('user_id', userId).order('date', {
        ascending: true,
      }),
    ),
  )
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    weightKg: num(r.weight_kg),
    bodyFatPct: num(r.body_fat_pct),
    waistCm: num(r.waist_cm),
    hipCm: num(r.hip_cm),
    chestCm: num(r.chest_cm),
    armCm: num(r.arm_cm),
    thighCm: num(r.thigh_cm),
    notes: r.notes,
  }))
}

// Un registro por día: si ya existe el de esa fecha, se sustituye.
export async function saveBodyMetric(userId: string, input: BodyMetricInput) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para guardar las medidas')
  check(
    await withTimeout(
      db().from('body_metrics').upsert(
        {
          user_id: userId,
          date: input.date,
          weight_kg: input.weightKg,
          body_fat_pct: input.bodyFatPct,
          waist_cm: input.waistCm,
          hip_cm: input.hipCm,
          chest_cm: input.chestCm,
          arm_cm: input.armCm,
          thigh_cm: input.thighCm,
          notes: input.notes,
        },
        { onConflict: 'user_id,date' },
      ),
    ),
  )
}

export async function deleteBodyMetric(id: string) {
  check(await withTimeout(db().from('body_metrics').delete().eq('id', id)))
}

// ── Fotos de progreso (bucket privado, URLs firmadas) ───────

export const PHOTO_BUCKET = 'progress-photos'
const SIGNED_URL_TTL_S = 60 * 60

export type ProgressPhoto = {
  id: string
  date: string
  pose: PhotoPose
  storagePath: string
  url: string | null
}

export async function fetchPhotos(userId: string): Promise<ProgressPhoto[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('progress_photos')
        .select('id, date, pose, storage_path')
        .eq('user_id', userId)
        .order('date', { ascending: false }),
    ),
  )
  if (rows.length === 0) return []
  const { data: signed, error } = await withTimeout(
    db()
      .storage.from(PHOTO_BUCKET)
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        SIGNED_URL_TTL_S,
      ),
  )
  if (error) throw new Error(error.message)
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    pose: r.pose,
    storagePath: r.storage_path,
    url: urls.get(r.storage_path) ?? null,
  }))
}

export async function uploadPhoto(userId: string, blob: Blob, date: string, pose: PhotoPose) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para subir fotos')
  const path = `${userId}/${date}-${pose}-${crypto.randomUUID()}.jpg`
  const { error } = await db()
    .storage.from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  const insert = await db()
    .from('progress_photos')
    .insert({ user_id: userId, date, pose, storage_path: path })
  if (insert.error) {
    await db().storage.from(PHOTO_BUCKET).remove([path])
    throw new Error(insert.error.message)
  }
}

export async function deletePhoto(photo: Pick<ProgressPhoto, 'id' | 'storagePath'>) {
  const { error } = await db().storage.from(PHOTO_BUCKET).remove([photo.storagePath])
  if (error) throw new Error(error.message)
  check(await db().from('progress_photos').delete().eq('id', photo.id))
}

// ── Vínculos ────────────────────────────────────────────────

export type PartnerLink = {
  partnerId: string
  displayName: string
  status: 'sent' | 'received' | 'accepted'
  iShare: { adherence: boolean; sessions: boolean; metrics: boolean }
  theyShare: { adherence: boolean; sessions: boolean; metrics: boolean }
}

export async function fetchPartnerLinks(): Promise<PartnerLink[]> {
  const rows = check(await withTimeout(db().rpc('list_partner_links')))
  return (rows ?? []).map((r) => ({
    partnerId: r.partner_id,
    displayName: r.display_name ?? 'Sin nombre',
    status: r.status,
    iShare: {
      adherence: r.i_share_adherence,
      sessions: r.i_share_sessions,
      metrics: r.i_share_metrics,
    },
    theyShare: {
      adherence: r.they_share_adherence,
      sessions: r.they_share_sessions,
      metrics: r.they_share_metrics,
    },
  }))
}

function friendlyError(message: string) {
  if (/ningún usuario/.test(message)) return 'No hay ningún usuario activo con ese email.'
  if (/contigo/.test(message)) return 'No puedes vincularte contigo.'
  if (/invitación pendiente/.test(message)) return 'Esa invitación ya no está pendiente.'
  return message
}

async function rpcOrThrow<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  const res = await withTimeout(promise)
  if (res.error) throw new Error(friendlyError(res.error.message))
  return res.data
}

export function invitePartner(email: string) {
  return rpcOrThrow(db().rpc('invite_partner', { p_email: email }))
}

export function respondPartner(partnerId: string, accept: boolean) {
  return rpcOrThrow(db().rpc('respond_partner_link', { p_partner: partnerId, p_accept: accept }))
}

export function revokePartner(partnerId: string) {
  return rpcOrThrow(db().rpc('revoke_partner_link', { p_partner: partnerId }))
}

// Cambia lo que YO comparto con esa persona (mi fila del vínculo).
export async function updateSharing(
  userId: string,
  partnerId: string,
  patch: { adherence?: boolean; sessions?: boolean; metrics?: boolean },
) {
  const rows = await rpcOrThrow(
    db()
      .from('partner_links')
      .update({
        can_view_adherence: patch.adherence,
        can_view_sessions: patch.sessions,
        can_view_metrics: patch.metrics,
      })
      .eq('user_id', userId)
      .eq('partner_id', partnerId)
      .select('user_id'),
  )
  if (!rows || rows.length === 0) throw new Error('el vínculo ya no existe')
}

// Cumplimiento de una persona vinculada: sus compromisos y los días/tipos con sesión.
export async function fetchPartnerAdherence(partnerId: string) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'
  const [days, commitments] = await Promise.all([
    rpcOrThrow(
      db().rpc('partner_adherence_days', { p_partner: partnerId, p_from: '2000-01-01', p_tz: tz }),
    ),
    fetchCommitments(partnerId),
  ])
  const activity: ActivityDay[] = (days ?? []).map((d) => ({
    day: d.day,
    sessionType: d.session_type,
    minutes: null,
  }))
  return { days: activity, commitments }
}

// ── Acumulados y equivalencias ──────────────────────────────

// Tonelaje y repeticiones por sesión (RPC session_totals, solo sesiones propias).
export async function fetchSessionTotals() {
  const rows = check(await withTimeout(db().rpc('session_totals')))
  return Object.fromEntries(
    (rows ?? []).map((r) => [
      r.session_id,
      { tonnageKg: Number(r.tonnage_kg), totalReps: Number(r.total_reps) },
    ]),
  ) as Record<string, { tonnageKg: number; totalReps: number }>
}

export async function fetchEquivalenceCatalog(): Promise<EquivalenceCatalog> {
  const [objects, destinations] = await Promise.all([
    withTimeout(db().from('equivalence_objects').select('*')),
    withTimeout(db().from('destinations').select('*').order('name')),
  ])
  return {
    objects: check(objects).map((o) => ({
      id: o.id,
      kind: o.kind,
      label: o.label,
      labelPlural: o.label_plural,
      article: o.article,
      emoji: o.emoji,
      value: Number(o.value),
      phraseTemplate: o.phrase_template,
      minValue: Number(o.min_value),
    })),
    destinations: check(destinations).map((d) => ({
      id: d.id,
      name: d.name,
      lat: Number(d.lat),
      lng: Number(d.lng),
      type: d.type,
      waterRoute: d.water_route,
    })),
  }
}

export type ShownMilestone = { key: string; shownAt: string }

export async function fetchShownMilestones(userId: string): Promise<ShownMilestone[]> {
  const rows = check(
    await withTimeout(
      db()
        .from('milestones_shown')
        .select('milestone_key, shown_at')
        .eq('user_id', userId)
        .order('shown_at', { ascending: false }),
    ),
  )
  return rows.map((r) => ({ key: r.milestone_key, shownAt: r.shown_at }))
}

export async function insertShownMilestones(userId: string, items: ShownMilestone[]) {
  if (items.length === 0) return
  check(
    await withTimeout(
      db()
        .from('milestones_shown')
        .upsert(
          items.map((i) => ({ user_id: userId, milestone_key: i.key, shown_at: i.shownAt })),
          { onConflict: 'user_id,milestone_key', ignoreDuplicates: true },
        ),
    ),
  )
}

// Ciudad de referencia (null = borrarla) y pop-ups de logros.
export async function updateProfileSettings(
  userId: string,
  patch: { home?: Home | null; showPopups?: boolean },
) {
  const update: TablesUpdate<'profiles'> = {}
  if (patch.home !== undefined) {
    update.home_city = patch.home?.city ?? null
    update.home_lat = patch.home?.lat ?? null
    update.home_lng = patch.home?.lng ?? null
  }
  if (patch.showPopups !== undefined) update.show_equivalence_popups = patch.showPopups
  await updateOwnProfile(userId, update)
}

// Actualiza el perfil propio y comprueba que se ha guardado de verdad: si la RLS o los
// permisos lo impiden, PostgREST no devuelve error sino 0 filas.
export async function updateOwnProfile(userId: string, update: TablesUpdate<'profiles'>) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para guardar el perfil')
  const rows = check(
    await withTimeout(db().from('profiles').update(update).eq('id', userId).select('id')),
  )
  if (rows.length === 0) throw new Error('No se ha podido guardar el perfil (sin permiso)')
}

// Series efectivas por sesión y ejercicio de las sesiones empezadas en [from, to).
export async function fetchSessionExerciseSets(from: Date, to: Date): Promise<ExerciseSetCount[]> {
  const rows = check(
    await withTimeout(
      db().rpc('session_exercise_sets', { p_from: from.toISOString(), p_to: to.toISOString() }),
    ),
  )
  return (rows ?? []).map((r) => ({
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    sets: Number(r.sets),
  }))
}
