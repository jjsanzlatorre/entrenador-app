// Fase 6B con el proveedor simulado (nunca se llama a la API real): caché de la revisión
// semanal, modelo de reserva, validación de los cambios propuestos por el chat y exercise_id de
// la sustitución.
import { describe, expect, it, vi } from 'vitest'
import type { AiContextInput, ContextPlanned } from '@/lib/ai/context'
import { computeReviewFacts, reviewWeekOf } from '@/lib/ai/review'
import type { ChatReply, PlanChange, WeeklyReview, WeeklyReviewAi } from '@/lib/ai/schemas'
import { sampleContextInput, sampleReduce } from '@/lib/ai/test-fixtures'
import {
  chatReply,
  proposeDailyAdjust,
  proposeSwap,
  weeklyReview,
  type CoachDeps,
  type ReviewStore,
} from './coach'
import { getAiConfig } from './config'
import { createModelChain } from './providers/chain'
import { createGeminiProvider } from './providers/gemini'
import { AiProviderError, type AiProvider, type JsonRequest } from './providers/types'
import { DailyLimitError, InProgressError, type UsageStore } from './usage'

// ── Simuladores ────────────────────────────────────────────

// Modelo normal → reserva (cadena de providers/chain.ts, sin pesado).
function withFallback(primary: AiProvider, fallback: AiProvider | null) {
  return createModelChain({
    steps: [
      { role: 'light', provider: primary, timeoutMs: 15_000 },
      ...(fallback ? [{ role: 'fallback' as const, provider: fallback, timeoutMs: 15_000 }] : []),
    ],
    budgetMs: 50_000,
  })
}

function mockProvider(responses: (string | Error)[], model = 'mock-1') {
  const requests: JsonRequest[] = []
  const provider: AiProvider = {
    name: 'mock',
    model,
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = responses.shift()
      if (next === undefined) throw new Error('sin más respuestas')
      if (next instanceof Error) throw next
      return { text: next, tokensIn: 100, tokensOut: 50, model }
    }),
  }
  return { provider, requests }
}

type Row = {
  id: string
  kind: string
  status: string
  period?: string
  output?: unknown
  model?: string
  createdAt: string
}

// Registro en memoria con el límite diario y el bloqueo de periodo de la RPC (0025).
function memoryUsage(limit: number) {
  const rows: Row[] = []
  let clock = 0
  const store: UsageStore = {
    async begin(kind, _summary, period) {
      if (
        period &&
        rows.some((r) => r.kind === kind && r.period === period && r.status === 'pending')
      ) {
        throw new InProgressError()
      }
      if (rows.filter((r) => r.status !== 'error').length >= limit) throw new DailyLimitError()
      const id = `ai-${rows.length + 1}`
      rows.push({ id, kind, status: 'pending', period, createdAt: `2026-09-29T08:00:0${clock++}Z` })
      return id
    },
    async finish(id, r) {
      Object.assign(
        rows.find((x) => x.id === id)!,
        r,
      )
    },
    async usedToday() {
      return rows.filter((r) => r.status !== 'error').length
    },
  }
  // Como supabaseReviewStore: la última revisión válida de esa semana.
  const reviews: ReviewStore = {
    async latest(weekStart) {
      const row = rows
        .filter((r) => r.kind === 'weekly_review' && r.status === 'ok' && r.period === weekStart)
        .at(-1)
      return row
        ? {
            interactionId: row.id,
            review: row.output as WeeklyReview,
            responses: {},
            createdAt: row.createdAt,
          }
        : null
    },
  }
  return { store, reviews, rows }
}

