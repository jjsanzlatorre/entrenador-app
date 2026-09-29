// Acceso a datos del registro desde el navegador (Supabase + RLS), con caché en IndexedDB
// para que el catálogo y «la última vez» funcionen sin conexión.
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { idbGet, idbPut } from '@/lib/offline/idb'
import type {
  ExerciseCategory,
  ExerciseRow,
  MuscleRole,
  SessionType,
  TrackingType,
  WorkoutSessionRow,
} from '@/types/database'
import { fromServerRows } from './payload'
import { mergeHistory } from './suggestion'
import type { Exercise, LastPerformance, LocalSession } from './types'
import type { SessionPayload } from './payload'

const NETWORK_TIMEOUT_MS = 6000

export class OfflineError extends Error {
  constructor(message = 'Sin conexión') {
    super(message)
    this.name = 'OfflineError'
  }
}

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function withTimeout<T>(promise: PromiseLike<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OfflineError('La conexión no responde')), ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function db() {
  return getSupabaseBrowserClient()
}

// ── Catálogo ────────────────────────────────────────────────

type ExerciseWithMuscles = ExerciseRow & {
  exercise_muscles: { muscle_id: string; role: MuscleRole }[]
}

export function toExercise(row: ExerciseWithMuscles): Exercise {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    category: row.category,
    trackingType: row.tracking_type,
    equipment: row.equipment ?? [],
    isUnilateral: row.is_unilateral,
    isCompound: row.is_compound,
    defaultRestS: row.default_rest_s,
    techniqueNotes: row.technique_notes,
    techniqueSteps: row.technique_steps ?? [],
    techniqueMistakes: row.technique_mistakes ?? [],
    ownerId: row.owner_id,
    muscles: (row.exercise_muscles ?? []).map((m) => ({ muscleId: m.muscle_id, role: m.role })),
  }
}

const catalogKey = (userId: string) => `catalog:${userId}`

export async function fetchCatalog(userId: string): Promise<Exercise[]> {
  if (isOnline()) {
    try {
      const { data, error } = await withTimeout(
        // Globales + propios: con un vínculo, la RLS también deja ver los propios de la otra
        // persona (para su historial), pero no deben aparecer en mi biblioteca.
        db()
          .from('exercises')
          .select('*, exercise_muscles(muscle_id, role)')
          .or(`owner_id.is.null,owner_id.eq.${userId}`)
          .order('name'),
      )
      if (error) throw new Error(error.message)
      const exercises = (data as ExerciseWithMuscles[]).map(toExercise)
      await idbPut('kv', catalogKey(userId), exercises)
      return exercises
    } catch (error) {
      console.error('[catalog] usando la copia local', error)
    }
  }
  const cached = await idbGet<Exercise[]>('kv', catalogKey(userId))
  // Copias guardadas antes de la fase 6C no traen la técnica estructurada.
  if (cached)
    return cached.map((e) => ({
      ...e,
      techniqueSteps: e.techniqueSteps ?? [],
      techniqueMistakes: e.techniqueMistakes ?? [],
    }))
  throw new OfflineError('No hay conexión y aún no se ha descargado la biblioteca de ejercicios')
}

export type NewExerciseInput = {
  name: string
  category: ExerciseCategory
  trackingType: TrackingType
  equipment: string[]
  primary: string[]
  secondary: string[]
  defaultRestS: number
  isUnilateral: boolean
  techniqueNotes: string | null
}

export async function createExercise(userId: string, input: NewExerciseInput) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para crear ejercicios')
  const { data, error } = await db()
    .from('exercises')
    .insert({
      name: input.name.trim(),
      category: input.category,
      tracking_type: input.trackingType,
      equipment: input.equipment,
      default_rest_s: input.defaultRestS,
      is_unilateral: input.isUnilateral,
      is_compound: input.primary.length + input.secondary.length > 1,
      technique_notes: input.techniqueNotes?.trim() || null,
      owner_id: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const muscles = [
    ...input.primary.map((m) => ({ exercise_id: data.id, muscle_id: m, role: 'primary' as const })),
    ...input.secondary
      .filter((m) => !input.primary.includes(m))
      .map((m) => ({ exercise_id: data.id, muscle_id: m, role: 'secondary' as const })),
  ]
  if (muscles.length > 0) {
    const { error: musclesError } = await db().from('exercise_muscles').insert(muscles)
    if (musclesError) throw new Error(musclesError.message)
  }
  return data.id
}

export async function deleteExercise(exerciseId: string) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para borrar ejercicios')
  const { error } = await db().from('exercises').delete().eq('id', exerciseId)
  if (error) {
    throw new Error(
      error.code === '23503'
        ? 'No se puede borrar: ya lo has usado en alguna sesión'
        : error.message,
    )
  }
}

