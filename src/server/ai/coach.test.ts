// Entrenador IA con el proveedor simulado (nunca se llama a la API real): reintento, descarte de
// ejercicios inventados, límite diario, errores del proveedor y adaptadores.
import { describe, expect, it, vi } from 'vitest'
import { sampleContextInput, samplePlan, sampleReduce } from '@/lib/ai/test-fixtures'
import type { ContextPlanned } from '@/lib/ai/context'
import { toPlanStructure } from '@/lib/ai/schemas'
import {
  proposeDailyAdjust,
  proposePlan,
  pendingToday,
  sessionsPerWeekFor,
  type CoachDeps,
} from './coach'
import { DEFAULT_DAILY_LIMIT, DEFAULT_MODELS, getAiConfig } from './config'
import { createAnthropicProvider } from './providers/anthropic'
import { createGeminiProvider } from './providers/gemini'
import { AiProviderError, type AiProvider, type JsonRequest } from './providers/types'
import { extractJson } from './structured'
import { DailyLimitError, type UsageStore } from './usage'

// Proveedor simulado: devuelve las respuestas en orden y guarda las peticiones.
function mockProvider(responses: (string | Error)[]) {
  const requests: JsonRequest[] = []
  const provider: AiProvider = {
    name: 'mock',
    model: 'mock-1',
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = responses.shift()
      if (next === undefined) throw new Error('sin más respuestas')
      if (next instanceof Error) throw next
      return { text: next, tokensIn: 100, tokensOut: 50 }
    }),
  }
  return { provider, requests }
}

// Registro en memoria con el mismo límite diario que la RPC.
function memoryUsage(limit: number) {
  const rows: { id: string; kind: string; status: string; output?: unknown; tokensIn?: number }[] =
    []
  const store: UsageStore = {
    async begin(kind) {
      const used = rows.filter((r) => r.status !== 'error').length
      if (used >= limit) throw new DailyLimitError()
      const id = `ai-${rows.length + 1}`
      rows.push({ id, kind, status: 'pending' })
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
  return { store, rows }
}

function deps(responses: (string | Error)[], limit = 20) {
  const { provider, requests } = mockProvider(responses)
  const usage = memoryUsage(limit)
  const d: CoachDeps = { provider, usage: usage.store, dailyLimit: limit }
  return { deps: d, requests, rows: usage.rows, provider }
}

const today: ContextPlanned = {
  id: 'p-today',
  date: '2026-09-29',
  week: 2,
  sessionType: 'strength',
  title: 'Pierna pesada',
  intensity: 'hard',
  heavyLegs: true,
  durationMin: 60,
  notes: null,
  status: 'planned',
  blocks: [
    { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 5, reps: '5' }] },
  ],
}

describe('generar plan', () => {
  it('devuelve la propuesta, la registra y descuenta del límite', async () => {
    const { deps: d, rows, requests } = deps([JSON.stringify(samplePlan())])
    const res = await proposePlan(d, { data: sampleContextInput(), base: null })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.structure.weeks).toHaveLength(4)
    expect(res.proposal.dropped).toEqual([])
    expect(res.remaining).toBe(19)
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'plan_generation', status: 'ok', tokensIn: 100 }),
    ])
    // System prompt según §11 y datos del usuario en el mensaje.
    expect(requests[0]!.system).toContain('español')
    expect(requests[0]!.system).toContain('profesional')
    expect(requests[0]!.prompt).toContain('"limitations":"Molestia leve en la rodilla derecha"')
    expect(requests[0]!.prompt).toContain('back_squat | Sentadilla con barra')
    expect(requests[0]!.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false })
  })

  it('reintenta una vez con los errores si la salida no valida', async () => {
    const bad = samplePlan()
    bad.weeks[3]!.deload = false
    const { deps: d, requests } = deps([
      JSON.stringify(bad),
      '```json\n' + JSON.stringify(samplePlan()) + '\n```',
    ])
    const res = await proposePlan(d, { data: sampleContextInput(), base: null })
    expect(res.ok).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('no era válida')
    expect(requests[1]!.prompt).toContain('descarga')
  })

  it('si inventa un ejercicio reintenta y, si insiste, lo descarta', async () => {
    const invented = JSON.stringify(samplePlan('sentadilla_cuantica'))
    const { deps: d, requests } = deps([invented, invented])
    const res = await proposePlan(d, { data: sampleContextInput(), base: null })
    expect(requests[1]!.prompt).toContain('sentadilla_cuantica')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.dropped).toEqual(['sentadilla_cuantica'])
    const ids = res.proposal.structure.weeks.flatMap((w) =>
      w.sessions.flatMap((s) => s.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id))),
    )
    expect(ids).not.toContain('sentadilla_cuantica')
  })

  it('dos respuestas que no son JSON → salida no válida, registrada como «invalid»', async () => {
    const { deps: d, rows } = deps(['hola', 'sigo sin JSON'])
    const res = await proposePlan(d, { data: sampleContextInput(), base: null })
    expect(res).toMatchObject({ ok: false, code: 'invalid_output' })
    expect(rows[0]!.status).toBe('invalid')
  })

  it('parte de la plantilla base y recupera sus estándares', async () => {
    const base = toPlanStructure(samplePlan())
    base.weeks[0]!.sessions[0]!.blocks[1]!.exercises[0]!.standard = { men: '60 kg', women: '40 kg' }
    const { deps: d, requests } = deps([JSON.stringify(samplePlan())])
    const res = await proposePlan(d, {
      data: sampleContextInput(),
      base: { id: 'strength_beginner', name: 'Fuerza principiante', structure: base },
    })
    expect(requests[0]!.prompt).toContain('Parte de la plantilla base')
    expect(requests[0]!.prompt).toContain('"base_template":{"id":"strength_beginner"')
    expect(res.ok && res.proposal.baseTemplateId).toBe('strength_beginner')
    expect(
      res.ok && res.proposal.structure.weeks[1]!.sessions[0]!.blocks[1]!.exercises[0]!.standard,
    ).toEqual({
      men: '60 kg',
      women: '40 kg',
    })
  })

  it('sesiones por semana: las del usuario, sin pasar de las de la plantilla', () => {
    const data = sampleContextInput()
    const base = { id: 'x', name: 'x', structure: toPlanStructure(samplePlan()) }
    expect(sessionsPerWeekFor(data, null)).toBe(3)
    expect(sessionsPerWeekFor(data, base)).toBe(3)
    data.training!.availability.days_per_week = 5
    expect(sessionsPerWeekFor(data, base)).toBe(3)
  })
})

