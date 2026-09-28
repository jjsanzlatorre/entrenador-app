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

const user = {
  id: MOCK_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@test.dev',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}
const profile = {
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

type Payload = {
  session: Record<string, unknown> & { id: string; client_rev: number }
  blocks: (Record<string, unknown> & { id: string })[]
  sets: (Record<string, unknown> & { id: string; exercise_id: string; completed: boolean })[]
}
const sessions = new Map<string, Payload>()
let saveCalls = 0

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
    planned_session_id: null,
    distance_m: null,
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
      return send(res, 200, { saveCalls, sessions: [...sessions.values()] })
    }
    if (path === '/__reset') {
      sessions.clear()
      saveCalls = 0
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

    // Fase 3: sin datos de progreso ni vínculos en el mock.
    if (path === '/rest/v1/rpc/list_partner_links') return send(res, 200, [])

    const table = path.replace('/rest/v1/', '')
    if (['commitments', 'personal_records', 'body_metrics', 'progress_photos'].includes(table)) {
      return send(res, 200, rows(req, []))
    }
    if (table === 'profiles') return send(res, 200, rows(req, [profile]))
    if (table === 'exercises') return send(res, 200, rows(req, exercises))
    if (table === 'training_profiles') return send(res, 200, [])
    if (table === 'workout_sessions') {
      const id = eqParam(url, 'id')
      if (req.method === 'DELETE') {
        if (id) sessions.delete(id)
        return send(res, 204, undefined)
      }
      const list = [...sessions.values()]
        .filter((p) => !id || p.session.id === id)
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
