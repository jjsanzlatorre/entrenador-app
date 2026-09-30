// Chat del entrenador con varios días (add_sessions_range), coherencia texto ↔ tarjetas y
// enrutado de modelo, con el proveedor simulado (nunca se llama a la API real). Reproduce la
// conversación real que fallaba:
//   1. «Crea un plan de hoy al domingo para recuperarme de las agujetas de la Deka y de mi rodilla
//      y así el lunes poder empezar el plan de fuerza que ya tengo» → UNA tarjeta con miércoles a
//      domingo, sin tocar el lunes.
//   2. «Pero faltan las sesiones recomendadas de jueves a domingo» → la IA promete tarjetas sin
//      acciones → reintento → texto honesto.
//   3. «¿Dónde están las tarjetas?» → «como esta que te dejo abajo» sin acciones → reintento →
//      esta vez con la acción: se ve la tarjeta.
import { describe, expect, it, vi } from 'vitest'
import { cardsSummary, chatTier, promisesCards } from '@/lib/ai/chat-text'
import type { AiContextInput, ContextPlanned } from '@/lib/ai/context'
import {
  chatReplySchema,
  type ChatAction,
  type ChatRangeDay,
  type ChatReply,
  type ChatResult,
} from '@/lib/ai/schemas'
import { sampleContextInput } from '@/lib/ai/test-fixtures'
import { chatReply, type CoachDeps } from './coach'
import { CHAT_PROMPT } from './prompts'
import type { AiProvider, JsonRequest } from './providers/types'
import type { UsageStore } from './usage'

function deps(responses: string[]) {
  const rows: { id: string; kind: string; status: string; output?: unknown }[] = []
  const requests: JsonRequest[] = []
  const provider: AiProvider = {
    name: 'mock',
    model: 'mock-heavy',
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = responses.shift()
      if (next === undefined) throw new Error('sin más respuestas')
      return { text: next, tokensIn: 100, tokensOut: 50, model: 'mock-heavy' }
    }),
  }
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
  const d: CoachDeps = { provider, usage, dailyLimit: 20 }
  return { deps: d, rows, requests }
}

const reply = (text: string, actions?: ChatAction[]) =>
  JSON.stringify({ reply: text, actions } satisfies ChatReply)

// Plan de fuerza que empieza el lunes 5/10 (lunes, miércoles y viernes).
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

// Hoy miércoles 30/09/2026.
function data(overrides: Partial<AiContextInput> = {}): AiContextInput {
  const base = sampleContextInput()
  return sampleContextInput({
    today: '2026-09-30',
    training: { ...base.training!, limitations: 'Rodilla derecha: molestias' },
    exercises: [
      ...base.exercises,
      {
        id: 'yoga',
        name: 'Yoga',
        category: 'mobility',
        equipment: [],
        muscles: [],
      },
      {
        id: 'cycling',
        name: 'Bici',
        category: 'cardio',
        equipment: [],
        muscles: [],
      },
    ],
    plan: {
      name: 'Fuerza torso/pierna',
      startDate: '2026-10-05',
      sessions: [
        strength('mon', '2026-10-05'),
        strength('wed', '2026-10-07'),
        strength('fri', '2026-10-09'),
      ],
    },
    ...overrides,
  })
}

const day = (date: string, type: 'yoga' | 'cycling', title: string): ChatRangeDay => ({
  date,
  session: {
    session_type: type,
    title,
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 30,
    blocks: [{ block_type: 'free', exercises: [{ exercise_id: type, duration_s: 1800 }] }],
  },
})

const WED_TO_SUN = [
  day('2026-09-30', 'yoga', 'Yoga suave'),
  day('2026-10-01', 'cycling', 'Bici suave Z1'),
  day('2026-10-02', 'yoga', 'Movilidad y yoga'),
  day('2026-10-03', 'cycling', 'Bici muy suave'),
  day('2026-10-04', 'yoga', 'Yoga restaurativo'),
]

const range = (days: ChatRangeDay[]): ChatAction => ({
  type: 'add_sessions_range',
  title: 'Recuperación hasta el domingo',
  reason: 'Bajar las agujetas de la Deka y cuidar la rodilla antes del plan de fuerza',
  days,
})

const FIRST =
  'Crea un plan de hoy al domingo para recuperarme de las agujetas de la Deka y de mi rodilla y así el lunes poder empezar el plan de fuerza que ya tengo'