describe('límite diario', () => {
  it('al llegar al límite no llama al proveedor', async () => {
    const { deps: d, provider } = deps(
      [JSON.stringify(sampleReduce()), JSON.stringify(sampleReduce())],
      1,
    )
    const first = await proposeDailyAdjust(d, { data: sampleContextInput(), today })
    expect(first).toMatchObject({ ok: true, remaining: 0 })
    const second = await proposeDailyAdjust(d, { data: sampleContextInput(), today })
    expect(second).toMatchObject({ ok: false, code: 'daily_limit' })
    expect(second.ok === false && second.message).toContain('límite')
    expect(provider.generateJson).toHaveBeenCalledTimes(1)
  })

  it('los fallos del proveedor no cuentan', async () => {
    const quota = new AiProviderError('quota', 'Gemini 429', 429)
    const { deps: d, rows } = deps([quota, JSON.stringify(sampleReduce())], 1)
    const res = await proposeDailyAdjust(d, { data: sampleContextInput(), today })
    expect(res).toMatchObject({ ok: false, code: 'provider_quota' })
    expect(res.ok === false && res.message).toContain('cuota')
    expect(rows[0]!.status).toBe('error')
    expect(await proposeDailyAdjust(d, { data: sampleContextInput(), today })).toMatchObject({
      ok: true,
    })
  })

  it('traduce los errores del proveedor a mensajes en español', async () => {
    const cases: [AiProviderError, string][] = [
      [new AiProviderError('auth', 'x', 401), 'provider_auth'],
      [new AiProviderError('unavailable', 'x', 503), 'provider_unavailable'],
      [new AiProviderError('bad_request', 'x', 400), 'provider_unavailable'],
      [new AiProviderError('blocked', 'x'), 'invalid_output'],
    ]
    for (const [error, code] of cases) {
      const { deps: d } = deps([error])
      expect(await proposeDailyAdjust(d, { data: sampleContextInput(), today })).toMatchObject({
        ok: false,
        code,
      })
    }
  })
})

describe('ajuste del día', () => {
  it('con energía 1 y agujetas 5 propone reducir (y lo envía todo al proveedor)', async () => {
    const { deps: d, requests } = deps([JSON.stringify(sampleReduce())])
    const res = await proposeDailyAdjust(d, { data: sampleContextInput(), today })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.proposal.plannedSessionId).toBe('p-today')
    expect(res.proposal.adjust.decision).toBe('reduce')
    expect(res.proposal.adjust.session?.blocks[0]!.exercises[0]!.exercise_id).toBe('goblet_squat')
    expect(requests[0]!.prompt).toContain(
      '"today_checkin":{"date":"2026-09-29","sleep":3,"energy":1,"soreness":5',
    )
    expect(requests[0]!.prompt).toContain('"today_session":{"date":"2026-09-29"')
  })

  it('keep y rest no llevan sesión', async () => {
    const withSession = { ...sampleReduce(), decision: 'rest' }
    const { deps: d } = deps([JSON.stringify(withSession)])
    const res = await proposeDailyAdjust(d, { data: sampleContextInput(), today })
    expect(res.ok && res.proposal.adjust).toEqual({
      decision: 'rest',
      reason: sampleReduce().reason,
    })
  })

  it('sin sesión pendiente hoy no se consulta a la IA', async () => {
    const { deps: d, provider } = deps([])
    expect(await proposeDailyAdjust(d, { data: sampleContextInput(), today: null })).toMatchObject({
      ok: false,
      code: 'no_planned_session',
    })
    expect(provider.generateJson).not.toHaveBeenCalled()
    expect(pendingToday([today, { ...today, id: 'b', status: 'done' }], '2026-09-29')?.id).toBe(
      'p-today',
    )
    expect(pendingToday([{ ...today, status: 'skipped' }], '2026-09-29')).toBeNull()
  })
})

