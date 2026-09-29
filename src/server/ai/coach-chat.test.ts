// Acciones del chat con el proveedor simulado (nunca se llama a la API real): create_plan con el
// mismo flujo que «Personalizar con IA», afirmaciones sin acción, acciones inválidas descartadas
// con aviso, adjust_today, tipos de actividad en el contexto y modelo por tipo de tarea.
import { describe, expect, it, vi } from 'vitest'
import type { ActivityType } from '@/lib/activities/catalog'
import { buildAiContext, type AiContextInput, type ContextPlanned } from '@/lib/ai/context'
import type { ChatAction, ChatReply, ChatResult } from '@/lib/ai/schemas'
import { sampleContextInput, samplePlan } from '@/lib/ai/test-fixtures'
import type { PlanStructure } from '@/lib/plan/types'
import { chatReply, proposeChatPlan, templateForChatRequest, type CoachDeps } from './coach'
import { describeAiEnv, getAiConfig, modelFor } from './config'
import { CHAT_PROMPT } from './prompts'
import { createProvider } from './providers'
import type { AiProvider, JsonRequest } from './providers/types'
import type { UsageStore } from './usage'

function mockProvider(responses: string[]) {
  const requests: JsonRequest[] = []
  const provider: AiProvider = {
    name: 'mock',
    model: 'mock-1',
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = responses.shift()
      if (next === undefined) throw new Error('sin más respuestas')
      return { text: next, tokensIn: 100, tokensOut: 50, model: 'mock-1' }
    }),
  }
  return { provider, requests }
}

function deps(responses: string[]) {
  const rows: { id: string; kind: string; status: string; output?: unknown }[] = []
  const usage: UsageStore = {
    async begin(kind) {
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
      return rows.length
    },
  }
  const { provider, requests } = mockProvider(responses)
  const d: CoachDeps = { provider, usage, dailyLimit: 20 }
  return { deps: d, rows, requests, provider }
}