const planned = (
  id: string,
  date: string,
  status: ContextPlanned['status'] = 'planned',
): ContextPlanned => ({
  id,
  date,
  week: 1,
  sessionType: 'strength',
  title: `Sesión ${id}`,
  intensity: 'moderate',
  heavyLegs: false,
  durationMin: 60,
  notes: null,
  status,
  blocks: [
    { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8' }] },
  ],
})

// Hoy martes 29/09/2026; plan con sesiones la semana pasada y esta.
function withPlan(overrides: Partial<AiContextInput> = {}): AiContextInput {
  const sessions = [
    planned('p-last-1', '2026-09-22', 'done'),
    planned('p-last-2', '2026-09-24', 'skipped'),
    planned('p-mon', '2026-09-28', 'done'),
    planned('p-wed', '2026-09-30'),
    planned('p-fri', '2026-10-02'),
    planned('p-next', '2026-10-06'),
    planned('p-far', '2026-10-20'),
  ]
  return sampleContextInput({
    plan: { name: 'Plan', startDate: '2026-09-21', sessions },
    ...overrides,
  })
}

const session = {
  title: 'Full body suave',
  intensity: 'easy' as const,
  heavy_legs: false,
  duration_min: 40,
  blocks: [
    {
      block_type: 'straight' as const,
      exercises: [{ exercise_id: 'goblet_squat', sets: 2, reps: '10' }],
    },
  ],
}

function sampleReview(changes: PlanChange[] = []): WeeklyReviewAi {
  return {
    headline: '¡Buena semana de carrera!',
    summary: 'Hiciste 1 sesión y el plan va bien.',
    recommendations: [
      { title: 'Remo el jueves', detail: 'Añade 3 series de remo con mancuerna.' },
      { title: 'RPE siempre', detail: 'Apunta el RPE al terminar.' },
      { title: 'Duerme', detail: 'Intenta dormir 7 h antes de la pierna.' },
    ],
    changes,
  }
}

// ── Revisión semanal ───────────────────────────────────────

describe('revisión semanal: una por semana y guardada', () => {
  function reviewDeps(responses: (string | Error)[], limit = 20) {
    const { provider } = mockProvider(responses)
    const usage = memoryUsage(limit)
    return {
      deps: { provider, usage: usage.store, dailyLimit: limit, reviews: usage.reviews },
      provider,
      rows: usage.rows,
    }
  }
  const load = vi.fn(async () => withPlan())
  const req = { today: '2026-09-29', load }

  it('la primera vez la genera; volver a abrirla no llama a la IA ni gasta consulta', async () => {
    const { deps, provider, rows } = reviewDeps([JSON.stringify(sampleReview())])
    const first = await weeklyReview(deps, { ...req, generate: true, force: false })
    expect(first).toMatchObject({ ok: true, cached: false, remaining: 19 })
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'weekly_review', status: 'ok', period: '2026-09-21' }),
    ])

    const again = await weeklyReview(deps, { ...req, generate: true, force: false })
    expect(again).toMatchObject({ ok: true, cached: true, remaining: 19 })
    expect(again.ok && again.review.review.headline).toBe('¡Buena semana de carrera!')
    expect(provider.generateJson).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
  })

  it('sin revisión guardada y sin generate: no llama a la IA', async () => {
    const { deps, provider } = reviewDeps([])
    const res = await weeklyReview(deps, { ...req, generate: false, force: false })
    expect(res).toMatchObject({ ok: false, code: 'not_generated' })
    expect(provider.generateJson).not.toHaveBeenCalled()
  })

  it('«Regenerar» sí gasta una consulta y la nueva sustituye a la anterior', async () => {
    const second = sampleReview()
    second.headline = 'Revisión nueva'
    const { deps, provider, rows } = reviewDeps([
      JSON.stringify(sampleReview()),
      JSON.stringify(second),
    ])
    await weeklyReview(deps, { ...req, generate: true, force: false })
    const regenerated = await weeklyReview(deps, { ...req, generate: false, force: true })
    expect(regenerated).toMatchObject({ ok: true, cached: false, remaining: 18 })
    expect(provider.generateJson).toHaveBeenCalledTimes(2)
    const cached = await weeklyReview(deps, { ...req, generate: false, force: false })
    expect(cached.ok && cached.review.review.headline).toBe('Revisión nueva')
    expect(rows).toHaveLength(2)
  })

  it('los datos de la semana salen del cálculo, no de la IA', async () => {
    const { deps, provider } = reviewDeps([JSON.stringify(sampleReview())])
    const res = await weeklyReview(deps, { ...req, generate: true, force: false })
    expect(res.ok && res.review.facts).toMatchObject({
      weekStart: '2026-09-21',
      sessions: 1,
      byType: { running: 1 },
      plan: { done: 1, planned: 2 },
      load: 150,
    })
    const prompt = (provider.generateJson as ReturnType<typeof vi.fn>).mock.calls[0]![0].prompt
    expect(prompt).toContain('"review_week":{"weekStart":"2026-09-21"')
    // Solo las sesiones pendientes de esta semana se pueden cambiar.
    expect(prompt).toContain('"planned_session_id":"p-wed"')
    expect(prompt).not.toContain('"planned_session_id":"p-next"')
  })

  it('sin sesiones ni plan la semana pasada: no gasta consulta', async () => {
    const { deps, provider } = reviewDeps([])
    const res = await weeklyReview(deps, {
      today: '2026-09-29',
      load: async () => sampleContextInput({ sessions: [] }),
      generate: true,
      force: false,
    })
    expect(res).toMatchObject({ ok: false, code: 'no_data' })
    expect(provider.generateJson).not.toHaveBeenCalled()
  })

  it('cambios con sesiones de fuera de esta semana: reintento y, si insiste, se quitan', async () => {
    const bad = sampleReview([
      { action: 'skip', planned_session_id: 'p-next', title: 'Descansa', reason: 'Carga alta' },
      {
        action: 'modify',
        planned_session_id: 'p-wed',
        title: 'Más suave',
        reason: 'Agujetas',
        session,
      },
    ])
    const { deps, provider } = reviewDeps([JSON.stringify(bad), JSON.stringify(bad)])
    const res = await weeklyReview(deps, { ...req, generate: true, force: false })
    expect(provider.generateJson).toHaveBeenCalledTimes(2)
    const retry = (provider.generateJson as ReturnType<typeof vi.fn>).mock.calls[1]![0].prompt
    expect(retry).toContain('p-next')
    expect(res.ok && res.review.changes.map((c) => c.planned_session_id)).toEqual(['p-wed'])
  })

  it('otra revisión de la misma semana en curso → aviso sin llamar a la IA', async () => {
    const { deps, provider } = reviewDeps([])
    await deps.usage.begin('weekly_review', {}, '2026-09-21')
    const res = await weeklyReview(deps, { ...req, generate: true, force: false })
    expect(res).toMatchObject({ ok: false, code: 'in_progress' })
    expect(provider.generateJson).not.toHaveBeenCalled()
  })

  it('semana revisada = la anterior a la de hoy (lunes a domingo)', () => {
    expect(reviewWeekOf('2026-09-28')).toBe('2026-09-21')
    expect(reviewWeekOf('2026-10-04')).toBe('2026-09-21')
    expect(reviewWeekOf('2026-10-05')).toBe('2026-09-28')
  })
})

