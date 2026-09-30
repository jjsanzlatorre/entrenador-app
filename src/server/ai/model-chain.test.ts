// Cadena de modelos con presupuesto de tiempo (providers/chain.ts) con proveedores simulados
// (nunca se llama a la API real). Reproduce el fallo real: peticiones de varios días que van al
// modelo pesado (GEMINI_MODEL_HEAVY, 5 RPM / 20 RPD en el plan gratuito) y acababan siempre en
// «La IA no responde ahora mismo»:
// - 429 en el pesado → responde el normal.
// - Tiempo agotado en el pesado → responde el normal dentro del presupuesto (≤ 50 s en total).
// - Cuota diaria del pesado agotada → los mensajes siguientes van directos al normal.
// - Todos fallan → mensaje según la causa (cuota de hoy, tiempo, proveedor).
// - El pesado, como mucho una vez por mensaje: el reintento texto ↔ tarjetas va al normal.
// - «Crear plan» y la revisión semanal usan la misma cadena.
import { describe, expect, it, vi } from 'vitest'
import type { AiContextInput, ContextPlanned } from '@/lib/ai/context'
import { modelLogLines } from '@/lib/ai/chat-text'
import {
  AI_ERROR_MESSAGES,
  QUOTA_MINUTE_MESSAGE,
  type ChatAction,
  type ChatRangeDay,
  type ChatReply,
  type ModelAttempt,
  type QuotaScope,
  type WeeklyReviewAi,
} from '@/lib/ai/schemas'
import { sampleContextInput, samplePlan } from '@/lib/ai/test-fixtures'
import { chatReply, proposePlan, weeklyReview, type ReviewStore } from './coach'
import { AI_TIMEOUTS, getAiConfig, PLAN_TIMEOUTS } from './config'
import { createProvider } from './providers'
import {
  blockUntil,
  createModelChain,
  nextQuotaReset,
  type ChainStep,
  type ModelBlockStore,
} from './providers/chain'
import { createGeminiProvider, quotaScopeOf } from './providers/gemini'
import { AiProviderError, type AiProvider, type JsonRequest } from './providers/types'
import type { UsageStore } from './usage'

// ── Simuladores ────────────────────────────────────────────

// Reloj simulado: las llamadas «tardan» lo que dice cada respuesta sin esperar de verdad.
function fakeClock(start = Date.parse('2026-09-30T10:00:00Z')) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

type Step =
  | string
  | { quota: QuotaScope | null; ms?: number }
  | { timeout: true }
  | { error: 'unavailable' | 'auth'; status?: number }
  | { ok: string; ms: number }

function model(name: string, steps: Step[], clock: ReturnType<typeof fakeClock>) {
  const requests: JsonRequest[] = []
  const provider: AiProvider = {
    name: 'gemini',
    model: name,
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = steps.shift()
      if (next === undefined) throw new Error(`${name}: sin más respuestas`)
      if (typeof next === 'string') {
        clock.advance(1000)
        return { text: next, tokensIn: 100, tokensOut: 50, model: name }
      }
      if ('ok' in next) {
        clock.advance(next.ms)
        return { text: next.ok, tokensIn: 100, tokensOut: 50, model: name }
      }
      if ('timeout' in next) {
        // Agota su tiempo máximo (el que le da la cadena).
        clock.advance(req.timeoutMs)
        throw new AiProviderError('timeout', `${name} no ha respondido en ${req.timeoutMs} ms`)
      }
      if ('quota' in next) {
        clock.advance(next.ms ?? 300)
        const err = new AiProviderError('quota', `Gemini 429: quota (${next.quota})`, 429)
        err.scope = next.quota
        throw err
      }
      clock.advance(500)
      throw new AiProviderError(
        next.error,
        `Gemini ${next.status ?? 503}: error`,
        next.status ?? 503,
      )
    }),
  }
  return { provider, requests }
}