const FIRST_REPLY =
  'Te propongo cinco días suaves hasta el domingo, sin impacto para la rodilla. El lunes empiezas tu plan de fuerza tal cual. Si la rodilla sigue doliendo, consúltalo con un fisioterapeuta.'

describe('conversación real: recuperación de hoy al domingo', () => {
  it('1) la primera petición genera add_sessions_range de miércoles a domingo sin tocar el lunes', async () => {
    const { deps: d, rows, requests } = deps([reply(FIRST_REPLY, [range(WED_TO_SUN)])])
    const tier = chatTier(FIRST)
    expect(tier).toBe('heavy')
    const res = await chatReply(d, { data: data(), message: FIRST, history: [], tier })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(requests).toHaveLength(1)
    // UNA tarjeta con los 5 días; nada el lunes 5/10 ni después; ninguna otra acción.
    expect(res.ranges).toHaveLength(1)
    const dates = res.ranges![0]!.days.map((x) => x.date)
    expect(dates).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(dates.every((x) => x < '2026-10-05')).toBe(true)
    expect(res.changes).toEqual([])
    expect(res.discarded).toBeUndefined()
    expect(res.reply).toBe(FIRST_REPLY)
    // La IA tiene las fechas exactas, el inicio del plan y los ejemplos de varios días.
    const prompt = requests[0]!.prompt
    expect(prompt).toContain('"2026-10-04 domingo"')
    expect(prompt).toContain('"start_date":"2026-10-05"')
    expect(prompt).toContain('add_sessions_range')
    expect(prompt).toContain('Nada en 2026-10-05 ni después')
    // Registro para depurar: modelo, tipo de tarea y respuesta cruda.
    expect(rows[0]!.output).toMatchObject({
      debug: { model: 'mock-heavy', tier: 'heavy', attempts: 1, text_fix: null, discarded: [] },
    })
    expect((rows[0]!.output as ChatResult).debug!.raw[0]).toContain('add_sessions_range')
  })

  it('1b) si la IA pone sesión el lunes (ya planificado) → reintento pidiendo respetar el plan', async () => {
    const withMonday = [...WED_TO_SUN, day('2026-10-05', 'yoga', 'Yoga')]
    const {
      deps: d,
      requests,
      rows,
    } = deps([reply(FIRST_REPLY, [range(withMonday)]), reply(FIRST_REPLY, [range(WED_TO_SUN)])])
    const res = await chatReply(d, { data: data(), message: FIRST, history: [], tier: 'heavy' })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain(
      '2026-10-05 ya tiene una sesión planificada en upcoming_sessions: no pongas sesiones esos días (respeta el plan)',
    )
    expect(res.ok && res.ranges![0]!.days.map((x) => x.date)).not.toContain('2026-10-05')
    expect((rows[0]!.output as ChatResult).debug!.issues[0]![0]).toContain('2026-10-05')
  })

  it('2) texto que promete tarjetas sin acciones → reintento → texto honesto', async () => {
    const bad =
      'Tienes razón, te propongo añadir un par de sesiones más para completar la recuperación. Pulsa "Añadir sesión" en las tarjetas.'
    const { deps: d, requests, rows } = deps([reply(bad), reply(bad, [])])
    const history = [
      { role: 'user' as const, text: FIRST },
      {
        role: 'assistant' as const,
        text: `Te propongo yoga el miércoles.\n${cardsSummary({
          changes: [
            {
              action: 'add',
              title: 'Yoga suave',
              reason: 'x',
              date: '2026-09-30',
            },
          ],
        })}`,
      },
    ]
    const message = 'Pero faltan las sesiones recomendadas de jueves a domingo'
    expect(chatTier(message)).toBe('heavy')
    const res = await chatReply(d, { data: data(), message, history, tier: 'heavy' })
    expect(requests).toHaveLength(2)
    expect(requests[0]!.prompt).toContain(
      '[Tarjetas mostradas: add_session «Yoga suave» 2026-09-30]',
    )
    expect(requests[1]!.prompt).toContain('«actions» no trae ninguna acción válida')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.reply).toBe(
      'No he podido preparar las sesiones. Prueba a pedírmelo así: «Prepárame sesiones suaves de recuperación de hoy al domingo, sin tocar mi plan».',
    )
    expect(res.changes).toEqual([])
    expect(res.ranges).toBeUndefined()
    const debug = (rows[0]!.output as ChatResult).debug!
    expect(debug).toMatchObject({ text_fix: 'honest', original_reply: bad, attempts: 2 })
    expect(debug.raw).toHaveLength(2)
    expect(debug.issues[0]![0]).toContain('no trae ninguna acción válida')
  })

  it('3) «¿Dónde están las tarjetas?» → sin acciones → reintento con la acción → se ve la tarjeta', async () => {
    const bad = 'Las tarjetas aparecen como esta que te dejo abajo.'
    const good = 'Aquí tienes jueves a domingo en una tarjeta: desmarca lo que no quieras.'
    const { deps: d, requests } = deps([reply(bad), reply(good, [range(WED_TO_SUN.slice(1))])])
    const res = await chatReply(d, {
      data: data(),
      message: '¿Dónde están las tarjetas?',
      history: [],
    })
    expect(requests).toHaveLength(2)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.reply).toBe(good)
    expect(res.ranges![0]!.days).toHaveLength(4)
  })
})

