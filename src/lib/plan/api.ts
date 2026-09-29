// Acceso a datos de onboarding y planes (Supabase + RLS), con copia en IndexedDB para abrir el
// plan sin conexión.
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { idbGet, idbPut } from '@/lib/offline/idb'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import type {
  Json,
  PlannedStatus,
  PlanFamily,
  SessionIntensity,
  SessionType,
  TrainingLevel,
  UserPlanStatus,
} from '@/types/database'
import { fromRow, toRow, type TrainingProfileData } from './profile'
import type { ScheduledSession } from './schedule'
import { parseBlocks, parseStructure } from './schema'
import type { PlanBlock, PlanStructure } from './types'

function db() {
  return getSupabaseBrowserClient()
}

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message)
  return res.data as NonNullable<T>
}

// Red con copia local: si falla la red, la última copia; si no hay copia, el error.
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const value = await load()
    await idbPut('kv', key, value)
    return value
  } catch (error) {
    const copy = await idbGet<T>('kv', key)
    if (copy !== undefined) return copy
    throw error
  }
}

// ── Perfil de entrenamiento ─────────────────────────────────

// null = aún no ha hecho (ni saltado) el onboarding.
export function fetchTrainingProfile(userId: string): Promise<TrainingProfileData | null> {
  return cached(`training-profile:${userId}`, async () => {
    const row = check(
      await withTimeout(
        db().from('training_profiles').select('*').eq('user_id', userId).maybeSingle(),
      ),
    )
    return row ? fromRow(row) : null
  })
}

export async function saveTrainingProfile(userId: string, data: TrainingProfileData) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para guardar tu perfil')
  check(
    await withTimeout(
      db()
        .from('training_profiles')
        .upsert({ user_id: userId, ...toRow(data) }, { onConflict: 'user_id' })
        .select('user_id'),
    ),
  )
  await idbPut('kv', `training-profile:${userId}`, data)
  await idbPut('kv', `equipment:${userId}`, data.equipment)
}

// ── Plantillas ──────────────────────────────────────────────

export type PlanTemplateData = {
  id: string
  family: PlanFamily
  name: string
  level: TrainingLevel
  weeks: number
  days_per_week: number
  description: string
  structure: PlanStructure
}

export function fetchTemplates(): Promise<PlanTemplateData[]> {
  return cached('plan-templates', async () => {
    const rows = check(await withTimeout(db().from('plan_templates').select('*').order('id')))
    return rows.flatMap((r) => {
      const structure = parseStructure(r.structure)
      return structure ? [{ ...r, structure }] : []
    })
  })
}

// ── Plan activo ─────────────────────────────────────────────

export type PlannedSession = {
  id: string
  planId: string
  date: string
  originalDate: string | null
  week: number
  sessionType: SessionType
  title: string
  intensity: SessionIntensity
  heavyLegs: boolean
  durationMin: number | null
  notes: string | null
  blocks: PlanBlock[]
  status: PlannedStatus
  workoutSessionId: string | null
}

export type ActivePlan = {
  id: string
  name: string
  templateId: string | null
  startDate: string
  status: UserPlanStatus
  sessions: PlannedSession[]
}

type PlannedRow = {
  id: string
  user_plan_id: string
  date: string
  original_date: string | null
  week: number
  session_type: SessionType
  title: string
  intensity: SessionIntensity
  heavy_legs?: boolean | null
  duration_min: number | null
  notes: string | null
  blocks: Json
  status: PlannedStatus
  workout_session_id: string | null
}

function toPlanned(r: PlannedRow): PlannedSession {
  return {
    id: r.id,
    planId: r.user_plan_id,
    date: r.date,
    originalDate: r.original_date,
    week: r.week,
    sessionType: r.session_type,
    title: r.title,
    intensity: r.intensity,
    heavyLegs: r.heavy_legs ?? false,
    durationMin: r.duration_min,
    notes: r.notes,
    blocks: parseBlocks(r.blocks),
    status: r.status,
    workoutSessionId: r.workout_session_id,
  }
}

export const activePlanCacheKey = (userId: string) => `active-plan:${userId}`

export function fetchActivePlan(userId: string): Promise<ActivePlan | null> {
  return cached(activePlanCacheKey(userId), async () => {
    const plan = check(
      await withTimeout(
        db()
          .from('user_plans')
          .select('id, name, template_id, start_date, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle(),
      ),
    )
    if (!plan) return null
    const rows = check(
      await withTimeout(
        db()
          .from('planned_sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('user_plan_id', plan.id)
          .order('date'),
      ),
    )
    return {
      id: plan.id,
      name: plan.name,
      templateId: plan.template_id,
      startDate: plan.start_date,
      status: plan.status,
      sessions: rows.map(toPlanned),
    }
  })
}

export async function createPlan(input: {
  templateId: string
  name: string
  startDate: string
  sessions: ScheduledSession[]
}) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para crear el plan')
  return check(
    await withTimeout(
      db().rpc('create_user_plan', {
        p_template_id: input.templateId,
        p_name: input.name,
        p_start_date: input.startDate,
        p_sessions: input.sessions as unknown as Json,
      }),
    ),
  )
}

export async function archivePlan(planId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  const rows = check(
    await withTimeout(
      db().from('user_plans').update({ status: 'archived' }).eq('id', planId).select('id'),
    ),
  )
  if (rows.length === 0) throw new Error('No se ha podido archivar el plan')
}

async function updatePlanned(
  id: string,
  update: { date?: string; original_date?: string | null; status?: PlannedStatus },
) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  const rows = check(
    await withTimeout(db().from('planned_sessions').update(update).eq('id', id).select('id')),
  )
  if (rows.length === 0) throw new Error('No se ha podido cambiar la sesión (sin permiso)')
}

// Mover: cambia el día y guarda el original (la primera vez).
export function movePlanned(s: Pick<PlannedSession, 'id' | 'date' | 'originalDate'>, date: string) {
  const original = s.originalDate ?? s.date
  return updatePlanned(s.id, {
    date,
    original_date: original === date ? null : original,
    status: original === date ? 'planned' : 'moved',
  })
}

export function skipPlanned(id: string) {
  return updatePlanned(id, { status: 'skipped' })
}

// Deshacer «saltada»: vuelve a pendiente (movida si ya se había cambiado de día).
export function restorePlanned(s: Pick<PlannedSession, 'id' | 'originalDate'>) {
  return updatePlanned(s.id, { status: s.originalDate ? 'moved' : 'planned' })
}

export async function setPlannedDone(id: string, done: boolean, workoutId: string | null = null) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar el plan')
  check(
    await withTimeout(
      db().rpc('set_planned_session_done', {
        p_planned: id,
        p_done: done,
        p_workout: workoutId,
      }),
    ),
  )
}