const planned = (id: string, date: string): ContextPlanned => ({
  id,
  date,
  week: 1,
  sessionType: 'strength',
  title: `Sesión ${id}`,
  intensity: 'moderate',
  heavyLegs: false,
  durationMin: 60,
  notes: null,
  status: 'planned',
  blocks: [
    { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8' }] },
  ],
})

// Hoy martes 29/09/2026.
const TEMPLATES = [
  {
    id: 'strength_beginner',
    family: 'strength',
    level: 'beginner',
    name: 'Fuerza',
    daysPerWeek: 3,
  },
  {
    id: 'strength_intermediate',
    family: 'strength',
    level: 'intermediate',
    name: 'Torso/pierna',
    daysPerWeek: 4,
  },
  { id: 'running_beginner', family: 'running', level: 'beginner', name: 'Carrera', daysPerWeek: 3 },
]

function withPlan(overrides: Partial<AiContextInput> = {}) {
  return sampleContextInput({
    templates: TEMPLATES,
    plan: {
      name: 'Plan',
      startDate: '2026-09-28',
      sessions: [planned('p-today', '2026-09-29'), planned('p-thu', '2026-10-01')],
    },
    ...overrides,
  })
}

const reply = (text: string, actions?: ChatAction[]) =>
  JSON.stringify({ reply: text, actions } satisfies ChatReply)

const createPlan = (overrides: Partial<ChatAction> = {}): ChatAction => ({
  type: 'create_plan',
  title: 'Plan de fuerza 3 días',
  reason: 'Lo has pedido y encaja con tu nivel',
  plan: { family: 'strength', days_per_week: 3, focus: 'fuerza, 3 días' },
  ...overrides,
})

describe('chat: create_plan', () => {
  it('petición de plan → acción create_plan como propuesta (sin crear nada)', async () => {
    const {
      deps: d,
      rows,
      requests,
    } = deps([
      reply('Te propongo un plan de fuerza de 3 días. Pulsa «Crear plan» en la tarjeta.', [
        createPlan({
          plan: {
            family: 'strength',
            level: 'beginner',
            days_per_week: 3,
            template_id: 'strength_beginner',
            focus: 'fuerza',
          },
        }),
      ]),
    ])
    const res = await chatReply(d, {
      data: withPlan(),
      message: 'Créame un plan de 3 días de fuerza',
      history: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan_request).toEqual({
      family: 'strength',
      level: 'beginner',
      days_per_week: 3,
      template_id: 'strength_beginner',
      focus: 'fuerza',
      title: 'Plan de fuerza 3 días',
      reason: 'Lo has pedido y encaja con tu nivel',
    })
    expect(res.changes).toEqual([])
    // Se guarda en la consulta de chat (lo leen link_chat_plan / accept_chat_plan).
    expect((rows[0]!.output as ChatResult).plan_request?.family).toBe('strength')
    // El chat conoce las plantillas y la lista cerrada de acciones.
    expect(requests[0]!.prompt).toContain('strength_beginner | strength | beginner | 3')
    expect(requests[0]!.prompt).toContain('create_plan')
  })

  it('el plan se genera con el mismo flujo que «Personalizar con IA» (ids validados)', async () => {
    const structure = samplePlan() as unknown as PlanStructure
    const templates = [
      {
        id: 'strength_beginner',
        family: 'strength',
        level: 'beginner',
        name: 'Fuerza',
        days_per_week: 3,
        structure,
      },
    ]
    // La IA inventa un ejercicio dos veces: se reintenta y después se descarta (como en 6A).
    const invented = JSON.stringify(samplePlan('sentadilla_cuantica'))
    const mixed = samplePlan()
    mixed.weeks[0]!.sessions[0]!.blocks.push({
      block_type: 'straight',
      exercises: [{ exercise_id: 'sentadilla_cuantica', sets: 3, reps: '8' }],
    })
    const { deps: d, rows, requests } = deps([invented, JSON.stringify(mixed)])
    const res = await proposeChatPlan(d, {
      data: withPlan(),
      request: { family: 'strength', days_per_week: 3, focus: 'fuerza en casa' },
      templates,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(rows[0]!.kind).toBe('plan_generation')
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('sentadilla_cuantica')
    expect(requests[0]!.prompt).toContain('Pon 3 sesiones por semana')
    expect(requests[0]!.prompt).toContain('«fuerza en casa»')
    expect(requests[0]!.prompt).toContain('"base_template":{"id":"strength_beginner"')
    expect(res.proposal.baseTemplateId).toBe('strength_beginner')
    expect(res.proposal.dropped).toEqual(['sentadilla_cuantica'])
    expect(res.proposal.structure.weeks).toHaveLength(4)
  })

  it('elige la plantilla por familia, nivel y días', () => {
    const t = (id: string, family: string, level: string, days: number) => ({
      id,
      family,
      level,
      name: id,
      days_per_week: days,
      structure: { weeks: [], progression_rules: '' } as PlanStructure,
    })
    const list = [
      t('s_b3', 'strength', 'beginner', 3),
      t('s_i4', 'strength', 'intermediate', 4),
      t('h_i5', 'hybrid', 'intermediate', 5),
      t('h_i4', 'hybrid', 'intermediate', 4),
    ]
    expect(
      templateForChatRequest(list, { family: 'strength', days_per_week: 3 }, 'intermediate')?.id,
    ).toBe('s_i4')
    expect(
      templateForChatRequest(list, { family: 'strength', days_per_week: 3 }, 'beginner')?.id,
    ).toBe('s_b3')
    expect(
      templateForChatRequest(
        list,
        { family: 'strength', days_per_week: 3, level: 'beginner', template_id: 'h_i5' },
        null,
      )?.id,
    ).toBe('s_b3')
    expect(
      templateForChatRequest(list, { family: 'hybrid', days_per_week: 4 }, 'advanced')?.id,
    ).toBe('h_i4')
    expect(templateForChatRequest(list, { family: 'deka', days_per_week: 4 }, null)).toBeNull()
  })
})

describe('chat: afirmaciones sin acción y acciones inválidas', () => {
  it('la IA dice que ya lo ha creado sin acción → solo texto, sin cambios', async () => {
    const { deps: d, rows } = deps([
      reply('¡Hecho! Te he puesto el plan en tu calendario para el lunes.'),
    ])
    const res = await chatReply(d, {
      data: withPlan(),
      message: 'Créame un plan',
      history: [],
    })
    expect(res).toMatchObject({
      ok: true,
      reply: '¡Hecho! Te he puesto el plan en tu calendario para el lunes.',
      changes: [],
    })
    if (!res.ok) return
    expect(res.plan_request).toBeUndefined()
    expect(res.adjust_today).toBeUndefined()
    expect(res.discarded).toBeUndefined()
    expect(rows[0]!.output).toEqual({
      reply: '¡Hecho! Te he puesto el plan en tu calendario para el lunes.',
      changes: [],
      dropped: [],
    })
  })

  it('el prompt prohíbe afirmar cambios y escribir planes en el texto', () => {
    expect(CHAT_PROMPT).toContain('Nunca digas que has creado')
    expect(CHAT_PROMPT).toContain('Nunca escribas un plan completo')
    expect(CHAT_PROMPT).toContain('como mucho 5 frases')
    for (const tab of ['Hoy:', 'Entrenar:', 'Progreso:', 'Plan:', 'Perfil:']) {
      expect(CHAT_PROMPT).toContain(tab)
    }
  })

  it('acción inválida → reintento y, si insiste, se descarta con aviso', async () => {
    const bad: ChatAction[] = [
      {
        type: 'move_session',
        planned_session_id: 'no-existe',
        date: '2026-10-02',
        title: 'Mover la fuerza',
        reason: 'x',
      },
      {
        type: 'skip_session',
        planned_session_id: 'p-thu',
        title: 'Descansa el jueves',
        reason: 'Vas cargado',
      },
    ]
    const { deps: d, requests } = deps([reply('Te propongo esto.', bad), reply('Otra vez.', bad)])
    const res = await chatReply(d, { data: withPlan(), message: 'x', history: [] })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('«no-existe» no es una sesión pendiente')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changes.map((c) => [c.action, c.planned_session_id])).toEqual([['skip', 'p-thu']])
    expect(res.discarded).toEqual(['«Mover la fuerza»: esa sesión no está pendiente en tu plan.'])
  })

  it('sin plan activo: las acciones de sesiones se descartan con aviso', async () => {
    const add: ChatAction = {
      type: 'add_session',
      date: '2026-10-01',
      title: 'Añadir fuerza',
      reason: 'x',
      session: {
        session_type: 'strength',
        title: 'Fuerza',
        intensity: 'moderate',
        heavy_legs: false,
        duration_min: 45,
        blocks: [{ block_type: 'straight', exercises: [{ exercise_id: 'bench_press', sets: 3 }] }],
      },
    }
    const { deps: d } = deps([reply('Te propongo.', [add]), reply('Te propongo.', [add])])
    const res = await chatReply(d, {
      data: sampleContextInput({ templates: TEMPLATES }),
      message: 'x',
      history: [],
    })
    expect(res.ok && res.changes).toEqual([])
    expect(res.ok && res.discarded).toEqual(['«Añadir fuerza»: no tienes un plan activo.'])
  })

  it('create_plan con otras acciones: se queda el plan; plantilla inexistente se ignora', async () => {
    const actions: ChatAction[] = [
      createPlan({ plan: { family: 'strength', days_per_week: 3, template_id: 'inventada' } }),
      { type: 'skip_session', planned_session_id: 'p-thu', title: 'Salta el jueves', reason: 'x' },
    ]
    const { deps: d, requests } = deps([reply('a', actions), reply('b', actions)])
    const res = await chatReply(d, { data: withPlan(), message: 'x', history: [] })
    expect(requests[1]!.prompt).toContain('template_id «inventada» no existe')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan_request).toMatchObject({ family: 'strength', days_per_week: 3 })
    expect(res.plan_request?.template_id).toBeUndefined()
    expect(res.changes).toEqual([])
    expect(res.discarded).toEqual(['«Salta el jueves»: no tiene sentido junto a un plan nuevo.'])
  })

  it('create_plan sin datos del plan: se descarta', async () => {
    const noPlan: ChatAction = { type: 'create_plan', title: 'Plan', reason: 'x' }
    const { deps: d } = deps([reply('a', [noPlan]), reply('a', [noPlan])])
    const res = await chatReply(d, { data: withPlan(), message: 'x', history: [] })
    expect(res.ok && res.plan_request).toBeUndefined()
    expect(res.ok && res.discarded).toEqual(['«Plan»: le faltaban datos.'])
  })
})

describe('chat: adjust_today', () => {
  const adjust: ChatAction = {
    type: 'adjust_today',
    title: 'Revisar la fuerza de hoy',
    reason: 'Dormiste poco',
  }

  it('con sesión pendiente hoy → propuesta con esa sesión', async () => {
    const { deps: d } = deps([reply('Te propongo revisarla.', [adjust])])
    const res = await chatReply(d, { data: withPlan(), message: 'Estoy muerto', history: [] })
    expect(res.ok && res.adjust_today).toEqual({
      title: 'Revisar la fuerza de hoy',
      reason: 'Dormiste poco',
      planned_session_id: 'p-today',
    })
  })

  it('sin sesión hoy → se descarta con aviso', async () => {
    const data = withPlan({
      plan: { name: 'Plan', startDate: '2026-09-28', sessions: [planned('p-thu', '2026-10-01')] },
    })
    const { deps: d } = deps([reply('a', [adjust]), reply('a', [adjust])])
    const res = await chatReply(d, { data, message: 'x', history: [] })
    expect(res.ok && res.adjust_today).toBeUndefined()
    expect(res.ok && res.discarded).toEqual([
      '«Revisar la fuerza de hoy»: hoy no tienes ninguna sesión pendiente en el plan.',
    ])
  })
})

describe('contexto: tipos de actividad del usuario', () => {
  const custom: ActivityType = {
    id: 'a_escalada',
    ownerId: 'u1',
    name: 'Escalada',
    emoji: '🧗',
    exerciseId: 'other_activity',
    location: 'other',
    muscles: ['lats', 'forearms', 'biceps'],
    setsPer30Min: 2,
    quick: true,
    fixed: true,
    freeActivity: true,
    legLoading: false,
    hardLegs: false,
    sortOrder: 100,
    archived: false,
  }

  it('incluye predefinidas y personalizadas con su aproximación; las sesiones suman al mapa', () => {
    const data = sampleContextInput({
      activityTypes: [custom, { ...custom, id: 'a_vieja', name: 'Vieja', archived: true }],
      sessions: [
        {
          id: 'c1',
          date: '2026-09-28',
          sessionType: 'custom',
          activityTypeId: 'a_escalada',
          title: 'Rocódromo',
          durationMin: 60,
          rpe: 7,
          distanceM: null,
        },
      ],
      setCounts: [],
    })
    const ctx = buildAiContext(data) as unknown as {
      activity_types: { list: string[] }
      recent: { muscle_sets_7d: Record<string, number>; sessions_last_14d: unknown[] }
    }
    const lines = ctx.activity_types.list
    expect(lines).toContain(
      'a_escalada | Escalada | 🧗 | lats,forearms,biceps | 2 | personalizada, actividad libre',
    )
    expect(lines.some((l) => l.startsWith('fronton | Frontón'))).toBe(true)
    expect(lines.find((l) => l.startsWith('fronton'))).toContain('carga piernas')
    expect(lines.find((l) => l.startsWith('gap'))).toContain('intensa de pierna')
    expect(lines.some((l) => l.startsWith('a_vieja'))).toBe(false)
    // 60 min → 4 series equivalentes a cada músculo.
    expect(ctx.recent.muscle_sets_7d).toMatchObject({ lats: 4, forearms: 4, biceps: 4 })
    expect(ctx.recent.sessions_last_14d).toEqual([
      expect.objectContaining({ type: 'a_escalada', activity: 'Escalada' }),
    ])
  })

  it('las actividades fijas personalizadas llevan su nombre', () => {
    const base = sampleContextInput()
    const data = sampleContextInput({
      activityTypes: [custom],
      training: {
        ...base.training!,
        fixedActivities: [{ type: 'a_escalada', days: [2], minutes: 90, label: null }],
      },
    })
    const ctx = buildAiContext(data) as unknown as { athlete: { fixed_activities: unknown[] } }
    expect(ctx.athlete.fixed_activities).toEqual([
      { type: 'a_escalada', name: 'Escalada', days: 'M', minutes: 90 },
    ])
  })
})

describe('modelo por tipo de tarea (GEMINI_MODEL_HEAVY)', () => {
  it('sin GEMINI_MODEL_HEAVY todo usa GEMINI_MODEL', () => {
    const c = getAiConfig({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'flash' })
    expect(c.heavyModel).toBeNull()
    expect(modelFor(c, 'heavy')).toBe('flash')
    expect(modelFor(c, 'light')).toBe('flash')
    expect(createProvider(c, 'heavy')!.model).toBe('flash')
  })

  it('con GEMINI_MODEL_HEAVY: planes y revisión con el pesado; el resto con el normal', () => {
    const c = getAiConfig({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'flash',
      GEMINI_MODEL_HEAVY: 'pro',
      GEMINI_FALLBACK_MODEL: 'flash-lite',
    })
    expect(modelFor(c, 'heavy')).toBe('pro')
    expect(modelFor(c, 'light')).toBe('flash')
    expect(createProvider(c, 'heavy')!.model).toBe('pro')
    expect(createProvider(c, 'light')!.model).toBe('flash')
    expect(c.fallbackModel).toBe('flash-lite')
    expect(describeAiEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL_HEAVY: 'pro' })).toMatchObject({
      heavyModel: 'pro',
      GEMINI_MODEL_HEAVY: true,
    })
  })

  it('con Anthropic no aplica', () => {
    const c = getAiConfig({
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      GEMINI_MODEL_HEAVY: 'pro',
    })
    expect(c.heavyModel).toBeNull()
    expect(modelFor(c, 'heavy')).toBe(c.model)
  })
})