describe('varias acciones por respuesta', () => {
  const add = (date: string, title: string): ChatAction => ({
    type: 'add_session',
    title,
    reason: 'Recuperación',
    date,
    session: day(date, 'yoga', title).session,
  })

  it('una respuesta con 3 add_session → 3 tarjetas', async () => {
    const actions = [
      add('2026-10-01', 'Yoga jueves'),
      add('2026-10-02', 'Yoga viernes'),
      add('2026-10-04', 'Yoga domingo'),
    ]
    const { deps: d, requests } = deps([reply('Te propongo tres sesiones de yoga.', actions)])
    const res = await chatReply(d, { data: data(), message: 'x', history: [] })
    expect(requests).toHaveLength(1)
    expect(res.ok && res.changes.map((c) => [c.action, c.date, c.title])).toEqual([
      ['add', '2026-10-01', 'Yoga jueves'],
      ['add', '2026-10-02', 'Yoga viernes'],
      ['add', '2026-10-04', 'Yoga domingo'],
    ])
  })

  it('hasta 7 acciones; con 8 el esquema no vale', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => add(`2026-10-${String(i + 1).padStart(2, '0')}`, `S${i}`))
    expect(chatReplySchema.safeParse({ reply: 'x', actions: many(7) }).success).toBe(true)
    expect(chatReplySchema.safeParse({ reply: 'x', actions: many(8) }).success).toBe(false)
  })

  it('dos propuestas el mismo día → se queda la primera', async () => {
    const actions = [add('2026-10-01', 'Uno'), add('2026-10-01', 'Dos')]
    const { deps: d, requests } = deps([reply('a', actions), reply('a', actions)])
    const res = await chatReply(d, { data: data(), message: 'x', history: [] })
    expect(requests[1]!.prompt).toContain('dos propuestas que añaden una sesión el 2026-10-01')
    expect(res.ok && res.changes.map((c) => c.title)).toEqual(['Uno'])
    expect(res.ok && res.discarded).toEqual(['«Dos»: había otra propuesta para ese día.'])
  })

  it('si se descarta alguna, el texto no promete más tarjetas de las que hay', async () => {
    const actions = [
      add('2026-10-01', 'Yoga jueves'),
      { ...add('2026-10-02', 'Fuera de rango'), date: '2026-12-01' },
    ]
    const text = 'Te propongo dos sesiones: las tienes en las tarjetas.'
    const { deps: d, rows } = deps([reply(text, actions), reply(text, actions)])
    const res = await chatReply(d, { data: data(), message: 'x', history: [] })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changes).toHaveLength(1)
    expect(res.reply).toBe(
      `${text}\n\nOjo: solo he podido preparar la tarjeta que ves abajo; el resto no se podía aplicar.`,
    )
    const debug = (rows[0]!.output as ChatResult).debug!
    expect(debug.text_fix).toBe('fewer_cards')
    expect(debug.discarded).toEqual([
      'actions.1 (add_session): La fecha 2026-12-01 está fuera de rango: usa un día entre 2026-09-30 y 2026-10-13.',
    ])
  })
})