describe('datos de la revisión (deterministas)', () => {
  it('compromiso, carga, ACWR, músculos descuidados y sobrecargados, récords', () => {
    const data = withPlan({
      sessions: [
        {
          id: 'old',
          date: '2026-08-31',
          sessionType: 'strength',
          title: null,
          durationMin: 60,
          rpe: 6,
          distanceM: null,
        },
        {
          id: 'w0',
          date: '2026-09-15',
          sessionType: 'strength',
          title: null,
          durationMin: 60,
          rpe: 6,
          distanceM: null,
        },
        {
          id: 'w1',
          date: '2026-09-22',
          sessionType: 'strength',
          title: null,
          durationMin: 60,
          rpe: 8,
          distanceM: null,
        },
        {
          id: 'w2',
          date: '2026-09-24',
          sessionType: 'running',
          title: null,
          durationMin: 30,
          rpe: 5,
          distanceM: 5000,
        },
      ],
      setCounts: [{ sessionId: 'w1', exerciseId: 'back_squat', sets: 22 }],
      prs: [
        {
          exerciseId: 'back_squat',
          prType: 'est_1rm',
          value: 100.04,
          unit: 'kg',
          date: '2026-09-22',
        },
        {
          exerciseId: 'back_squat',
          prType: 'max_weight',
          value: 90,
          unit: 'kg',
          date: '2026-09-29',
        },
      ],
    })
    const facts = computeReviewFacts(data, '2026-09-21')
    expect(facts).toMatchObject({
      sessions: 2,
      minutes: 90,
      commitment: { committed: 3, counted: 2, extra: 0, pct: 67 },
      load: 8 * 60 + 5 * 30,
      previousLoad: 360,
      overloaded: [
        // 22 series de sentadilla + 2 aproximadas de los 30 min de carrera.
        { muscleId: 'glutes', sets: 24 },
        { muscleId: 'quads', sets: 24 },
      ],
      prs: [{ exercise: 'Sentadilla con barra', type: 'est_1rm', value: 100 }],
    })
    // Pecho: 0 series esta semana y la anterior, con historial desde antes.
    expect(facts.neglected).toContain('chest')
    expect(facts.neglected).not.toContain('quads')
  })
})