export async function fetchEquipment(userId: string): Promise<string[]> {
  const key = `equipment:${userId}`
  if (isOnline()) {
    try {
      const { data } = await withTimeout(
        db().from('training_profiles').select('equipment').eq('user_id', userId).maybeSingle(),
      )
      const equipment = data?.equipment ?? []
      await idbPut('kv', key, equipment)
      return equipment
    } catch {
      // se usa la copia local
    }
  }
  return (await idbGet<string[]>('kv', key)) ?? []
}

// ── La última vez ───────────────────────────────────────────

const lastKey = (userId: string, exerciseId: string) => `last:${userId}:${exerciseId}`

export async function getLastPerformance(
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string | null,
): Promise<Map<string, LastPerformance>> {
  const result = new Map<string, LastPerformance>()
  if (exerciseIds.length === 0) return result

  if (isOnline()) {
    try {
      const { data, error } = await withTimeout(
        db().rpc('last_exercise_sets', {
          p_exercise_ids: exerciseIds,
          p_exclude_session: excludeSessionId,
        }),
        3500,
      )
      if (error) throw new Error(error.message)
      for (const row of data ?? []) {
        const entry = result.get(row.exercise_id) ?? {
          exerciseId: row.exercise_id,
          endedAt: row.ended_at,
          sets: [],
        }
        entry.sets.push({
          setIndex: row.set_index,
          isWarmup: row.is_warmup,
          weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
          reps: row.reps,
          rir: row.rir,
          durationS: row.duration_s,
          distanceM: row.distance_m === null ? null : Number(row.distance_m),
          calories: row.calories,
        })
        result.set(row.exercise_id, entry)
      }
      // Solo se sobrescribe la caché si el servidor tiene algo más reciente.
      for (const entry of result.values()) {
        const cached = await idbGet<LastPerformance>('kv', lastKey(userId, entry.exerciseId))
        if (!cached || cached.endedAt <= entry.endedAt) {
          await idbPut('kv', lastKey(userId, entry.exerciseId), entry)
        }
      }
    } catch (error) {
      console.error('[last] usando la copia local', error)
    }
  }

  for (const id of exerciseIds) {
    const cached = await idbGet<LastPerformance>('kv', lastKey(userId, id))
    const fromServer = result.get(id)
    if (cached && (!fromServer || cached.endedAt > fromServer.endedAt)) result.set(id, cached)
  }
  return result
}

// Últimas sesiones (hasta 2, la más reciente primero) de cada ejercicio, para la sugerencia de
// peso (§10). Red + copia local (que incluye las sesiones terminadas sin conexión).
const histKey = (userId: string, exerciseId: string) => `hist:${userId}:${exerciseId}`

export async function getExerciseHistory(
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string | null,
): Promise<Map<string, LastPerformance[]>> {
  const result = new Map<string, LastPerformance[]>()
  if (exerciseIds.length === 0) return result

  if (isOnline()) {
    try {
      const { data, error } = await withTimeout(
        db().rpc('recent_exercise_sets', {
          p_exercise_ids: exerciseIds,
          p_sessions: 2,
          p_exclude_session: excludeSessionId,
        }),
        3500,
      )
      if (error) throw new Error(error.message)
      const bySession = new Map<string, LastPerformance>()
      for (const row of data ?? []) {
        const key = `${row.exercise_id}|${row.session_id}`
        const entry = bySession.get(key) ?? {
          exerciseId: row.exercise_id,
          endedAt: row.ended_at,
          sets: [],
        }
        entry.sets.push({
          setIndex: row.set_index,
          isWarmup: row.is_warmup,
          weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
          reps: row.reps,
          rir: row.rir,
          durationS: row.duration_s,
          distanceM: row.distance_m === null ? null : Number(row.distance_m),
          calories: row.calories,
        })
        bySession.set(key, entry)
      }
      for (const entry of bySession.values()) {
        result.set(entry.exerciseId, mergeHistory(result.get(entry.exerciseId), [entry]))
      }
      for (const [id, list] of result) await idbPut('kv', histKey(userId, id), list)
    } catch (error) {
      console.error('[history] usando la copia local', error)
    }
  }

  for (const id of exerciseIds) {
    const cached = await idbGet<LastPerformance[]>('kv', histKey(userId, id))
    const merged = mergeHistory(result.get(id), cached)
    if (merged.length > 0) result.set(id, merged)
  }
  return result
}

// Al terminar una sesión (aunque sea sin conexión), su resultado pasa a ser «la última vez».
export async function rememberLastPerformance(session: LocalSession) {
  if (!session.endedAt) return
  const byExercise = new Map<string, LastPerformance>()
  for (const set of session.blocks.flatMap((b) => b.sets)) {
    if (!set.completed) continue
    const entry = byExercise.get(set.exerciseId) ?? {
      exerciseId: set.exerciseId,
      endedAt: session.endedAt,
      sets: [],
    }
    entry.sets.push({
      setIndex: set.setIndex,
      isWarmup: set.isWarmup,
      weightKg: set.weightKg,
      reps: set.reps,
      rir: set.rir,
      durationS: set.durationS,
      distanceM: set.distanceM,
      calories: set.calories,
    })
    byExercise.set(set.exerciseId, entry)
  }
  for (const entry of byExercise.values()) {
    const key = lastKey(session.userId, entry.exerciseId)
    const cached = await idbGet<LastPerformance>('kv', key)
    if (!cached || cached.endedAt <= entry.endedAt) await idbPut('kv', key, entry)
    const hKey = histKey(session.userId, entry.exerciseId)
    const history = (await idbGet<LastPerformance[]>('kv', hKey))?.filter(
      (p) => p.endedAt !== entry.endedAt,
    )
    await idbPut('kv', hKey, mergeHistory([entry], history))
  }
}