describe('add_sessions_range: validación', () => {
  it('sin plan activo se descarta con aviso (y el texto honesto lo explica)', async () => {
    const text = 'Te dejo abajo la tarjeta con los días.'
    const { deps: d } = deps([reply(text, [range(WED_TO_SUN)]), reply(text, [range(WED_TO_SUN)])])
    const res = await chatReply(d, { data: data({ plan: null }), message: FIRST, history: [] })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.ranges).toBeUndefined()
    expect(res.discarded).toEqual(['«Recuperación hasta el domingo»: no tienes un plan activo.'])
    expect(res.reply).toBe(
      'No he podido preparar las sesiones. Para añadir sesiones necesitas un plan activo. Prueba a pedírmelo así: «Créame un plan de 3 días de fuerza».',
    )
  })

  it('días repetidos o fuera de la ventana → reintento y descarte', async () => {
    const bad = range([WED_TO_SUN[0]!, WED_TO_SUN[0]!])
    const { deps: d, requests } = deps([reply('a', [bad]), reply('a', [bad])])
    const res = await chatReply(d, { data: data(), message: 'x', history: [] })
    expect(requests[1]!.prompt).toContain('aparece dos veces')
    expect(res.ok && res.ranges).toBeUndefined()
    expect(res.ok && res.discarded).toEqual(['«Recuperación hasta el domingo»: repetía un día.'])
  })

  it('ejercicios inventados: se quitan; el día que se queda vacío, fuera', async () => {
    const invented = day('2026-10-01', 'yoga', 'Inventado')
    invented.session.blocks[0]!.exercises[0]!.exercise_id = 'yoga_cuantico'
    const r = range([WED_TO_SUN[0]!, invented])
    const { deps: d } = deps([reply('a', [r]), reply('a', [r])])
    const res = await chatReply(d, { data: data(), message: 'x', history: [] })
    expect(res.ok && res.ranges![0]!.days.map((x) => x.date)).toEqual(['2026-09-30'])
    expect(res.ok && res.dropped).toEqual(['yoga_cuantico'])
  })
})

describe('texto y enrutado', () => {
  it('chatTier: planificar varios días → heavy; el resto → light', () => {
    for (const m of [
      FIRST,
      '¿Qué hago esta semana?',
      'Hasta el domingo, ¿qué entreno?',
      'Prepárame 3 sesiones',
      'El jueves no puedo, ¿lo muevo al viernes?',
      'Planifícame los próximos días',
      'dame algo para el finde',
    ]) {
      expect(chatTier(m), m).toBe('heavy')
    }
    for (const m of ['¿Cómo hago bien la sentadilla?', 'Me duele el hombro', 'Estoy cansado hoy']) {
      expect(chatTier(m), m).toBe('light')
    }
  })

  it('promisesCards detecta tarjetas, botones y afirmaciones', () => {
    for (const t of [
      'Pulsa "Añadir sesión" en las tarjetas.',
      'Las tarjetas aparecen como esta que te dejo abajo.',
      'Te propongo añadir un par de sesiones.',
      'Te he añadido yoga el jueves.',
      'Abajo tienes la propuesta.',
    ]) {
      expect(promisesCards(t), t).toBe(true)
    }
    for (const t of [
      'Descansa hoy y mañana valoramos.',
      'Pulsa «Empezar planificada» en Hoy cuando llegues al gimnasio.',
      'Si el dolor persiste, consulta a un fisioterapeuta.',
    ]) {
      expect(promisesCards(t), t).toBe(false)
    }
  })

  it('el prompt tiene ejemplos de varios días y de dolor, y el límite de 5 frases', () => {
    expect(CHAT_PROMPT).toContain('EJEMPLOS')
    expect(CHAT_PROMPT).toContain('"type":"add_sessions_range"')
    expect(CHAT_PROMPT).toContain('Me duele el hombro')
    expect(CHAT_PROMPT).toContain('consúltalo con un fisioterapeuta')
    expect(CHAT_PROMPT).toContain('como mucho 5 frases')
    expect(CHAT_PROMPT).toContain('Como mucho 7 acciones')
  })

  it('cardsSummary resume lo que vio el usuario', () => {
    expect(cardsSummary({ changes: [] })).toBe('[Sin tarjetas]')
    expect(
      cardsSummary({
        changes: [],
        ranges: [{ title: 'Recuperación', reason: 'x', days: [WED_TO_SUN[0]!] }],
      }),
    ).toBe('[Tarjetas mostradas: add_sessions_range «Recuperación» (2026-09-30 Yoga suave)]')
  })
})
