// Supabase simulado para los tests E2E (auth, PostgREST y las dos RPC que usa el registro).
// Guarda en memoria lo que llega por save_workout_session y expone /__state para inspeccionarlo.
// Uso: node tests/e2e/mock-supabase.ts [puerto]
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EMPTY_TABLES = new Set([
  'notification_settings',
  'push_subscriptions',
  'training_profiles',
  'session_blocks',
  'exercise_sets',
  'exercises',
  'exercise_muscles',
  'body_metrics',
  'progress_photos',
  'personal_records',
  'daily_checkins',
  'user_plans',
  'planned_sessions',
  'ai_interactions',
  'ai_chat_messages',
  'partner_links',
  'milestones_shown',
  'reactions',
  'commitments',
  'profiles',
  'workout_sessions',
  'pair_invites',
])

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
const { technique } = JSON.parse(
  readFileSync(join(root, 'supabase/seed/exercise_technique.json'), 'utf8'),
) as { technique: Record<string, { steps: string[]; mistakes: string[] }> }
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
  technique_steps: technique[e.id]?.steps ?? [],
  technique_mistakes: technique[e.id]?.mistakes ?? [],
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
  // Fase 7A: invitaciones a entrenar juntos recibidas.
  pairInvites?: (Record<string, unknown> & { id: string; status: string })[]
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
// Fase 6A: consultas a la IA y simulador de Gemini (respuestas en cola con POST /__seed).
type AiRow = Record<string, unknown> & { id: string; status: string; accepted: boolean | null }
let aiInteractions: AiRow[] = []
// Fase 6B: mensajes del chat (como ai_chat_messages).
let chatMessages: Record<string, unknown>[] = []
let chatSeq = 0
let geminiQueue: unknown[] = []
let geminiRequests: { model: string; key: string | undefined; body: unknown }[] = []
// Fase 7A: cambios de permisos (PATCH partner_links) y respuestas a invitaciones.
let partnerPatches: Record<string, unknown>[] = []
// Invitaciones por enlace (0030): códigos, usuarios creados con service role, intentos por IP,
// vínculos creados al canjear y contraseñas cambiadas por el admin.
type InviteRow = {
  id: string
  code: string
  created_by: string
  created_by_name: string | null
  created_at: string
  expires_at: string
  max_uses: number
  uses: number
  revoked: boolean
  used_by: string | null
  used_by_name: string | null
  used_at: string | null
}
let inviteCodes: InviteRow[] = []
let inviteSettings = { members_can_invite: false, max_active_invites_per_user: 3 }
let inviteAttempts = 0
let authUsers: { id: string; email: string; password: string; user_metadata: unknown }[] = []
let deletedUsers: string[] = []
let redeemed: { code: string; user: string }[] = []
let passwordUpdates: { id: string; password: string }[] = []
let otherProfiles: Record<string, Record<string, unknown>> = {}
const EXISTING_EMAILS = new Set(['e2e@test.dev'])
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function inviteState(c: InviteRow) {
  if (c.revoked) return 'revoked'
  if (c.uses >= c.max_uses) return 'used'
  if (new Date(c.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

function normalizeCode(raw: string) {
  const c = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c
}

function newInviteCode(createdBy: string, name: string | null): InviteRow {
  let code = ''
  for (let i = 0; i < 12; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * 32)]
    if (i === 3 || i === 7) code += '-'
  }
  return {
    id: randomUUID(),
    code,
    created_by: createdBy,
    created_by_name: name,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    max_uses: 1,
    uses: 0,
    revoked: false,
    used_by: null,
    used_by_name: null,
    used_at: null,
  }
}

// JWT que el mock acepta (mismo formato que tests/e2e/helpers.ts).
function mockSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: MOCK_USER_ID, exp, role: 'authenticated', aud: 'authenticated' })}.sig`
  return {
    access_token: jwt,
    refresh_token: 'refresh',
    expires_in: 3600,
    expires_at: exp,
    token_type: 'bearer',
    user,
  }
}

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

// Tipos de actividad (0031/0032): globales de la semilla + las personalizadas creadas en el test.
type ActivityRow = Record<string, unknown> & { id: string; owner_id: string | null }
const globalActivities: ActivityRow[] = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/activity_types.json'), 'utf8')) as {
    activity_types: Record<string, unknown>[]
  }
).activity_types.map((a) => ({ ...a, id: String(a.id), owner_id: null, archived: false }))
let customActivities: ActivityRow[] = []

function sessionRow(p: Payload) {
  return {
    ...p.session,
    activity_type_id: p.session.activity_type_id ?? null,
    user_id: MOCK_USER_ID,
    planned_session_id: p.session.planned_session_id ?? null,
    distance_m: p.session.distance_m ?? null,
    pair_group_id: p.session.pair_group_id ?? null,
    created_at: '',
    updated_at: '',
  }
}

type CreatePlanArgs = {
  p_template_id: string | null
  p_name: string
  p_start_date: string
  p_sessions: Record<string, unknown>[]
  p_source?: string
  p_notes?: string | null
}

// Como create_user_plan (0024): archiva el activo y crea el nuevo con sus sesiones.
function createUserPlan(b: CreatePlanArgs) {
  for (const p of userPlans) if (p.status === 'active') p.status = 'archived'
  const id = crypto.randomUUID()
  userPlans.push({
    id,
    user_id: MOCK_USER_ID,
    template_id: b.p_template_id,
    name: b.p_name,
    start_date: b.p_start_date,
    status: 'active',
    source: b.p_source ?? 'template',
    notes: b.p_notes ?? null,
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
  return id
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
        aiInteractions,
        chatMessages,
        geminiRequests,
        partnerPatches,
        pairInvites: progressSeed.pairInvites ?? [],
        customActivities,
        inviteCodes,
        inviteSettings,
        inviteAttempts,
        authUsers,
        deletedUsers,
        redeemed,
        passwordUpdates,
        otherProfiles,
        partnerLinks: progressSeed.partnerLinks,
      })
    }
    if (path === '/__seed') {
      const body = (await readBody(req)) as Partial<Seed> & {
        trainingProfile?: Record<string, unknown> | null
        userPlans?: PlanRow[]
        plannedSessions?: PlannedRow[]
        gemini?: unknown[]
        inviteCodes?: (Partial<InviteRow> & { code: string })[]
        inviteSettings?: typeof inviteSettings
        authUsers?: { id: string; email: string; display_name?: string }[]
      }
      if (body.inviteCodes) {
        inviteCodes = body.inviteCodes.map((c) => ({
          ...newInviteCode(MOCK_USER_ID, 'E2E'),
          ...c,
        }))
      }
      if (body.inviteSettings) inviteSettings = body.inviteSettings
      if (body.authUsers) {
        for (const u of body.authUsers) {
          authUsers.push({ id: u.id, email: u.email, password: '', user_metadata: {} })
          otherProfiles[u.id] = {
            id: u.id,
            display_name: u.display_name ?? u.email.split('@')[0],
            role: 'member',
            active: true,
            must_change_password: false,
          }
        }
      }
      delete body.inviteCodes
      delete body.inviteSettings
      delete body.authUsers
      if (body.gemini) geminiQueue = body.gemini
      delete body.gemini
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
      customActivities = []
      saveCalls = 0
      progressSeed = { commitments: [], partnerLinks: [], partnerDays: {} }
      profile = { ...baseProfile }
      milestones = []
      trainingProfile = { ...baseTrainingProfile }
      userPlans = []
      plannedSessions = []
      dailyCheckins = []
      aiInteractions = []
      chatMessages = []
      chatSeq = 0
      geminiQueue = []
      geminiRequests = []
      partnerPatches = []
      inviteCodes = []
      inviteSettings = { members_can_invite: false, max_active_invites_per_user: 3 }
      inviteAttempts = 0
      authUsers = []
      deletedUsers = []
      redeemed = []
      passwordUpdates = []
      otherProfiles = {}
      return send(res, 200, { ok: true })
    }

    // ── Invitaciones por enlace (0030) ──
    if (path === '/rest/v1/rpc/invite_attempts_count') return send(res, 200, inviteAttempts)
    if (path === '/rest/v1/rpc/record_invite_attempt') {
      inviteAttempts++
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/lookup_invite_code') {
      const { p_code } = (await readBody(req)) as { p_code: string }
      const c = inviteCodes.find((x) => x.code === normalizeCode(p_code))
      return send(res, 200, [
        c
          ? {
              state: inviteState(c),
              code: c.code,
              inviter_id: c.created_by,
              inviter_name: c.created_by_name,
            }
          : { state: 'not_found', code: null, inviter_id: null, inviter_name: null },
      ])
    }
    if (path === '/rest/v1/rpc/redeem_invite_code') {
      const { p_code, p_user } = (await readBody(req)) as { p_code: string; p_user: string }
      const c = inviteCodes.find((x) => x.code === normalizeCode(p_code))
      if (!c) return send(res, 400, { code: 'P0002', message: 'invite_not_found' })
      const st = inviteState(c)
      if (st !== 'active') return send(res, 400, { code: 'P0001', message: `invite_${st}` })
      if (c.created_by === p_user) return send(res, 400, { code: '22023', message: 'invite_own' })
      c.uses++
      c.used_by = p_user
      c.used_by_name =
        (otherProfiles[p_user]?.display_name as string | undefined) ??
        (p_user === MOCK_USER_ID ? String(profile.display_name) : null)
      c.used_at = new Date().toISOString()
      redeemed.push({ code: c.code, user: p_user })
      return send(res, 200, 'linked')
    }
    if (path === '/rest/v1/rpc/my_invite_status') {
      const admin = profile.role === 'admin'
      const active = inviteCodes.filter(
        (c) => c.created_by === MOCK_USER_ID && inviteState(c) === 'active',
      ).length
      const max = inviteSettings.max_active_invites_per_user
      return send(res, 200, [
        {
          can_invite: admin || (inviteSettings.members_can_invite && active < max),
          is_admin: admin,
          max_active: admin ? null : max,
          active_count: active,
        },
      ])
    }
    if (path === '/rest/v1/rpc/create_invite_code') {
      const admin = profile.role === 'admin'
      const active = inviteCodes.filter(
        (c) => c.created_by === MOCK_USER_ID && inviteState(c) === 'active',
      ).length
      if (!admin && !inviteSettings.members_can_invite)
        return send(res, 400, { code: '42501', message: 'invite_not_allowed' })
      if (!admin && active >= inviteSettings.max_active_invites_per_user)
        return send(res, 400, { code: 'P0001', message: 'invite_limit' })
      const row = newInviteCode(MOCK_USER_ID, String(profile.display_name))
      inviteCodes.unshift(row)
      return send(res, 200, row)
    }
    if (path === '/rest/v1/rpc/list_invite_codes') {
      const { p_all } = (await readBody(req)) as { p_all?: boolean }
      return send(
        res,
        200,
        inviteCodes
          .filter((c) => c.created_by === MOCK_USER_ID || (p_all && profile.role === 'admin'))
          .map((c) => ({ ...c, state: inviteState(c) })),
      )
    }
    if (path === '/rest/v1/rpc/revoke_invite_code') {
      const { p_id } = (await readBody(req)) as { p_id: string }
      const c = inviteCodes.find((x) => x.id === p_id)
      if (!c) return send(res, 400, { code: 'P0002', message: 'invite_not_found' })
      c.revoked = true
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/set_invite_settings') {
      const b = (await readBody(req)) as { p_members_can_invite: boolean; p_max_active: number }
      inviteSettings = {
        members_can_invite: b.p_members_can_invite,
        max_active_invites_per_user: b.p_max_active,
      }
      return send(res, 200, null)
    }
    if (path === '/rest/v1/app_settings') {
      return send(res, 200, rows(req, [{ id: true, ...inviteSettings, updated_at: '' }]))
    }
    // Auth con service role: crear, borrar, cambiar contraseña y listar usuarios.
    if (path === '/auth/v1/admin/users' && req.method === 'POST') {
      const b = (await readBody(req)) as {
        email: string
        password: string
        email_confirm?: boolean
        user_metadata?: { display_name?: string }
      }
      const email = b.email.toLowerCase()
      if (EXISTING_EMAILS.has(email) || authUsers.some((u) => u.email === email)) {
        return send(res, 422, {
          code: 'email_exists',
          error_code: 'email_exists',
          msg: 'A user with this email address has already been registered',
        })
      }
      if (!b.email_confirm) return send(res, 400, { msg: 'mock: email_confirm requerido' })
      const id = randomUUID()
      authUsers.push({ id, email, password: b.password, user_metadata: b.user_metadata ?? {} })
      otherProfiles[id] = {
        id,
        display_name: b.user_metadata?.display_name ?? email.split('@')[0],
        role: 'member',
        active: true,
        must_change_password: false,
      }
      return send(res, 200, { id, email, aud: 'authenticated', role: 'authenticated' })
    }
    if (path === '/auth/v1/admin/users' && req.method === 'GET') {
      const list = [
        { id: MOCK_USER_ID, email: user.email, last_sign_in_at: '2026-01-01T00:00:00Z' },
        ...authUsers.map((u) => ({
          id: u.id,
          email: u.email,
          last_sign_in_at: '2026-01-01T00:00:00Z',
        })),
      ]
      return send(res, 200, { users: list, aud: 'authenticated' })
    }
    const adminUser = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(path)
    if (adminUser) {
      const id = adminUser[1]!
      if (req.method === 'DELETE') {
        deletedUsers.push(id)
        authUsers = authUsers.filter((u) => u.id !== id)
        delete otherProfiles[id]
        return send(res, 200, {})
      }
      const b = (await readBody(req)) as { password?: string }
      if (b.password) passwordUpdates.push({ id, password: b.password })
      return send(res, 200, { id, email: authUsers.find((u) => u.id === id)?.email ?? user.email })
    }
    if (path === '/auth/v1/token') return send(res, 200, mockSession())

    // Simulador de la API de Gemini (generateContent): devuelve la siguiente respuesta en cola.
    const gemini = /^\/gemini\/v1beta\/models\/([^/:]+):generateContent$/.exec(path)
    if (gemini) {
      const body = await readBody(req)
      geminiRequests.push({
        model: decodeURIComponent(gemini[1]!),
        key: req.headers['x-goog-api-key'] as string | undefined,
        body,
      })
      const next = geminiQueue.shift()
      // Cola vacía o { __status: 429 }: cuota agotada (para probar el modelo de reserva).
      if (next === undefined || (next as { __status?: number }).__status === 429) {
        return send(res, 429, {
          error: { message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' },
        })
      }
      return send(res, 200, {
        candidates: [
          { content: { parts: [{ text: JSON.stringify(next) }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
      })
    }

    // ── Fase 6A: ai_interactions (como 0024) ──
    if (path === '/rest/v1/rpc/ai_calls_today') {
      return send(res, 200, aiInteractions.filter((a) => a.status !== 'error').length)
    }
    if (path === '/rest/v1/rpc/begin_ai_interaction') {
      const b = (await readBody(req)) as Record<string, unknown>
      const used = aiInteractions.filter((a) => a.status !== 'error').length
      const period = (b.p_period as string | null | undefined) ?? null
      if (
        period &&
        aiInteractions.some(
          (a) => a.kind === b.p_kind && a.period === period && a.status === 'pending',
        )
      ) {
        return send(res, 400, { code: 'P0001', message: 'ai_in_progress' })
      }
      if (used >= Number(b.p_daily_limit)) {
        return send(res, 400, { code: 'P0001', message: 'ai_daily_limit' })
      }
      const id = crypto.randomUUID()
      aiInteractions.push({
        id,
        user_id: MOCK_USER_ID,
        kind: b.p_kind,
        status: 'pending',
        input_summary: b.p_input_summary,
        output: null,
        accepted: null,
        model: b.p_model,
        period,
        responses: {},
        action_results: {},
        created_at: new Date(Date.now() + aiInteractions.length).toISOString(),
      })
      return send(res, 200, id)
    }
    if (path === '/rest/v1/rpc/finish_ai_interaction') {
      const b = (await readBody(req)) as Record<string, unknown>
      for (const a of aiInteractions.filter((x) => x.id === b.p_id && x.status === 'pending')) {
        Object.assign(a, {
          status: b.p_status,
          output: b.p_output ?? null,
          error: b.p_error,
          model: b.p_model ?? a.model,
        })
      }
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/apply_daily_adjust') {
      const b = (await readBody(req)) as { p_interaction: string; p_planned: string }
      const a = aiInteractions.find(
        (x) => x.id === b.p_interaction && x.status === 'ok' && x.accepted === null,
      )
      const output = a?.output as
        { proposal: { plannedSessionId: string; adjust: Record<string, unknown> } } | undefined
      const ps = plannedSessions.find((x) => x.id === b.p_planned)
      if (!a || !output || output.proposal.plannedSessionId !== b.p_planned || !ps) {
        return send(res, 400, { message: 'propuesta no encontrada o ya respondida' })
      }
      const adjust = output.proposal.adjust
      const session = adjust.session as Record<string, unknown> | undefined
      if (adjust.decision !== 'keep') {
        ps.adjusted_from ??= {
          title: ps.title,
          intensity: ps.intensity,
          duration_min: ps.duration_min,
          notes: ps.notes,
          blocks: ps.blocks,
          heavy_legs: ps.heavy_legs,
        }
      }
      if (adjust.decision === 'rest') {
        ps.status = 'skipped'
        ps.notes = `Descanso (IA): ${String(adjust.reason)}`
      } else if (session) {
        Object.assign(ps, {
          title: session.title,
          intensity: session.intensity,
          duration_min: session.duration_min,
          heavy_legs: session.heavy_legs,
          blocks: session.blocks,
          notes: `Ajustada por la IA: ${String(adjust.reason)}`,
        })
      }
      a.accepted = true
      return send(res, 200, adjust.decision)
    }
    if (path === '/rest/v1/rpc/revert_daily_adjust') {
      const { p_planned } = (await readBody(req)) as { p_planned: string }
      const ps = plannedSessions.find((x) => x.id === p_planned)
      if (!ps?.adjusted_from) return send(res, 400, { message: 'no hay ajuste que deshacer' })
      Object.assign(ps, ps.adjusted_from, {
        status: ps.original_date ? 'moved' : 'planned',
        adjusted_from: null,
      })
      return send(res, 200, null)
    }
    if (path === '/rest/v1/ai_interactions') {
      const id = eqParam(url, 'id')
      if (req.method === 'PATCH') {
        const hit = aiInteractions.filter((a) => a.id === id)
        const patch = (await readBody(req)) as { accepted: boolean }
        for (const a of hit) a.accepted = patch.accepted
        return send(
          res,
          200,
          hit.map((a) => ({ id: a.id })),
        )
      }
      // Lecturas (6B): revisión guardada por kind/status/period y cambios del chat por id=in.(…).
      const ids = /^in\.\((.*)\)$/
        .exec(url.searchParams.get('id') ?? '')?.[1]
        ?.split(',')
        .map((x) => x.replace(/"/g, ''))
      const filters = ['kind', 'status', 'period'].map((c) => [c, eqParam(url, c)] as const)
      const list = aiInteractions
        .filter((a) => !id || a.id === id)
        .filter((a) => !ids || ids.includes(a.id))
        .filter((a) => filters.every(([c, v]) => v === null || a[c] === v))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      return send(res, 200, rows(req, list))
    }
    if (path === '/rest/v1/ai_chat_messages') {
      if (req.method === 'DELETE') {
        const removed = chatMessages
        chatMessages = []
        return send(res, 200, removed)
      }
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      return send(
        res,
        200,
        [...chatMessages].sort((a, b) => Number(b.seq) - Number(a.seq)).slice(0, limit),
      )
    }
    if (path === '/rest/v1/rpc/save_chat_turn') {
      const b = (await readBody(req)) as { p_interaction: string; p_user_text: string }
      const a = aiInteractions.find(
        (x) => x.id === b.p_interaction && x.kind === 'chat' && x.status === 'ok',
      )
      const reply = (a?.output as { reply?: string } | null)?.reply
      if (!a || !reply) return send(res, 400, { message: 'consulta de chat no encontrada' })
      if (!chatMessages.some((m) => m.interaction_id === a.id)) {
        for (const [role, content] of [
          ['user', b.p_user_text],
          ['assistant', reply],
        ]) {
          chatMessages.push({
            id: crypto.randomUUID(),
            seq: ++chatSeq,
            user_id: MOCK_USER_ID,
            role,
            content,
            interaction_id: a.id,
            created_at: new Date().toISOString(),
          })
        }
      }
      return send(res, 200, null)
    }
    // ── Acciones del chat (como 0033) ──
    if (path === '/rest/v1/rpc/link_chat_plan') {
      const b = (await readBody(req)) as { p_chat: string; p_plan: string }
      const chat = aiInteractions.find((x) => x.id === b.p_chat && x.kind === 'chat')
      const plan = aiInteractions.find(
        (x) => x.id === b.p_plan && x.kind === 'plan_generation' && x.status === 'ok',
      )
      if (!chat || !(chat.output as { plan_request?: unknown } | null)?.plan_request) {
        return send(res, 400, { message: 'la respuesta no propone un plan' })
      }
      if (!plan) return send(res, 400, { message: 'plan no encontrado' })
      const results = chat.action_results as Record<string, unknown>
      results.plan = { status: 'prepared', interaction_id: plan.id }
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/accept_chat_plan') {
      const b = (await readBody(req)) as {
        p_chat: string
        p_name: string
        p_start_date: string
        p_sessions: Record<string, unknown>[]
      }
      const chat = aiInteractions.find((x) => x.id === b.p_chat && x.kind === 'chat')
      const results = (chat?.action_results ?? {}) as Record<string, Record<string, unknown>>
      if (!chat || results.plan?.status !== 'prepared') {
        return send(res, 400, { message: 'no hay ningún plan preparado' })
      }
      const plan = aiInteractions.find((x) => x.id === results.plan!.interaction_id)!
      const proposal = (plan.output as { proposal: Record<string, unknown> }).proposal
      const replaced = userPlans.find((p) => p.status === 'active')?.name ?? null
      const name = b.p_name.trim() || String(proposal.name)
      const planId = createUserPlan({
        p_template_id: (proposal.baseTemplateId as string | null) ?? null,
        p_name: name,
        p_start_date: b.p_start_date,
        p_sessions: b.p_sessions,
        p_source: 'ai',
        p_notes: String(proposal.summary),
      })
      const mine = plannedSessions.filter((x) => x.user_plan_id === planId)
      const byWeek = new Map<unknown, number>()
      for (const x of mine) byWeek.set(x.week, (byWeek.get(x.week) ?? 0) + 1)
      const result = {
        status: 'accepted',
        interaction_id: plan.id,
        plan_id: planId,
        name,
        start_date: b.p_start_date,
        sessions: mine.length,
        weeks: byWeek.size,
        per_week: Math.max(0, ...byWeek.values()),
        replaced,
      }
      plan.accepted = true
      chat.accepted = true
      results.plan = result
      return send(res, 200, result)
    }
    if (path === '/rest/v1/rpc/discard_chat_action') {
      const b = (await readBody(req)) as { p_chat: string; p_key: string }
      const chat = aiInteractions.find((x) => x.id === b.p_chat && x.kind === 'chat')
      if (!chat) return send(res, 400, { message: 'consulta de chat no encontrada' })
      ;(chat.action_results as Record<string, unknown>)[b.p_key] = { status: 'discarded' }
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/respond_ai_change') {
      const b = (await readBody(req)) as {
        p_interaction: string
        p_index: number
        p_accept: boolean
      }
      const a = aiInteractions.find(
        (x) =>
          x.id === b.p_interaction &&
          (x.kind === 'weekly_review' || x.kind === 'chat') &&
          x.status === 'ok',
      )
      const changes = (a?.output as { changes?: Record<string, unknown>[] } | null)?.changes
      const change = changes?.[b.p_index]
      if (!a || !change) return send(res, 400, { message: 'propuesta no encontrada' })
      const responses = (a.responses ?? {}) as Record<string, string>
      if (responses[String(b.p_index)]) return send(res, 400, { message: 'cambio ya respondido' })
      if (b.p_accept) {
        const ps = plannedSessions.find((x) => x.id === change.planned_session_id)
        const session = change.session as Record<string, unknown> | undefined
        if (change.action !== 'add' && (!ps || !['planned', 'moved'].includes(ps.status))) {
          return send(res, 400, { message: 'sesión planificada no encontrada' })
        }
        const original = ps && {
          title: ps.title,
          intensity: ps.intensity,
          duration_min: ps.duration_min,
          notes: ps.notes,
          blocks: ps.blocks,
          heavy_legs: ps.heavy_legs,
        }
        if (change.action === 'modify' && ps && session) {
          ps.adjusted_from ??= original
          Object.assign(ps, {
            title: session.title,
            intensity: session.intensity,
            duration_min: session.duration_min,
            heavy_legs: session.heavy_legs,
            blocks: session.blocks,
            notes: `Cambio de la IA: ${String(change.reason)}`,
          })
        } else if (change.action === 'skip' && ps) {
          ps.adjusted_from ??= original
          ps.status = 'skipped'
          ps.notes = `Descanso (IA): ${String(change.reason)}`
        } else if (change.action === 'move' && ps) {
          ps.original_date ??= ps.date
          ps.date = change.date
          ps.status = 'moved'
        } else if (change.action === 'add' && session) {
          const plan = userPlans.find((p) => p.status === 'active')
          if (!plan) return send(res, 400, { message: 'no hay plan activo' })
          plannedSessions.push({
            id: crypto.randomUUID(),
            user_plan_id: plan.id,
            user_id: MOCK_USER_ID,
            date: change.date,
            original_date: null,
            week: 1,
            session_type: session.session_type,
            title: session.title,
            intensity: session.intensity,
            heavy_legs: session.heavy_legs,
            duration_min: session.duration_min,
            notes: `Añadida por la IA: ${String(change.reason)}`,
            blocks: session.blocks,
            status: 'planned',
            workout_session_id: null,
          })
        }
      }
      responses[String(b.p_index)] = b.p_accept ? 'accepted' : 'discarded'
      a.responses = responses
      if (b.p_accept) a.accepted = true
      return send(res, 200, b.p_accept ? change.action : 'discarded')
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
    if (path === '/rest/v1/rpc/list_partners') return send(res, 200, progressSeed.partnerLinks)
    // ── Fase 7A ──
    if (path === '/rest/v1/partner_links' && req.method === 'PATCH') {
      const patch = (await readBody(req)) as Record<string, unknown>
      const partner = eqParam(url, 'partner_id')
      partnerPatches.push({ partner_id: partner, ...patch })
      for (const l of progressSeed.partnerLinks.filter((x) => x.partner_id === partner)) {
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) l[k.replace('can_view_', 'i_share_')] = v
        }
      }
      return send(res, 200, [{ user_id: MOCK_USER_ID }])
    }
    if (
      ['partner_session_log', 'partner_sessions', 'partner_exercise_sets', 'partner_home'].some(
        (fn) => path === `/rest/v1/rpc/${fn}`,
      )
    ) {
      return send(res, 200, [])
    }
    if (path === '/rest/v1/pair_invites') {
      const status = eqParam(url, 'status')
      const group = eqParam(url, 'pair_group_id')
      return send(
        res,
        200,
        (progressSeed.pairInvites ?? []).filter(
          (i) => (!status || i.status === status) && (!group || i.pair_group_id === group),
        ),
      )
    }
    // ── Fase 7B: invitar a entrenar y sincronizar la estructura ──
    if (path === '/rest/v1/rpc/create_pair_invite') {
      const b = (await readBody(req)) as {
        p_partner: string
        p_pair_group_id: string
        p_payload: Record<string, unknown>
      }
      const id = randomUUID()
      progressSeed.pairInvites = [
        ...(progressSeed.pairInvites ?? []),
        {
          id,
          pair_group_id: b.p_pair_group_id,
          from_user: MOCK_USER_ID,
          to_user: b.p_partner,
          payload: b.p_payload,
          status: 'pending',
          created_at: new Date().toISOString(),
          updates: 0,
        },
      ]
      return send(res, 200, id)
    }
    if (path === '/rest/v1/rpc/update_pair_invite') {
      const b = (await readBody(req)) as { p_invite: string; p_payload: Record<string, unknown> }
      const invite = (progressSeed.pairInvites ?? []).find((x) => x.id === b.p_invite)
      if (!invite || invite.status !== 'pending') {
        return send(res, 400, { message: 'La invitación ya no está pendiente' })
      }
      invite.payload = b.p_payload
      invite.updates = Number(invite.updates ?? 0) + 1
      return send(res, 200, null)
    }
    if (path === '/rest/v1/rpc/respond_pair_invite') {
      const b = (await readBody(req)) as { p_invite: string; p_accept: boolean }
      for (const i of (progressSeed.pairInvites ?? []).filter((x) => x.id === b.p_invite)) {
        i.status = b.p_accept ? 'accepted' : 'declined'
      }
      return send(res, 200, null)
    }
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
      return send(res, 200, createUserPlan((await readBody(req)) as CreatePlanArgs))
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
    if (['personal_records', 'body_metrics', 'progress_photos', 'reactions'].includes(table)) {
      return send(res, 200, rows(req, []))
    }
    if (table === 'profiles') {
      const pid = eqParam(url, 'id')
      if (req.method === 'POST') {
        // upsert del servidor al registrarse con invitación
        const b = (await readBody(req)) as Record<string, unknown> | Record<string, unknown>[]
        for (const r of Array.isArray(b) ? b : [b]) {
          const id = String(r.id)
          otherProfiles[id] = { ...(otherProfiles[id] ?? {}), ...r }
        }
        return send(res, 201, [])
      }
      if (req.method === 'GET' && !pid) {
        // listUsers del admin (service role): todos los perfiles
        return send(res, 200, [profile, ...Object.values(otherProfiles)])
      }
      if (req.method === 'PATCH' && pid && pid !== MOCK_USER_ID) {
        const patch = (await readBody(req)) as object
        otherProfiles[pid] = { ...(otherProfiles[pid] ?? { id: pid }), ...patch }
        return send(res, 200, [otherProfiles[pid]])
      }
      if (req.method === 'PATCH') {
        const patch = (await readBody(req)) as object
        if (progressSeed.profileUpdateBlocked) return send(res, 200, [])
        profile = { ...profile, ...patch }
      }
      return send(res, 200, rows(req, [profile]))
    }
    if (table === 'exercises') return send(res, 200, rows(req, exercises))
    if (table === 'activity_types') {
      if (req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>
        const row: ActivityRow = {
          id: `a_${randomUUID().replace(/-/g, '')}`,
          exercise_id: 'other_activity',
          location: 'other',
          sets_per_30min: 2,
          quick: true,
          fixed: true,
          free_activity: true,
          leg_loading: false,
          hard_legs: false,
          sort_order: 1000,
          archived: false,
          created_at: new Date().toISOString(),
          ...body,
          owner_id: MOCK_USER_ID,
        }
        customActivities.push(row)
        return send(res, 201, rows(req, [row]))
      }
      if (req.method === 'PATCH') {
        const id = eqParam(url, 'id')
        const patch = (await readBody(req)) as Record<string, unknown>
        const row = customActivities.find((a) => a.id === id)
        if (!row) return send(res, 200, [])
        Object.assign(row, patch)
        return send(res, 200, [row])
      }
      const owner = eqParam(url, 'owner_id')
      const list = [...globalActivities, ...customActivities].filter(
        (a) => !owner || a.owner_id === owner,
      )
      return send(res, 200, rows(req, list))
    }
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
    // Fase 7B: tablas que solo lee la exportación o Notificaciones (vacías en el mock).
    if (req.method === 'GET' && EMPTY_TABLES.has(path.replace('/rest/v1/', '')))
      return send(res, 200, [])
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