// ── Sincronización ──────────────────────────────────────────

export async function saveSessionRemote(payload: SessionPayload) {
  const { error } = await withTimeout(db().rpc('save_workout_session', { payload }), 15000)
  if (error) throw new Error(error.message)
}

export async function deleteSessionRemote(sessionId: string) {
  const { error } = await withTimeout(
    db().from('workout_sessions').delete().eq('id', sessionId),
    15000,
  )
  if (error) throw new Error(error.message)
}

// ── Historial ───────────────────────────────────────────────

export type HistoryItem = {
  id: string
  title: string
  sessionType: SessionType
  activityTypeId: string | null
  startedAt: string
  endedAt: string | null
  durationMin: number | null
  rpe: number | null
  distanceM: number | null
  completedSets: number
  tonnageKg: number
  exerciseIds: string[]
}

// Solo las propias: con un vínculo que comparte sesiones, la RLS también deja ver las de la pareja.
export async function fetchHistory(userId: string, limit = 50): Promise<HistoryItem[]> {
  const { data, error } = await withTimeout(
    db()
      .from('workout_sessions')
      .select(
        'id, title, session_type, activity_type_id, started_at, ended_at, duration_min, rpe, distance_m, exercise_sets(exercise_id, weight_kg, reps, completed, is_warmup)',
      )
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit),
  )
  if (error) throw new Error(error.message)
  type Row = Pick<
    WorkoutSessionRow,
    | 'id'
    | 'title'
    | 'session_type'
    | 'activity_type_id'
    | 'started_at'
    | 'ended_at'
    | 'duration_min'
    | 'rpe'
    | 'distance_m'
  > & {
    exercise_sets: {
      exercise_id: string
      weight_kg: number | null
      reps: number | null
      completed: boolean
      is_warmup: boolean
    }[]
  }
  return (data as Row[]).map((row) => {
    const effective = row.exercise_sets.filter((s) => s.completed && !s.is_warmup)
    return {
      id: row.id,
      title: row.title ?? 'Entreno',
      sessionType: row.session_type,
      activityTypeId: row.activity_type_id ?? null,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMin: row.duration_min,
      rpe: row.rpe,
      distanceM: row.distance_m === null ? null : Number(row.distance_m),
      completedSets: effective.length,
      tonnageKg: effective.reduce(
        (acc, s) => acc + (s.weight_kg && s.reps ? Number(s.weight_kg) * s.reps : 0),
        0,
      ),
      exerciseIds: [...new Set(row.exercise_sets.map((s) => s.exercise_id))],
    }
  })
}

export async function fetchSession(sessionId: string): Promise<LocalSession | null> {
  const client = db()
  const [session, blocks, sets] = await withTimeout(
    Promise.all([
      client.from('workout_sessions').select('*').eq('id', sessionId).maybeSingle(),
      client.from('session_blocks').select('*').eq('session_id', sessionId),
      client.from('exercise_sets').select('*').eq('session_id', sessionId),
    ]),
  )
  const error = session.error ?? blocks.error ?? sets.error
  if (error) throw new Error(error.message)
  if (!session.data) return null
  return fromServerRows(session.data, blocks.data ?? [], sets.data ?? [], 'edit')
}

// Series de la vez anterior a una sesión concreta (solo con conexión; para el resumen).
export async function fetchPreviousPerformance(
  exerciseIds: string[],
  sessionId: string,
  before: string,
): Promise<Map<string, LastPerformance>> {
  const result = new Map<string, LastPerformance>()
  if (exerciseIds.length === 0) return result
  if (!isOnline()) throw new OfflineError()
  const { data, error } = await withTimeout(
    db().rpc('last_exercise_sets', {
      p_exercise_ids: exerciseIds,
      p_exclude_session: sessionId,
      p_before: before,
    }),
  )
  if (error) throw new Error(error.message)
  for (const row of data ?? []) {
    const entry = result.get(row.exercise_id) ?? {
      exerciseId: row.exercise_id,
      endedAt: row.ended_at,
      sets: [],
    }
    entry.sets.push({
      setIndex: row.set_index,
      isWarmup: row.is_warmup,
      weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      durationS: row.duration_s,
      distanceM: row.distance_m === null ? null : Number(row.distance_m),
      calories: row.calories,
    })
    result.set(row.exercise_id, entry)
  }
  return result
}
