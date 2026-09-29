// Exportar mis datos (fase 7B): copia de seguridad en JSON y CSV de lo principal. Todo se lee
// con la sesión del usuario (RLS) y filtrando por su id: con vínculos, la RLS también dejaría
// leer filas que otra persona comparte, que no son suyas y no se exportan.
// El plan Free de Supabase no da copias descargables: esta es la copia del usuario.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import { createZip, toCsv, type ZipEntry } from './files'

type Row = Record<string, unknown>

// Tabla → columna con el id del usuario y orden estable para paginar.
export const EXPORT_TABLES: { table: string; userColumn: string; order: string[] }[] = [
  { table: 'profiles', userColumn: 'id', order: ['id'] },
  { table: 'training_profiles', userColumn: 'user_id', order: ['user_id'] },
  { table: 'commitments', userColumn: 'user_id', order: ['valid_from', 'id'] },
  { table: 'notification_settings', userColumn: 'user_id', order: ['user_id'] },
  { table: 'workout_sessions', userColumn: 'user_id', order: ['started_at', 'id'] },
  { table: 'session_blocks', userColumn: 'user_id', order: ['session_id', 'order', 'id'] },
  { table: 'exercise_sets', userColumn: 'user_id', order: ['session_id', 'set_index', 'id'] },
  { table: 'exercises', userColumn: 'owner_id', order: ['id'] },
  { table: 'activity_types', userColumn: 'owner_id', order: ['id'] },
  { table: 'body_metrics', userColumn: 'user_id', order: ['date', 'id'] },
  { table: 'progress_photos', userColumn: 'user_id', order: ['date', 'id'] },
  { table: 'personal_records', userColumn: 'user_id', order: ['achieved_at', 'id'] },
  { table: 'daily_checkins', userColumn: 'user_id', order: ['date'] },
  { table: 'user_plans', userColumn: 'user_id', order: ['start_date', 'id'] },
  { table: 'planned_sessions', userColumn: 'user_id', order: ['date', 'id'] },
  { table: 'ai_interactions', userColumn: 'user_id', order: ['created_at', 'id'] },
  { table: 'ai_chat_messages', userColumn: 'user_id', order: ['seq'] },
  { table: 'partner_links', userColumn: 'user_id', order: ['id'] },
  { table: 'milestones_shown', userColumn: 'user_id', order: ['milestone_key'] },
  { table: 'pair_invites', userColumn: 'from_user', order: ['created_at', 'id'] },
  { table: 'reactions', userColumn: 'from_user', order: ['created_at', 'id'] },
]

const PAGE = 1000

export type ExportData = {
  app: 'entrenador'
  version: 1
  exported_at: string
  user_id: string
  tables: Record<string, Row[]>
}

function client() {
  // Nombres de tabla dinámicos: cliente sin tipos.
  return getSupabaseBrowserClient() as unknown as SupabaseClient
}

type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>

async function fetchAll(
  db: SupabaseClient,
  table: string,
  build: (q: Query) => Query,
  order: string[],
) {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let q = build(db.from(table).select('*'))
    for (const col of order) q = q.order(col, { ascending: true })
    const { data, error } = await withTimeout(q.range(from, from + PAGE - 1), 30_000)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) return rows
  }
}

export async function collectExport(
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportData> {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para exportar tus datos')
  const db = client()
  const tables: Record<string, Row[]> = {}
  const total = EXPORT_TABLES.length + 1
  let done = 0
  for (const spec of EXPORT_TABLES) {
    tables[spec.table] = await fetchAll(
      db,
      spec.table,
      (q) => q.eq(spec.userColumn, userId),
      spec.order,
    )
    onProgress?.(++done, total)
  }
  const own = (tables.exercises ?? []).map((e) => String(e.id))
  tables.exercise_muscles =
    own.length === 0
      ? []
      : await fetchAll(db, 'exercise_muscles', (q) => q.in('exercise_id', own), [
          'exercise_id',
          'muscle_id',
        ])
  onProgress?.(done + 1, total)
  return {
    app: 'entrenador',
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: userId,
    tables,
  }
}

// Nombres de los ejercicios (globales y propios) para que el CSV se entienda.
export async function exerciseNames(userId: string) {
  const { data, error } = await withTimeout(
    client()
      .from('exercises')
      .select('id, name, owner_id')
      .or(`owner_id.is.null,owner_id.eq.${userId}`),
  )
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as Row[]).map((e) => [String(e.id), String(e.name)]))
}