// ── Modelo de reserva ──────────────────────────────────────

describe('modelo de reserva (GEMINI_FALLBACK_MODEL)', () => {
  const quota = () => new AiProviderError('quota', 'Gemini 429: Resource exhausted', 429)

  it('config: solo con Gemini y distinto del principal', () => {
    expect(
      getAiConfig({ GEMINI_API_KEY: 'k', GEMINI_FALLBACK_MODEL: 'gemini-2.5-flash-lite' })
        .fallbackModel,
    ).toBe('gemini-2.5-flash-lite')
    expect(getAiConfig({ GEMINI_API_KEY: 'k' }).fallbackModel).toBeNull()
    expect(
      getAiConfig({ GEMINI_API_KEY: 'k', GEMINI_FALLBACK_MODEL: 'gemini-2.5-flash' }).fallbackModel,
    ).toBeNull()
    expect(
      getAiConfig({
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        GEMINI_FALLBACK_MODEL: 'x',
      }).fallbackModel,
    ).toBeNull()
    expect(getAiConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).model).toBe(
      'claude-sonnet-5',
    )
  })

  it('429 del principal → reintenta una vez con la reserva y la consulta sale bien', async () => {
    const primary = mockProvider([quota()], 'principal')
    const fallback = mockProvider([JSON.stringify(sampleReduce())], 'reserva')
    const usage = memoryUsage(20)
    const deps: CoachDeps = {
      provider: withFallback(primary.provider, fallback.provider),
      usage: usage.store,
      dailyLimit: 20,
    }
    const res = await proposeDailyAdjust(deps, {
      data: sampleContextInput(),
      today: planned('p-today', '2026-09-29'),
    })
    expect(res).toMatchObject({ ok: true })
    expect(primary.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(fallback.provider.generateJson).toHaveBeenCalledTimes(1)
    // Queda registrado el modelo que respondió.
    expect(usage.rows[0]).toMatchObject({ status: 'ok', model: 'reserva' })
  })

  it('tras el 429, el reintento por salida no válida va directo a la reserva', async () => {
    const primary = mockProvider([quota()], 'principal')
    const fallback = mockProvider(['no es JSON', JSON.stringify(sampleReduce())], 'reserva')
    const provider = withFallback(primary.provider, fallback.provider)
    const usage = memoryUsage(20)
    const res = await proposeDailyAdjust(
      { provider, usage: usage.store, dailyLimit: 20 },
      { data: sampleContextInput(), today: planned('p-today', '2026-09-29') },
    )
    expect(res.ok).toBe(true)
    expect(primary.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(fallback.provider.generateJson).toHaveBeenCalledTimes(2)
    expect(provider.model).toBe('reserva')
  })

  it('si la reserva también está sin cuota → aviso de cuota (y no cuenta para el límite)', async () => {
    const primary = mockProvider([quota()], 'principal')
    const fallback = mockProvider([quota()], 'reserva')
    const usage = memoryUsage(20)
    const res = await proposeDailyAdjust(
      {
        provider: withFallback(primary.provider, fallback.provider),
        usage: usage.store,
        dailyLimit: 20,
      },
      { data: sampleContextInput(), today: planned('p-today', '2026-09-29') },
    )
    expect(res).toMatchObject({ ok: false, code: 'provider_quota' })
    expect(usage.rows[0]!.status).toBe('error')
  })

  it('otros errores no pasan a la reserva', async () => {
    const primary = mockProvider([new AiProviderError('auth', 'Gemini 401', 401)], 'principal')
    const fallback = mockProvider([JSON.stringify(sampleReduce())], 'reserva')
    const res = await proposeDailyAdjust(
      {
        provider: withFallback(primary.provider, fallback.provider),
        usage: memoryUsage(20).store,
        dailyLimit: 20,
      },
      { data: sampleContextInput(), today: planned('p-today', '2026-09-29') },
    )
    expect(res).toMatchObject({ ok: false, code: 'provider_auth' })
    expect(fallback.provider.generateJson).not.toHaveBeenCalled()
  })

  it('sin reserva configurada solo se prueba el modelo normal', async () => {
    const primary = mockProvider([quota()], 'principal')
    const res = await proposeDailyAdjust(
      {
        provider: withFallback(primary.provider, null),
        usage: memoryUsage(20).store,
        dailyLimit: 20,
      },
      { data: sampleContextInput(), today: planned('p-today', '2026-09-29') },
    )
    expect(res).toMatchObject({ ok: false, code: 'provider_quota' })
    expect(primary.provider.generateJson).toHaveBeenCalledTimes(1)
  })

  it('Gemini: RESOURCE_EXHAUSTED cuenta como cuota aunque no sea 429', async () => {
    const p = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: (async () =>
        Response.json(
          { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
          { status: 403 },
        )) as typeof fetch,
    })
    await expect(
      p.generateJson({
        system: 's',
        prompt: 'p',
        jsonSchema: {},
        maxOutputTokens: 10,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ kind: 'quota' })
  })
})

// ── Chat ────────────────────────────────────────────────────

describe('chat: validación de los cambios propuestos', () => {
  function chatDeps(responses: (string | Error)[]) {
    const { provider, requests } = mockProvider(responses)
    const usage = memoryUsage(20)
    const deps: CoachDeps = { provider, usage: usage.store, dailyLimit: 20 }
    return { deps, provider, requests, rows: usage.rows }
  }
  // Los cambios de sesiones llegan como acciones del chat (add_session, move_session…).
  const TYPES = {
    add: 'add_session',
    move: 'move_session',
    skip: 'skip_session',
    modify: 'modify_session',
  } as const
  const reply = (changes?: PlanChange[]): string =>
    JSON.stringify({
      reply: 'Te lo cambio a algo más suave.',
      actions: changes?.map(({ action, ...c }) => ({ type: TYPES[action], ...c })),
    } satisfies ChatReply)

  it('envía el historial y el mensaje; sin cambios si no los pide', async () => {
    const { deps, requests, rows } = chatDeps([reply()])
    const res = await chatReply(deps, {
      data: withPlan(),
      message: '¿Qué tal voy?',
      history: [
        { role: 'user', text: 'Hola' },
        { role: 'assistant', text: '¡Hola! ¿En qué te ayudo?' },
      ],
    })
    expect(res).toMatchObject({ ok: true, reply: 'Te lo cambio a algo más suave.', changes: [] })
    expect(requests[0]!.prompt).toContain('"message":"¿Qué tal voy?"')
    expect(requests[0]!.prompt).toContain('"conversation":[{"role":"user","text":"Hola"}')
    expect(rows[0]).toMatchObject({ kind: 'chat', status: 'ok' })
    // Lo guardado es lo que luego lee save_chat_turn (output.reply) y respond_ai_change.
    expect(rows[0]!.output).toMatchObject({ reply: 'Te lo cambio a algo más suave.', changes: [] })
  })

  it('cambio válido: llega como propuesta, sin aplicarse', async () => {
    const change: PlanChange = {
      action: 'move',
      planned_session_id: 'p-wed',
      date: '2026-10-01',
      title: 'Pasa la fuerza al jueves',
      reason: 'El miércoles no puedes',
    }
    const { deps, provider } = chatDeps([reply([change])])
    const res = await chatReply(deps, {
      data: withPlan(),
      message: 'El miércoles no puedo',
      history: [],
    })
    expect(res.ok && res.changes).toEqual([change])
    expect(provider.generateJson).toHaveBeenCalledTimes(1)
  })

  it('sesiones inexistentes, ya hechas o fechas al pasado: reintento y, si insiste, se quitan', async () => {
    const bad: PlanChange[] = [
      { action: 'skip', planned_session_id: 'no-existe', title: 'x', reason: 'x' },
      { action: 'skip', planned_session_id: 'p-mon', title: 'ya hecha', reason: 'x' },
      {
        action: 'move',
        planned_session_id: 'p-fri',
        date: '2026-09-20',
        title: 'al pasado',
        reason: 'x',
      },
    ]
    const { deps, requests } = chatDeps([reply(bad), reply(bad)])
    const res = await chatReply(deps, { data: withPlan(), message: 'cambia cosas', history: [] })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('«no-existe» no es una sesión pendiente')
    expect(requests[1]!.prompt).toContain('«p-mon» no es una sesión pendiente')
    expect(requests[1]!.prompt).toContain('2026-09-20 está fuera de rango')
    expect(res).toMatchObject({ ok: true, changes: [] })
  })

  it('más allá de 2 semanas o con ejercicios inventados: se quitan; lo válido se queda', async () => {
    const bad: PlanChange[] = [
      {
        action: 'move',
        planned_session_id: 'p-far',
        date: '2026-10-25',
        title: 'lejos',
        reason: 'x',
      },
      {
        action: 'modify',
        planned_session_id: 'p-wed',
        title: 'Inventado',
        reason: 'x',
        session: {
          ...session,
          blocks: [
            {
              block_type: 'straight',
              exercises: [{ exercise_id: 'sentadilla_cuantica', sets: 3, reps: '8' }],
            },
          ],
        },
      },
      {
        action: 'add',
        date: '2026-10-03',
        title: 'Rodaje extra',
        reason: 'Vas bien',
        session: { ...session, session_type: 'running' },
      },
    ]
    const { deps, requests } = chatDeps([reply(bad), reply(bad)])
    const res = await chatReply(deps, { data: withPlan(), message: 'cambia cosas', history: [] })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('p-far')
    expect(requests[1]!.prompt).toContain('sentadilla_cuantica')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changes.map((c) => c.title)).toEqual(['Rodaje extra'])
    expect(res.dropped).toEqual(['sentadilla_cuantica'])
  })

  it('si el reintento falla por cuota, vale la primera respuesta sin lo inválido', async () => {
    const bad: PlanChange[] = [
      { action: 'skip', planned_session_id: 'no-existe', title: 'x', reason: 'x' },
      { action: 'skip', planned_session_id: 'p-wed', title: 'Descansa', reason: 'x' },
    ]
    const { deps, rows } = chatDeps([reply(bad), new AiProviderError('quota', 'Gemini 429', 429)])
    const res = await chatReply(deps, { data: withPlan(), message: 'x', history: [] })
    expect(res.ok && res.changes.map((c) => c.planned_session_id)).toEqual(['p-wed'])
    expect(rows[0]!.status).toBe('ok')
  })

  it('dos cambios para la misma sesión: se queda el primero', async () => {
    const twice: PlanChange[] = [
      { action: 'skip', planned_session_id: 'p-wed', title: 'Descansa', reason: 'x' },
      {
        action: 'move',
        planned_session_id: 'p-wed',
        date: '2026-10-01',
        title: 'Muévela',
        reason: 'x',
      },
    ]
    const { deps } = chatDeps([reply(twice), reply(twice)])
    const res = await chatReply(deps, { data: withPlan(), message: 'x', history: [] })
    expect(res.ok && res.changes.map((c) => c.action)).toEqual(['skip'])
  })

  it('sin plan activo no hay cambios, aunque la IA los mande', async () => {
    const change: PlanChange = {
      action: 'add',
      date: '2026-10-01',
      title: 'Añade fuerza',
      reason: 'x',
      session: { ...session, session_type: 'strength' },
    }
    const { deps } = chatDeps([reply([change]), reply([change])])
    const res = await chatReply(deps, { data: sampleContextInput(), message: 'x', history: [] })
    expect(res).toMatchObject({ ok: true, changes: [] })
  })

  it('formato incorrecto (move sin fecha) → reintento con el error', async () => {
    const noDate = JSON.stringify({
      reply: 'ok',
      actions: [{ type: 'move_session', planned_session_id: 'p-wed', title: 'x', reason: 'x' }],
    })
    const { deps, requests } = chatDeps([noDate, reply()])
    const res = await chatReply(deps, { data: withPlan(), message: 'x', history: [] })
    expect(res.ok).toBe(true)
    expect(requests[1]!.prompt).toContain('con move_session hay que indicar date')
  })
})

