// Supabase simulado para los tests E2E (auth, PostgREST y las dos RPC que usa el registro).
// Guarda en memoria lo que llega por save_workout_session y expone /__state para inspeccionarlo.
// Uso: node tests/e2e/mock-supabase.ts [puerto]
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MOCK_USER_ID = '11111111-1111-4111-8111-111111111111'
const root = join(import.meta.dirname, '../..')

type SeedExercise = {
  id: string
  name: string
  aliases: string[]
  category: string
  tracking_type: string
  equipment: string[]
  is_unilateral: boolean
  is_compound: boolean
  default_rest_s: number
  technique_notes: string | null
  primary: string[]
  secondary: string[]
}

const seed = JSON.parse(readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8')) as {
  exercises: SeedExercise[]
}
const exercises = seed.exercises.map((e) => ({
  id: e.id,
  name: e.name,
  aliases: e.aliases,
  category: e.category,
  tracking_type: e.tracking_type,
  equipment: e.equipment,
  is_unilateral: e.is_unilateral,
  is_compound: e.is_compound,
  default_rest_s: e.default_rest_s,
  technique_notes: e.technique_notes,
  owner_id: null,
  created_at: '2026-01-01T00:00:00Z',
  exercise_muscles: [
    ...e.primary.map((m) => ({ muscle_id: m, role: 'primary' })),
    ...e.secondary.map((m) => ({ muscle_id: m, role: 'secondary' })),
  ],
}))

// Catálogos de equivalencias (fase 3B), tal cual la semilla.
const equivalenceObjects = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/equivalences.json'), 'utf8')) as {
    objects: (Record<string, unknown> & { source?: string })[]
  }
).objects.map(({ source: _source, ...o }) => o)
const destinations = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/destinations.json'), 'utf8')) as {
    destinations: Record<string, unknown>[]
  }
).destinations
// Plantillas de planes (fase 5), tal cual la semilla generada.
const planTemplates = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/plan_templates.json'), 'utf8')) as {
    templates: Record<string, unknown>[]
  }
).templates
const weightReps = new Set(
  seed.exercises.filter((e) => e.tracking_type === 'weight_reps').map((e) => e.id),
)

const user = {
  id: MOCK_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@test.dev',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}
const baseProfile = {
  id: MOCK_USER_ID,
  display_name: 'E2E',
  role: 'member',
  active: true,
  sex: null,
  birth_year: null,
  height_cm: null,
  home_city: null,
  home_lat: null,
  home_lng: null,
  show_equivalence_popups: true,
  created_at: '2026-01-01T00:00:00Z',
}
let profile: Record<string, unknown> = { ...baseProfile }
let milestones: { milestone_key: string; shown_at: string }[] = []

type Payload = {
  session: Record<string, unknown> & { id: string; client_rev: number }
  blocks: (Record<string, unknown> & { id: string })[]
  sets: (Record<string, unknown> & {
    id: string
    exercise_id: string
    completed: boolean
    is_warmup?: boolean
    weight_kg?: number | null
    reps?: number | null
  })[]
}
const sessions = new Map<string, Payload>()
let saveCalls = 0
// Datos de progreso que siembran los tests con POST /__seed.
type Seed = {
  profile?: Record<string, unknown>
  commitments: Record<string, unknown>[]
  partnerLinks: Record<string, unknown>[]
  partnerDays: Record<string, { day: string; session_type: string }[]>
  // Simula que la RLS impide el UPDATE del perfil (PostgREST devuelve 0 filas, sin error).
  profileUpdateBlocked?: boolean
}
let progressSeed: Seed = { commitments: [], partnerLinks: [], partnerDays: {} }

// Perfil de entrenamiento: por defecto ya existe (los tests de fases anteriores no pasan por el
// onboarding); `POST /__seed { trainingProfile: null }` simula un usuario nuevo.
const baseTrainingProfile = {
  user_id: MOCK_USER_ID,
  goals: {},
  level: null,
  availability: {},
  equipment: [],
  limitations: null,
  fixed_activities: [],
  benchmarks: {},
  updated_at: '2026-01-01T00:00:00Z',
}
let trainingProfile: Record<string, unknown> | null = { ...baseTrainingProfile }
type PlanRow = Record<string, unknown> & { id: string; status: string }
type PlannedRow = Record<string, unknown> & {
  id: string
  user_plan_id: string
  status: string
  workout_session_id: string | null
}
let userPlans: PlanRow[] = []
let plannedSessions: PlannedRow[] = []
let dailyCheckins: Record<string, unknown>[] = []

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data ? JSON.parse(data) : null))
  })
}