// CSV legibles: sesiones, series (con el nombre del ejercicio y la fecha de la sesión), medidas,
// récords y compromisos.
export function buildCsvFiles(data: ExportData, names: Map<string, string>): ZipEntry[] {
  const t = data.tables
  const sessions = t.workout_sessions ?? []
  const byId = new Map(sessions.map((s) => [String(s.id), s]))
  const blocks = new Map((t.session_blocks ?? []).map((b) => [String(b.id), b]))
  const name = (id: unknown) => names.get(String(id)) ?? String(id)

  const sessionRows = sessions.map((s) => ({
    id: s.id,
    session_type: s.session_type,
    title: s.title,
    started_at: s.started_at,
    ended_at: s.ended_at,
    duration_min: s.duration_min,
    rpe: s.rpe,
    srpe_load:
      typeof s.rpe === 'number' && typeof s.duration_min === 'number'
        ? s.rpe * s.duration_min
        : null,
    distance_m: s.distance_m,
    avg_hr: s.avg_hr,
    max_hr: s.max_hr,
    calories: s.calories,
    location: s.location,
    notes: s.notes,
    pair_group_id: s.pair_group_id,
  }))
  const setRows = (t.exercise_sets ?? []).map((x) => {
    const block = blocks.get(String(x.block_id))
    return {
      session_id: x.session_id,
      session_started_at: byId.get(String(x.session_id))?.started_at ?? null,
      block_order: block?.order ?? null,
      block_type: block?.block_type ?? null,
      exercise_id: x.exercise_id,
      exercise_name: name(x.exercise_id),
      set_index: x.set_index,
      is_warmup: x.is_warmup,
      weight_kg: x.weight_kg,
      reps: x.reps,
      rir: x.rir,
      duration_s: x.duration_s,
      distance_m: x.distance_m,
      calories: x.calories,
      completed: x.completed,
      completed_at: x.completed_at,
    }
  })
  const metrics = (t.body_metrics ?? []).map((m) => ({
    date: m.date,
    weight_kg: m.weight_kg,
    body_fat_pct: m.body_fat_pct,
    waist_cm: m.waist_cm,
    hip_cm: m.hip_cm,
    chest_cm: m.chest_cm,
    arm_cm: m.arm_cm,
    thigh_cm: m.thigh_cm,
    notes: m.notes,
  }))
  const records = (t.personal_records ?? []).map((r) => ({
    achieved_at: r.achieved_at,
    exercise_id: r.exercise_id,
    exercise_name: name(r.exercise_id),
    pr_type: r.pr_type,
    value: r.value,
    unit: r.unit,
    weight_kg: r.weight_kg,
    previous_value: r.previous_value,
    session_id: r.session_id,
  }))
  const commitments = (t.commitments ?? []).map((c) => ({
    valid_from: c.valid_from,
    valid_to: c.valid_to,
    sessions_per_week: c.sessions_per_week,
    minutes_per_week: c.minutes_per_week,
    by_type: c.by_type,
    counts_free_activities: c.counts_free_activities,
  }))
  const date = new Date(data.exported_at)
  const file = (n: string, rows: Row[], cols: string[]) => ({
    name: n,
    data: toCsv(rows as Record<string, never>[], cols),
    date,
  })
  return [
    file('sesiones.csv', sessionRows, SESSION_COLUMNS),
    file('series.csv', setRows, SET_COLUMNS),
    file('medidas.csv', metrics, METRIC_COLUMNS),
    file('records.csv', records, RECORD_COLUMNS),
    file('compromisos.csv', commitments, COMMITMENT_COLUMNS),
  ]
}

const SESSION_COLUMNS = [
  'id',
  'session_type',
  'title',
  'started_at',
  'ended_at',
  'duration_min',
  'rpe',
  'srpe_load',
  'distance_m',
  'avg_hr',
  'max_hr',
  'calories',
  'location',
  'notes',
  'pair_group_id',
]
const SET_COLUMNS = [
  'session_id',
  'session_started_at',
  'block_order',
  'block_type',
  'exercise_id',
  'exercise_name',
  'set_index',
  'is_warmup',
  'weight_kg',
  'reps',
  'rir',
  'duration_s',
  'distance_m',
  'calories',
  'completed',
  'completed_at',
]
const METRIC_COLUMNS = [
  'date',
  'weight_kg',
  'body_fat_pct',
  'waist_cm',
  'hip_cm',
  'chest_cm',
  'arm_cm',
  'thigh_cm',
  'notes',
]
const RECORD_COLUMNS = [
  'achieved_at',
  'exercise_id',
  'exercise_name',
  'pr_type',
  'value',
  'unit',
  'weight_kg',
  'previous_value',
  'session_id',
]
const COMMITMENT_COLUMNS = [
  'valid_from',
  'valid_to',
  'sessions_per_week',
  'minutes_per_week',
  'by_type',
  'counts_free_activities',
]

export function exportFileName(prefix: string, ext: string, now = new Date()) {
  const d = now.toISOString().slice(0, 10)
  return `entrenador-${prefix}-${d}.${ext}`
}

export function csvZip(data: ExportData, names: Map<string, string>) {
  return createZip(buildCsvFiles(data, names))
}

// Fotos de progreso (ZIP aparte, opcional): se descargan con URLs firmadas del bucket privado.
export async function photosZip(
  data: ExportData,
  onProgress?: (done: number, total: number) => void,
) {
  const photos = data.tables.progress_photos ?? []
  if (photos.length === 0) return null
  const storage = getSupabaseBrowserClient().storage.from('progress-photos')
  const paths = photos.map((p) => String(p.storage_path))
  const { data: signed, error } = await withTimeout(storage.createSignedUrls(paths, 600))
  if (error) throw new Error(error.message)
  const entries: ZipEntry[] = []
  let done = 0
  for (const [i, photo] of photos.entries()) {
    const url = signed?.[i]?.signedUrl
    if (url) {
      const res = await fetch(url)
      if (res.ok) {
        const ext = paths[i]!.split('.').pop() ?? 'jpg'
        entries.push({
          name: `${String(photo.date)}_${String(photo.pose)}_${String(photo.id).slice(0, 8)}.${ext}`,
          data: new Uint8Array(await res.arrayBuffer()),
        })
      }
    }
    onProgress?.(++done, photos.length)
  }
  return createZip(entries)
}