// ── Sustituir ejercicio ────────────────────────────────────

describe('sustituir ejercicio con IA: solo ids existentes', () => {
  // Sin alternativa por reglas: nada comparte el músculo principal del press banca (pecho).
  const data = () => sampleContextInput()

  function swapDeps(responses: (string | Error)[]) {
    const { provider, requests } = mockProvider(responses)
    const usage = memoryUsage(20)
    return {
      deps: { provider, usage: usage.store, dailyLimit: 20 },
      provider,
      requests,
      rows: usage.rows,
    }
  }

  it('si las reglas encuentran alternativa no se llama a la IA', async () => {
    const { deps, provider, rows } = swapDeps([])
    // Sentadilla goblet comparte cuádriceps con la sentadilla con barra.
    const res = await proposeSwap(deps, { data: data(), exerciseId: 'back_squat' })
    expect(res).toMatchObject({ ok: false, code: 'rules_available' })
    expect(provider.generateJson).not.toHaveBeenCalled()
    expect(rows).toHaveLength(0)
  })

  it('devuelve alternativas existentes con el motivo', async () => {
    const { deps, requests, rows } = swapDeps([
      JSON.stringify({
        alternatives: [{ exercise_id: 'goblet_squat', reason: 'Tienes mancuernas' }],
      }),
    ])
    const res = await proposeSwap(deps, { data: data(), exerciseId: 'bench_press' })
    expect(res).toMatchObject({
      ok: true,
      proposal: {
        exerciseId: 'bench_press',
        alternatives: [{ exercise_id: 'goblet_squat', reason: 'Tienes mancuernas' }],
      },
    })
    expect(requests[0]!.prompt).toContain('"exercise_id":"bench_press"')
    expect(requests[0]!.prompt).toContain('goblet_squat | Sentadilla goblet')
    expect(rows[0]).toMatchObject({ kind: 'exercise_swap', status: 'ok' })
  })

  it('ids inventados o el mismo ejercicio: reintento y, si insiste, se quitan', async () => {
    const bad = JSON.stringify({
      alternatives: [
        { exercise_id: 'press_inventado', reason: 'x' },
        { exercise_id: 'bench_press', reason: 'el mismo' },
        { exercise_id: 'back_squat', reason: 'existe' },
      ],
    })
    const { deps, requests } = swapDeps([bad, bad])
    const res = await proposeSwap(deps, { data: data(), exerciseId: 'bench_press' })
    expect(requests[1]!.prompt).toContain('press_inventado')
    expect(requests[1]!.prompt).toContain('No propongas el mismo ejercicio')
    expect(res.ok && res.proposal.alternatives.map((a) => a.exercise_id)).toEqual(['back_squat'])
  })

  it('si ninguna existe → salida no válida', async () => {
    const bad = JSON.stringify({ alternatives: [{ exercise_id: 'press_inventado', reason: 'x' }] })
    const { deps, rows } = swapDeps([bad, bad])
    const res = await proposeSwap(deps, { data: data(), exerciseId: 'bench_press' })
    expect(res).toMatchObject({ ok: false, code: 'invalid_output' })
    expect(rows[0]!.status).toBe('invalid')
  })

  it('ejercicio desconocido → error sin llamar a la IA', async () => {
    const { deps, provider } = swapDeps([])
    const res = await proposeSwap(deps, { data: data(), exerciseId: 'nada' })
    expect(res.ok).toBe(false)
    expect(provider.generateJson).not.toHaveBeenCalled()
  })
})