describe('configuración', () => {
  it('gemini por defecto; sin clave la IA queda desactivada', () => {
    const c = getAiConfig({})
    expect(c).toMatchObject({
      provider: 'gemini',
      configured: false,
      dailyLimit: DEFAULT_DAILY_LIMIT,
    })
    expect(c.model).toBe(DEFAULT_MODELS.gemini)
    expect(c.problem).toContain('GEMINI_API_KEY')
  })

  it('lee proveedor, clave, modelo y límite', () => {
    expect(
      getAiConfig({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: ' "k" ',
        GEMINI_MODEL: 'gemini-x',
        AI_DAILY_LIMIT: '5',
      }),
    ).toMatchObject({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-x',
      dailyLimit: 5,
      configured: true,
    })
    expect(getAiConfig({ AI_PROVIDER: 'Anthropic', ANTHROPIC_API_KEY: 'a' })).toMatchObject({
      provider: 'anthropic',
      model: DEFAULT_MODELS.anthropic,
      configured: true,
    })
    // Con anthropic, la clave de Gemini no sirve.
    expect(getAiConfig({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g' }).configured).toBe(false)
    expect(getAiConfig({ AI_PROVIDER: 'openai', GEMINI_API_KEY: 'g' }).configured).toBe(false)
    expect(getAiConfig({ GEMINI_API_KEY: 'g', AI_DAILY_LIMIT: 'mucho' }).dailyLimit).toBe(
      DEFAULT_DAILY_LIMIT,
    )
  })
})

describe('adaptadores (fetch/cliente simulados)', () => {
  const request: JsonRequest = {
    system: 'sys',
    prompt: 'hola',
    jsonSchema: { type: 'object' },
    maxOutputTokens: 100,
    timeoutMs: 1000,
  }

  it('Gemini: petición con clave en cabecera y esquema JSON; lee texto y tokens', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 },
      }),
    )
    const p = createGeminiProvider({
      apiKey: 'KEY',
      model: 'gemini-2.5-flash',
      fetch: fetchMock as typeof fetch,
    })
    expect(await p.generateJson(request)).toEqual({
      text: '{"a":1}',
      tokensIn: 10,
      tokensOut: 7,
      model: 'gemini-2.5-flash',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/models/gemini-2.5-flash:generateContent')
    expect(url).not.toContain('KEY')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY')
    const body = JSON.parse(init.body as string)
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
    })
    expect(body.systemInstruction.parts[0].text).toBe('sys')
  })

  it('Gemini: 429 → cuota, clave mala → auth, corte → truncated', async () => {
    const make = (res: Response) =>
      createGeminiProvider({ apiKey: 'k', model: 'm', fetch: (async () => res) as typeof fetch })
    await expect(
      make(
        Response.json({ error: { message: 'Resource exhausted' } }, { status: 429 }),
      ).generateJson(request),
    ).rejects.toMatchObject({ kind: 'quota' })
    await expect(
      make(
        Response.json({ error: { message: 'API key not valid' } }, { status: 400 }),
      ).generateJson(request),
    ).rejects.toMatchObject({ kind: 'auth' })
    await expect(
      make(
        Response.json({
          candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'MAX_TOKENS' }],
        }),
      ).generateJson(request),
    ).rejects.toMatchObject({ kind: 'truncated' })
    const offline = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    await expect(offline.generateJson(request)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('Anthropic: salida estructurada con output_config y lectura del texto', async () => {
    const create = vi.fn(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"a":1}' }],
      usage: { input_tokens: 12, output_tokens: 3 },
    }))
    const p = createAnthropicProvider({
      apiKey: 'k',
      model: 'claude-sonnet-5',
      client: { messages: { create } } as never,
    })
    expect(await p.generateJson(request)).toEqual({
      text: '{"a":1}',
      tokensIn: 12,
      tokensOut: 3,
      model: 'claude-sonnet-5',
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
        system: 'sys',
        output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
      }),
      { timeout: 1000 },
    )
  })

  it('Anthropic: rechazo → blocked', async () => {
    const p = createAnthropicProvider({
      apiKey: 'k',
      model: 'm',
      client: {
        messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: {} }) },
      } as never,
    })
    await expect(p.generateJson(request)).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('extractJson acepta JSON con o sin ```', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => extractJson('nope')).toThrow()
  })
})

describe('sesión de hoy pedida', () => {
  it('elige la indicada si está pendiente hoy', () => {
    const other = { ...today, id: 'p-2' }
    expect(pendingToday([today, other], '2026-09-29', 'p-2')?.id).toBe('p-2')
    expect(pendingToday([today, other], '2026-09-30', 'p-2')).toBeNull()
  })
})