// Registro de bloqueos en memoria (como 0035: compartido entre consultas).
function memoryBlocks(clock: ReturnType<typeof fakeClock>) {
  const rows = new Map<string, { until: string; scope: QuotaScope | null }>()
  const store: ModelBlockStore = {
    async blocked(models) {
      return new Map(
        models.flatMap((m) => {
          const b = rows.get(m)
          return b && Date.parse(b.until) > clock.now() ? [[m, b] as const] : []
        }),
      )
    },
    async block(m, until, scope) {
      rows.set(m, { until: until.toISOString(), scope })
    },
  }
  return { store, rows }
}

function memoryUsage() {
  const rows: {
    id: string
    kind: string
    status: string
    period?: string
    output?: unknown
    model?: string
    error?: string
  }[] = []
  const store: UsageStore = {
    async begin(kind, _s, period) {
      const id = `ai-${rows.length + 1}`
      rows.push({ id, kind, status: 'pending', period })
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
  const reviews: ReviewStore = { latest: async () => null }
  return { store, rows, reviews }
}

// Cadena como en producción: pesado 20 s → normal 15 s → reserva 15 s, 50 s en total.
function chain(
  models: { heavy?: AiProvider; light: AiProvider; fallback?: AiProvider },
  clock: ReturnType<typeof fakeClock>,
  blocks: ModelBlockStore | null = null,
  t = AI_TIMEOUTS,
) {
  const steps: ChainStep[] = [
    ...(models.heavy
      ? [{ role: 'heavy' as const, provider: models.heavy, timeoutMs: t.heavyMs }]
      : []),
    { role: 'light', provider: models.light, timeoutMs: t.lightMs },
    ...(models.fallback
      ? [{ role: 'fallback' as const, provider: models.fallback, timeoutMs: t.lightMs }]
      : []),
  ]
  return createModelChain({ steps, blocks, budgetMs: t.budgetMs, now: clock.now })
}

// ── Datos: «de hoy al domingo» con un plan de fuerza desde el lunes ─────

const strength = (id: string, date: string): ContextPlanned => ({
  id,
  date,
  week: 1,
  sessionType: 'strength',
  title: `Fuerza ${id}`,
  intensity: 'moderate',
  heavyLegs: false,
  durationMin: 60,
  notes: null,
  status: 'planned',
  blocks: [
    { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8' }] },
  ],
})

function data(): AiContextInput {
  const base = sampleContextInput()
  return sampleContextInput({
    today: '2026-09-30',
    exercises: [
      ...base.exercises,
      { id: 'yoga', name: 'Yoga', category: 'mobility', equipment: [], muscles: [] },
    ],
    plan: {
      name: 'Fuerza',
      startDate: '2026-10-05',
      sessions: [strength('mon', '2026-10-05'), strength('wed', '2026-10-07')],
    },
  })
}

const yogaDay = (date: string): ChatRangeDay => ({
  date,
  session: {
    session_type: 'yoga',
    title: 'Yoga suave',
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 30,
    blocks: [{ block_type: 'free', exercises: [{ exercise_id: 'yoga', duration_s: 1800 }] }],
  },
})

const range: ChatAction = {
  type: 'add_sessions_range',
  title: 'Recuperación hasta el domingo',
  reason: 'Bajar las agujetas antes del plan',
  days: ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(yogaDay),
}

const reply = (text: string, actions?: ChatAction[]) =>
  JSON.stringify({ reply: text, actions } satisfies ChatReply)

const GOOD = reply('Te propongo cinco días suaves hasta el domingo.', [range])
const MESSAGE = 'Crea un plan de hoy al domingo para recuperarme y el lunes empezar el de fuerza'

async function ask(provider: AiProvider, usage = memoryUsage()) {
  const res = await chatReply(
    { provider, usage: usage.store, dailyLimit: 20 },
    { data: data(), message: MESSAGE, history: [], tier: 'heavy' },
  )
  return { res, usage }
}

const outcomes = (attempts: ModelAttempt[]) => attempts.map((a) => `${a.model}:${a.outcome}`)

// ── Chat con varios días ───────────────────────────────────

describe('chat pesado: cadena de reserva', () => {
  it('429 en el pesado → responde el normal y queda registrado por qué', async () => {
    const clock = fakeClock()
    const heavy = model('flash-heavy', [{ quota: 'daily' }], clock)
    const light = model('flash-lite', [GOOD], clock)
    const provider = chain({ heavy: heavy.provider, light: light.provider }, clock)
    const { res, usage } = await ask(provider)

    expect(res.ok).toBe(true)
    expect(res.ok && res.ranges).toHaveLength(1)
    expect(heavy.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(light.provider.generateJson).toHaveBeenCalledTimes(1)
    // ai_interactions: modelo que respondió y el intento fallido con su motivo.
    const row = usage.rows[0]!
    expect(row).toMatchObject({ status: 'ok', model: 'flash-lite' })
    const log = (row.output as { model_log: ModelAttempt[] }).model_log
    expect(log).toEqual([
      expect.objectContaining({
        model: 'flash-heavy',
        role: 'heavy',
        outcome: 'quota',
        status: 429,
        scope: 'daily',
      }),
      expect.objectContaining({ model: 'flash-lite', role: 'light', outcome: 'ok' }),
    ])
    // Y en el modo depuración de la respuesta.
    expect(res.ok && res.debug?.models?.map((m) => m.outcome)).toEqual(['quota', 'ok'])
  })

  it('tiempo agotado en el pesado → responde el normal dentro del presupuesto', async () => {
    const clock = fakeClock()
    const start = clock.now()
    const heavy = model('flash-heavy', [{ timeout: true }], clock)
    const light = model('flash-lite', [{ ok: GOOD, ms: 8000 }], clock)
    const provider = chain({ heavy: heavy.provider, light: light.provider }, clock)
    const { res, usage } = await ask(provider)

    expect(res.ok).toBe(true)
    expect(heavy.requests[0]!.timeoutMs).toBe(20_000)
    expect(light.requests[0]!.timeoutMs).toBe(15_000)
    expect(clock.now() - start).toBeLessThanOrEqual(50_000)
    expect(usage.rows[0]).toMatchObject({ status: 'ok', model: 'flash-lite' })
    expect(outcomes(provider.attempts)).toEqual(['flash-heavy:timeout', 'flash-lite:ok'])
  })

  it('el presupuesto nunca pasa de 50 s aunque todo tarde (y el reintento no empieza sin tiempo)', async () => {
    const clock = fakeClock()
    const start = clock.now()
    const heavy = model('flash-heavy', [{ timeout: true }], clock)
    const light = model('flash-lite', [{ timeout: true }], clock)
    const fallback = model('flash-old', [{ timeout: true }], clock)
    const provider = chain(
      { heavy: heavy.provider, light: light.provider, fallback: fallback.provider },
      clock,
    )
    const { res } = await ask(provider)

    expect(res).toMatchObject({
      ok: false,
      code: 'provider_timeout',
      message: 'Ha tardado demasiado; prueba con una petición más corta.',
    })
    // 20 + 15 + 15 = 50 s; ninguna llamada más.
    expect(clock.now() - start).toBe(50_000)
    const total = [heavy, light, fallback].reduce((s, m) => s + m.requests[0]!.timeoutMs, 0)
    expect(total).toBeLessThanOrEqual(50_000)
    // Detalle técnico para ?debug=1: modelo, código y tiempos.
    expect(!res.ok && res.debug?.models.map((m) => m.outcome)).toEqual([
      'timeout',
      'timeout',
      'timeout',
    ])
    expect(!res.ok && modelLogLines(res.debug?.models)[0]).toMatch(
      /^flash-heavy \(pesado\): timeout · 20,0 s \/ 20,0 s/,
    )
  })

  it('cada llamada recibe como mucho el tiempo que queda', async () => {
    const clock = fakeClock()
    const heavy = model('flash-heavy', [{ error: 'unavailable', status: 503 }], clock)
    const light = model('flash-lite', [GOOD], clock)
    const provider = createModelChain({
      steps: [
        { role: 'heavy', provider: heavy.provider, timeoutMs: 20_000 },
        { role: 'light', provider: light.provider, timeoutMs: 15_000 },
      ],
      budgetMs: 10_000,
      now: clock.now,
    })
    await ask(provider)
    expect(heavy.requests[0]!.timeoutMs).toBe(10_000)
    // El pesado tardó 0,5 s: quedan 9,5 s para el normal.
    expect(light.requests[0]!.timeoutMs).toBe(9_500)
  })

  it('cuota diaria del pesado agotada → los siguientes mensajes van directos al normal', async () => {
    const clock = fakeClock()
    const blocks = memoryBlocks(clock)
    const heavy = model('flash-heavy', [{ quota: 'daily' }], clock)
    const light = model('flash-lite', [GOOD, GOOD, GOOD], clock)

    const first = await ask(
      chain({ heavy: heavy.provider, light: light.provider }, clock, blocks.store),
    )
    expect(first.res.ok).toBe(true)
    // Bloqueado hasta la medianoche del Pacífico (1/10 00:00 PDT = 07:00 UTC).
    expect(blocks.rows.get('flash-heavy')).toEqual({
      until: '2026-10-01T07:00:00.000Z',
      scope: 'daily',
    })

    // Dos mensajes más (consultas nuevas, cadena nueva): el pesado ni se intenta.
    for (let i = 0; i < 2; i++) {
      clock.advance(60_000)
      const provider = chain({ heavy: heavy.provider, light: light.provider }, clock, blocks.store)
      const { res, usage } = await ask(provider)
      expect(res.ok).toBe(true)
      expect(usage.rows[0]).toMatchObject({ model: 'flash-lite' })
      expect(provider.attempts[0]).toMatchObject({
        model: 'flash-heavy',
        outcome: 'skipped',
        blocked_until: '2026-10-01T07:00:00.000Z',
      })
    }
    expect(heavy.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(light.provider.generateJson).toHaveBeenCalledTimes(3)

    // Al día siguiente vuelve a probar el pesado.
    clock.advance(24 * 3600_000)
    const next = model('flash-heavy', [GOOD], clock)
    const { usage } = await ask(
      chain({ heavy: next.provider, light: light.provider }, clock, blocks.store),
    )
    expect(usage.rows[0]).toMatchObject({ model: 'flash-heavy' })
  })

  it('un 429 por minuto solo bloquea unos segundos', async () => {
    const clock = fakeClock()
    const blocks = memoryBlocks(clock)
    const heavy = model('flash-heavy', [{ quota: 'minute' }], clock)
    const light = model('flash-lite', [GOOD], clock)
    await ask(chain({ heavy: heavy.provider, light: light.provider }, clock, blocks.store))
    const until = Date.parse(blocks.rows.get('flash-heavy')!.until)
    expect(until - clock.now()).toBeLessThanOrEqual(60_000)
    expect(blocks.rows.get('flash-heavy')!.scope).toBe('minute')
  })

  it('el pesado se usa una sola vez: el reintento texto ↔ tarjetas va al normal', async () => {
    const clock = fakeClock()
    // El pesado promete tarjetas sin mandar acciones → reintento.
    const heavy = model('flash-heavy', [reply('Pulsa «Añadir» en las tarjetas de abajo.')], clock)
    const light = model('flash-lite', [GOOD], clock)
    const provider = chain({ heavy: heavy.provider, light: light.provider }, clock)
    const { res } = await ask(provider)
    expect(res.ok && res.ranges).toHaveLength(1)
    expect(heavy.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(light.provider.generateJson).toHaveBeenCalledTimes(1)
    expect(outcomes(provider.attempts)).toEqual(['flash-heavy:ok', 'flash-lite:ok'])
  })

  it('una clave no válida no pasa al siguiente modelo', async () => {
    const clock = fakeClock()
    const heavy = model('flash-heavy', [{ error: 'auth', status: 401 }], clock)
    const light = model('flash-lite', [GOOD], clock)
    const { res } = await ask(chain({ heavy: heavy.provider, light: light.provider }, clock))
    expect(res).toMatchObject({ ok: false, code: 'provider_auth' })
    expect(light.provider.generateJson).not.toHaveBeenCalled()
  })
})

describe('chat pesado: todos fallan → mensaje según la causa', () => {
  const run = async (steps: [Step, Step, Step]) => {
    const clock = fakeClock()
    const [h, l, f] = steps.map((s, i) => model(`m${i}`, [s], clock))
    return (
      await ask(chain({ heavy: h!.provider, light: l!.provider, fallback: f!.provider }, clock))
    ).res
  }

  it('cuota de hoy agotada en todos', async () => {
    const res = await run([{ quota: 'daily' }, { quota: 'daily' }, { quota: 'daily' }])
    expect(res).toMatchObject({
      ok: false,
      code: 'provider_quota',
      message: 'La IA ha llegado a su límite de hoy; mañana vuelve a estar disponible.',
    })
  })

  it('cuota de hoy en el pesado y por minuto en los demás', async () => {
    const res = await run([{ quota: 'daily' }, { quota: 'minute' }, { quota: 'minute' }])
    expect(res).toMatchObject({ code: 'provider_quota', message: QUOTA_MINUTE_MESSAGE })
  })

  it('error del proveedor', async () => {
    const res = await run([
      { error: 'unavailable', status: 503 },
      { error: 'unavailable', status: 500 },
      { error: 'unavailable', status: 503 },
    ])
    expect(res).toMatchObject({
      code: 'provider_unavailable',
      message: 'La IA no está disponible ahora mismo; prueba en unos minutos.',
    })
  })

  it('cuota en el pesado y tiempo agotado después → tiempo', async () => {
    const res = await run([{ quota: 'daily' }, { timeout: true }, { timeout: true }])
    expect(res).toMatchObject({ code: 'provider_timeout' })
  })

  it('todos bloqueados de antes: ni se llama a la IA', async () => {
    const clock = fakeClock()
    const blocks = memoryBlocks(clock)
    const until = new Date(clock.now() + 3600_000)
    for (const m of ['m0', 'm1']) await blocks.store.block(m, until, 'daily', '429')
    const h = model('m0', [], clock)
    const l = model('m1', [], clock)
    const { res, usage } = await ask(
      chain({ heavy: h.provider, light: l.provider }, clock, blocks.store),
    )
    expect(res).toMatchObject({ code: 'provider_quota', message: AI_ERROR_MESSAGES.provider_quota })
    expect(h.provider.generateJson).not.toHaveBeenCalled()
    expect(l.provider.generateJson).not.toHaveBeenCalled()
    // Queda registrado (sin contar para el límite diario).
    expect(usage.rows[0]).toMatchObject({ status: 'error' })
  })
})

// ── Crear plan y revisión semanal ──────────────────────────

describe('crear plan y revisión semanal: misma cadena', () => {
  it('plan: 429 del pesado → lo genera el normal, con los tiempos del plan', async () => {
    const clock = fakeClock()
    const heavy = model('flash-heavy', [{ quota: 'daily' }], clock)
    const light = model('flash-lite', [JSON.stringify(samplePlan())], clock)
    const provider = chain(
      { heavy: heavy.provider, light: light.provider },
      clock,
      null,
      PLAN_TIMEOUTS,
    )
    const usage = memoryUsage()
    const res = await proposePlan(
      { provider, usage: usage.store, dailyLimit: 20 },
      { data: sampleContextInput(), base: null },
    )
    expect(res.ok).toBe(true)
    expect(heavy.requests[0]!.timeoutMs).toBe(30_000)
    expect(light.requests[0]!.timeoutMs).toBe(20_000)
    expect(usage.rows[0]).toMatchObject({
      kind: 'plan_generation',
      status: 'ok',
      model: 'flash-lite',
    })
  })

  it('revisión semanal: tiempo agotado en el pesado → la hace el normal', async () => {
    const clock = fakeClock()
    const review: WeeklyReviewAi = {
      headline: 'Buena semana',
      summary: 'Todo en orden.',
      recommendations: [
        { title: 'Uno', detail: 'Detalle uno.' },
        { title: 'Dos', detail: 'Detalle dos.' },
        { title: 'Tres', detail: 'Detalle tres.' },
      ],
      changes: [],
    }
    const heavy = model('flash-heavy', [{ timeout: true }], clock)
    const light = model('flash-lite', [JSON.stringify(review)], clock)
    const provider = chain({ heavy: heavy.provider, light: light.provider }, clock)
    const usage = memoryUsage()
    const res = await weeklyReview(
      { provider, usage: usage.store, dailyLimit: 20, reviews: usage.reviews },
      {
        today: '2026-09-29',
        generate: true,
        force: false,
        load: async () =>
          sampleContextInput({
            plan: {
              name: 'Plan',
              startDate: '2026-09-21',
              sessions: [{ ...strength('p1', '2026-09-22'), status: 'done' }],
            },
          }),
      },
    )
    expect(res.ok).toBe(true)
    expect(usage.rows[0]).toMatchObject({
      kind: 'weekly_review',
      status: 'ok',
      model: 'flash-lite',
    })
  })
})

// ── Configuración y piezas ─────────────────────────────────

describe('createProvider y cuota', () => {
  it('Gemini pesado: pesado → normal → reserva; ligero: normal → reserva', () => {
    const config = getAiConfig({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_MODEL_HEAVY: 'gemini-3.8-flash',
      GEMINI_FALLBACK_MODEL: 'gemini-2.5-flash',
    })
    const heavy = createProvider(config, 'heavy')!
    expect(heavy.model).toBe('gemini-3.8-flash')
    const light = createProvider(config, 'light')!
    expect(light.model).toBe('gemini-3.5-flash-lite')
  })

  it('Gemini de verdad: la llamada se corta por tiempo y pasa al siguiente', async () => {
    const hanging = (async (_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch
    const ok = (async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: GOOD }] }, finishReason: 'STOP' }],
      })) as unknown as typeof fetch
    const provider = createModelChain({
      steps: [
        {
          role: 'heavy',
          provider: createGeminiProvider({ apiKey: 'k', model: 'slow', fetch: hanging }),
          timeoutMs: 50,
        },
        {
          role: 'light',
          provider: createGeminiProvider({ apiKey: 'k', model: 'fast', fetch: ok }),
          timeoutMs: 1000,
        },
      ],
      budgetMs: 2000,
      minCallMs: 10,
    })
    const { res } = await ask(provider)
    expect(res.ok).toBe(true)
    expect(outcomes(provider.attempts)).toEqual(['slow:timeout', 'fast:ok'])
  })

  it('Gemini: 429 con QuotaFailure por día o por minuto', async () => {
    const perDay = {
      message: 'You exceeded your current quota',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
      ],
    }
    expect(quotaScopeOf(perDay)).toBe('daily')
    expect(
      quotaScopeOf({
        details: [
          { violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
        ],
      }),
    ).toBe('minute')
    expect(quotaScopeOf({ message: 'Resource exhausted' })).toBeNull()

    const p = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: (async () => Response.json({ error: perDay }, { status: 429 })) as typeof fetch,
    })
    const err = await p
      .generateJson({
        system: '',
        prompt: '',
        jsonSchema: {},
        maxOutputTokens: 10,
        timeoutMs: 1000,
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiProviderError)
    expect(err).toMatchObject({ kind: 'quota', scope: 'daily', retryAfterS: 37 })
  })

  it('la cuota diaria se renueva a medianoche del Pacífico (también con cambio de hora)', () => {
    expect(nextQuotaReset(new Date('2026-09-30T10:00:00Z')).toISOString()).toBe(
      '2026-10-01T07:00:00.000Z',
    )
    // 23:30 del 30/09 en California (06:30 UTC del 1/10) → medianoche del 1/10.
    expect(nextQuotaReset(new Date('2026-10-01T06:30:00Z')).toISOString()).toBe(
      '2026-10-01T07:00:00.000Z',
    )
    expect(nextQuotaReset(new Date('2026-12-01T10:00:00Z')).toISOString()).toBe(
      '2026-12-02T08:00:00.000Z',
    )
    // Fin del horario de verano (1/11/2026).
    expect(nextQuotaReset(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    )
    expect(nextQuotaReset(new Date('2026-11-01T12:00:00Z')).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    )
    const minute = new AiProviderError('quota', '429', 429)
    minute.scope = 'minute'
    minute.retryAfterS = 20
    const now = new Date('2026-09-30T10:00:00Z')
    expect(blockUntil(minute, now).getTime() - now.getTime()).toBe(20_000)
  })
})