function eqParam(url: URL, column: string) {
  const v = url.searchParams.get(column)
  return v?.startsWith('eq.') ? v.slice(3) : null
}

function sessionRow(p: Payload) {
  return {
    ...p.session,
    user_id: MOCK_USER_ID,
    planned_session_id: p.session.planned_session_id ?? null,
    distance_m: p.session.distance_m ?? null,
    pair_group_id: null,
    created_at: '',
    updated_at: '',
  }
}

function rows(req: http.IncomingMessage, list: unknown[]) {
  return (req.headers.accept ?? '').includes('vnd.pgrst.object') ? (list[0] ?? null) : list
}

export function startMockSupabase(port: number) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    const path = url.pathname
    if (req.method === 'OPTIONS') return send(res, 204, undefined)

    if (path === '/__state') {
      return send(res, 200, {
        saveCalls,
        sessions: [...sessions.values()],
        milestones,
        profile,
        trainingProfile,
        userPlans,
        plannedSessions,
        dailyCheckins,
        commitments: progressSeed.commitments,
      })
    }
    if (path === '/__seed') {
      const body = (await readBody(req)) as Partial<Seed> & {
        trainingProfile?: Record<string, unknown> | null
        userPlans?: PlanRow[]
        plannedSessions?: PlannedRow[]
      }
      if (body.userPlans) userPlans = body.userPlans
      if (body.plannedSessions) plannedSessions = body.plannedSessions
      delete body.userPlans
      delete body.plannedSessions
      if (body.trainingProfile !== undefined) {
        trainingProfile = body.trainingProfile && {
          ...baseTrainingProfile,
          ...body.trainingProfile,
        }
        delete body.trainingProfile
      }
      progressSeed = { ...progressSeed, ...body }
      if (body.profile) profile = { ...profile, ...body.profile }
      return send(res, 200, { ok: true })
    }
    if (path === '/__reset') {
      sessions.clear()
      saveCalls = 0
      progressSeed = { commitments: [], partnerLinks: [], partnerDays: {} }
      profile = { ...baseProfile }
      milestones = []
      trainingProfile = { ...baseTrainingProfile }
      userPlans = []
      plannedSessions = []
      dailyCheckins = []
      return send(res, 200, { ok: true })
    }
    if (path.startsWith('/auth/v1/user')) return send(res, 200, user)
    if (path.startsWith('/auth/v1/logout')) return send(res, 204, undefined)

    if (path === '/rest/v1/rpc/save_workout_session') {
      const { payload } = (await readBody(req)) as { payload: Payload }
      saveCalls++
      const current = sessions.get(payload.session.id)
      if (current && current.session.client_rev > payload.session.client_rev)
        return send(res, 200, false)
      sessions.set(payload.session.id, payload)
      // Como el trigger link_planned_session (0017).
      const planned = payload.session.planned_session_id
      if (planned && payload.session.ended_at) {
        for (const ps of plannedSessions.filter((x) => x.id === planned)) {
          ps.status = 'done'
          ps.workout_session_id = payload.session.id
        }
      }
      return send(res, 200, true)
    }
    if (path === '/rest/v1/rpc/last_exercise_sets') {
      const body = (await readBody(req)) as {
        p_exercise_ids: string[]
        p_exclude_session: string | null
        p_before?: string | null
      }
      const out: unknown[] = []
      for (const id of body.p_exercise_ids) {
        const candidates = [...sessions.values()]
          .filter((p) => p.session.ended_at && p.session.id !== body.p_exclude_session)
          .filter((p) => !body.p_before || String(p.session.ended_at) < body.p_before)
          .filter((p) => p.sets.some((s) => s.exercise_id === id && s.completed))
          .sort((a, b) => String(b.session.ended_at).localeCompare(String(a.session.ended_at)))
        const last = candidates[0]
        if (!last) continue
        for (const s of last.sets.filter((x) => x.exercise_id === id && x.completed)) {
          out.push({ ...s, session_id: last.session.id, ended_at: last.session.ended_at })
        }
      }
      return send(res, 200, out)
    }

    if (path === '/rest/v1/rpc/recent_exercise_sets') {
      const body = (await readBody(req)) as {
        p_exercise_ids: string[]
        p_sessions?: number
        p_exclude_session: string | null
      }
      const out: unknown[] = []
      for (const id of body.p_exercise_ids) {
        const candidates = [...sessions.values()]
          .filter((p) => p.session.ended_at && p.session.id !== body.p_exclude_session)
          .filter((p) => p.sets.some((s) => s.exercise_id === id && s.completed))
          .sort((a, b) => String(b.session.ended_at).localeCompare(String(a.session.ended_at)))
          .slice(0, body.p_sessions ?? 2)
        for (const c of candidates) {
          for (const s of c.sets.filter((x) => x.exercise_id === id && x.completed)) {
            out.push({
              ...s,
              rir: s.rir ?? null,
              session_id: c.session.id,
              ended_at: c.session.ended_at,
            })
          }
        }
      }
      return send(res, 200, out)
    }
    if (path === '/rest/v1/daily_checkins') {
      if (req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>
        for (const row of Array.isArray(body) ? body : [body]) {
          dailyCheckins = dailyCheckins.filter((c) => c.date !== row.date)
          dailyCheckins.push(row)
        }
        return send(res, 201, undefined)
      }
      const date = eqParam(url, 'date')
      const hit = dailyCheckins.filter((c) => !date || c.date === date)
      return send(res, 200, rows(req, hit))
    }

    // Fase 3: sin datos de progreso ni vínculos en el mock.
    if (path === '/rest/v1/rpc/list_partner_links') return send(res, 200, progressSeed.partnerLinks)
    if (path === '/rest/v1/rpc/partner_adherence_days') {
      const { p_partner } = (await readBody(req)) as { p_partner: string }
      return send(res, 200, progressSeed.partnerDays[p_partner] ?? [])
    }

    if (path === '/rest/v1/rpc/session_totals') {
      const out = [...sessions.values()]
        .filter((p) => p.session.ended_at)
        .map((p) => {
          const sets = p.sets.filter((x) => x.completed && !x.is_warmup)
          return {
            session_id: p.session.id,
            tonnage_kg: sets
              .filter((x) => weightReps.has(x.exercise_id))
              .reduce((a, x) => a + (x.weight_kg ?? 0) * (x.reps ?? 0), 0),
            total_reps: sets.reduce((a, x) => a + (x.reps ?? 0), 0),
          }
        })
      return send(res, 200, out)
    }

    if (path === '/rest/v1/rpc/session_exercise_sets') {
      const { p_from, p_to } = (await readBody(req)) as { p_from: string; p_to: string }
      const from = Date.parse(p_from)
      const to = Date.parse(p_to)
      const out: { session_id: string; exercise_id: string; sets: number }[] = []
      for (const p of sessions.values()) {
        const start = Date.parse(String(p.session.started_at))
        if (!p.session.ended_at || start < from || start >= to) continue
        const counts = new Map<string, number>()
        for (const x of p.sets.filter((x) => x.completed && !x.is_warmup)) {
          counts.set(x.exercise_id, (counts.get(x.exercise_id) ?? 0) + 1)
        }
        for (const [exercise_id, n] of counts) {
          out.push({ session_id: p.session.id, exercise_id, sets: n })
        }
      }
      return send(res, 200, out)
    }

    // ── Fase 5: onboarding y planes ──
    if (path === '/rest/v1/rpc/set_commitment') {
      const b = (await readBody(req)) as Record<string, unknown>
      const from = String(b.p_valid_from)
      progressSeed.commitments = progressSeed.commitments.filter((c) => String(c.valid_from) < from)
      for (const c of progressSeed.commitments) if (!c.valid_to) c.valid_to = from
      const id = crypto.randomUUID()
      progressSeed.commitments.push({
        id,
        user_id: MOCK_USER_ID,
        valid_from: from,
        valid_to: null,
        sessions_per_week: b.p_sessions_per_week,
        minutes_per_week: b.p_minutes_per_week ?? null,
        by_type: b.p_by_type ?? null,
        counts_free_activities: b.p_counts_free_activities ?? true,
      })
      return send(res, 200, id)
    }
    if (path === '/rest/v1/rpc/create_user_plan') {
      const b = (await readBody(req)) as {
        p_template_id: string
        p_name: string
        p_start_date: string
        p_sessions: Record<string, unknown>[]
      }
      for (const p of userPlans) if (p.status === 'active') p.status = 'archived'
      const id = crypto.randomUUID()
      userPlans.push({
        id,
        user_id: MOCK_USER_ID,
        template_id: b.p_template_id,
        name: b.p_name,
        start_date: b.p_start_date,
        status: 'active',
        source: 'template',
        notes: null,
      })
      for (const s of b.p_sessions) {
        plannedSessions.push({
          id: crypto.randomUUID(),
          user_plan_id: id,
          user_id: MOCK_USER_ID,
          date: s.date,
          original_date: null,
          week: s.week ?? 1,
          session_type: s.session_type,
          title: s.title,
          intensity: s.intensity ?? 'moderate',
          heavy_legs: s.heavy_legs ?? false,
          duration_min: s.duration_min ?? null,
          notes: s.notes ?? null,
          blocks: s.blocks ?? [],
          status: 'planned',
          workout_session_id: null,
        })
      }
      return send(res, 200, id)
    }
    if (path === '/rest/v1/rpc/set_planned_session_done') {
      const b = (await readBody(req)) as { p_planned: string; p_done: boolean; p_workout?: string }
      for (const ps of plannedSessions.filter((x) => x.id === b.p_planned)) {
        ps.status = b.p_done ? 'done' : 'planned'
        ps.workout_session_id = b.p_done ? (b.p_workout ?? null) : null
      }
      return send(res, 200, null)
    }

    const table = path.replace('/rest/v1/', '')
    if (table === 'plan_templates') return send(res, 200, planTemplates)
    if (table === 'user_plans') {
      const status = eqParam(url, 'status')
      if (req.method === 'PATCH') {
        const patch = (await readBody(req)) as Record<string, unknown>
        const id = eqParam(url, 'id')
        const hit = userPlans.filter((p) => p.id === id)
        for (const p of hit) Object.assign(p, patch)
        return send(
          res,
          200,
          hit.map((p) => ({ id: p.id })),
        )
      }
      return send(
        res,
        200,
        rows(
          req,
          userPlans.filter((p) => !status || p.status === status),
        ),
      )
    }
    if (table === 'planned_sessions') {
      const id = eqParam(url, 'id')
      if (req.method === 'PATCH') {
        const patch = (await readBody(req)) as Record<string, unknown>
        const hit = plannedSessions.filter((p) => p.id === id)
        for (const p of hit) Object.assign(p, patch)
        return send(
          res,
          200,
          hit.map((p) => ({ id: p.id })),
        )
      }
      const plan = eqParam(url, 'user_plan_id')
      return send(
        res,
        200,
        plannedSessions
          .filter((p) => (!plan || p.user_plan_id === plan) && (!id || p.id === id))
          .sort((a, b) => String(a.date).localeCompare(String(b.date))),
      )
    }
    if (table === 'equivalence_objects') return send(res, 200, equivalenceObjects)
    if (table === 'destinations') return send(res, 200, destinations)
    if (table === 'milestones_shown') {
      if (req.method === 'POST') {
        const body = (await readBody(req)) as { milestone_key: string; shown_at: string }[]
        for (const m of Array.isArray(body) ? body : [body]) {
          if (!milestones.some((x) => x.milestone_key === m.milestone_key)) {
            milestones.push({ milestone_key: m.milestone_key, shown_at: m.shown_at })
          }
        }
        return send(res, 201, undefined)
      }
      return send(res, 200, milestones)
    }
    if (path === '/rest/v1/rpc/end_commitment') {
      const { p_today } = (await readBody(req)) as { p_today: string }
      let n = 0
      for (const c of progressSeed.commitments) {
        if (c.user_id === MOCK_USER_ID && (c.valid_to === null || String(c.valid_to) > p_today)) {
          c.valid_to = p_today
          n++
        }
      }
      return send(res, 200, n)
    }
    if (table === 'commitments') {
      if (req.method === 'DELETE') {
        const id = eqParam(url, 'id')
        const removed = progressSeed.commitments.filter((c) => c.id === id)
        progressSeed.commitments = progressSeed.commitments.filter((c) => c.id !== id)
        return send(
          res,
          200,
          removed.map((c) => ({ id: c.id })),
        )
      }
      const uid = eqParam(url, 'user_id')
      return send(
        res,
        200,
        progressSeed.commitments.filter((c) => !uid || c.user_id === uid),
      )
    }
    if (['personal_records', 'body_metrics', 'progress_photos'].includes(table)) {
      return send(res, 200, rows(req, []))
    }
    if (table === 'profiles') {
      if (req.method === 'PATCH') {
        const patch = (await readBody(req)) as object
        if (progressSeed.profileUpdateBlocked) return send(res, 200, [])
        profile = { ...profile, ...patch }
      }
      return send(res, 200, rows(req, [profile]))
    }
    if (table === 'exercises') return send(res, 200, rows(req, exercises))
    if (table === 'training_profiles') {
      if (req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>
        trainingProfile = { ...baseTrainingProfile, ...body }
        return send(res, 201, [{ user_id: MOCK_USER_ID }])
      }
      return send(res, 200, rows(req, trainingProfile ? [trainingProfile] : []))
    }
    if (table === 'workout_sessions') {
      const id = eqParam(url, 'id')
      if (req.method === 'DELETE') {
        if (id) sessions.delete(id)
        return send(res, 204, undefined)
      }
      const onlyEnded = url.searchParams.get('ended_at') === 'not.is.null'
      const list = [...sessions.values()]
        .filter((p) => !id || p.session.id === id)
        .filter((p) => !onlyEnded || p.session.ended_at)
        .sort((a, b) => String(b.session.started_at).localeCompare(String(a.session.started_at)))
        .map((p) => ({ ...sessionRow(p), exercise_sets: p.sets }))
      return send(res, 200, rows(req, list))
    }
    if (table === 'session_blocks' || table === 'exercise_sets') {
      const sid = eqParam(url, 'session_id')
      const p = sid ? sessions.get(sid) : undefined
      const list = p
        ? (table === 'session_blocks' ? p.blocks : p.sets).map((x) => ({
            ...x,
            session_id: sid,
            user_id: MOCK_USER_ID,
            result: null,
          }))
        : []
      return send(res, 200, list)
    }
    send(res, 404, { message: `mock: ${req.method} ${path} no implementado` })
  })
  server.listen(port)
  return server
}

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.argv[2] ?? 54321)
  startMockSupabase(port)
  console.log(`mock supabase en http://localhost:${port}`)
}
