import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

// Acciones del chat del entrenador (§11.5) contra el simulador de Gemini del mock:
// - «Créame un plan…» → acción create_plan → el plan se prepara con el mismo flujo que
//   «Personalizar con IA» (modelo pesado) → «Crear plan» → confirmación de la base de datos y el
//   plan en el calendario.
// - La IA afirma haber hecho algo sin acción: reintento y, si insiste, texto honesto; nada cambia.
// - Acción inválida: se descarta con aviso.
// - Bloque de varios días (add_sessions_range): una tarjeta con los días, desmarcar, aviso de
//   los días que ya tienen sesión y «Añadir N sesiones».
// - Varias acciones por respuesta: 3 add_session → 3 tarjetas; modo depuración.
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS

type State = {
  userPlans: { name: string; status: string; source: string; start_date: string }[]
  plannedSessions: { date: string; title: string; status: string; user_plan_id: string }[]
  aiInteractions: { kind: string; status: string; model: string; accepted: boolean | null }[]
  chatMessages: { role: string; content: string }[]
  geminiRequests: { model: string; body: { contents: { parts: { text: string }[] }[] } }[]
}

async function state(request: APIRequestContext) {
  return (await (await request.get(`${MOCK}/__state`)).json()) as State
}

async function login(context: BrowserContext) {
  await context.addCookies([
    {
      name: 'sb-localhost-auth-token',
      value: authCookie(Math.floor(Date.parse('2026-10-08T00:00:00Z') / 1000)),
      url: 'http://localhost:3100',
    },
  ])
}

const session = (n: number, exercise: string) => ({
  day_hint: n,
  session_type: 'strength',
  title: `Fuerza ${n}`,
  intensity: 'moderate',
  heavy_legs: false,
  duration_min: 50,
  blocks: [
    {
      block_type: 'straight',
      exercises: [{ exercise_id: exercise, sets: 3, reps: '8-10', rir: 2, rest_s: 120 }],
    },
  ],
})

const plan = {
  name: 'Fuerza 3 días',
  summary: 'Tres días de fuerza de cuerpo completo.',
  progression_rules: 'Sube peso al completar el techo del rango.',
  weeks: [1, 2, 3, 4].map((week) => ({
    week,
    deload: week === 4,
    sessions: [session(1, 'bench_press'), session(2, 'goblet_squat'), session(3, 'lat_pulldown')],
  })),
}

async function seed(request: APIRequestContext, gemini: unknown[], extra = {}) {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['strength'], main: 'strength' },
        level: 'beginner',
        availability: { days_per_week: 3, preferred_days: [1, 3, 5] },
      },
      gemini,
      ...extra,
    },
  })
}

async function ask(page: import('@playwright/test').Page, text: string) {
  await page.getByLabel('Mensaje para el entrenador').fill(text)
  await page.getByRole('button', { name: 'Enviar' }).click()
}

test('chat: «créame un plan» → tarjeta → Crear plan → confirmación y plan en el calendario', async ({
  page,
  context,
  request,
}) => {
  const reply = {
    reply: 'Te propongo un plan de fuerza de 3 días. Revísalo y pulsa «Crear plan» en la tarjeta.',
    actions: [
      {
        type: 'create_plan',
        title: 'Plan de fuerza de 3 días',
        reason: 'Es lo que pides y encaja con tu nivel.',
        plan: {
          family: 'strength',
          level: 'beginner',
          days_per_week: 3,
          template_id: 'strength_beginner',
          focus: 'fuerza 3 días',
        },
      },
    ],
  }
  await seed(request, [reply, plan])
  // Miércoles 7/10/2026: el plan empieza el lunes 12.
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/entrenador')
  await ask(page, 'Créame un plan de 3 días de fuerza')
  const conversation = page.getByRole('list', { name: 'Conversación' })
  await expect(conversation.getByText(reply.reply)).toBeVisible()

  const card = page.getByRole('region', { name: 'Propuesta: Plan de fuerza de 3 días' })
  // Se prepara solo (recién pedido) con el mismo flujo que «Personalizar con IA».
  await expect(card.getByText('Fuerza 3 días', { exact: true })).toBeVisible()
  await expect(card.getByText(/Fuerza · 3 días\/semana · 4 semanas/)).toBeVisible()
  await expect(card.getByText(/Empieza el lunes 12 oct · 12 sesiones/)).toBeVisible()
  let s = await state(request)
  // Pide un plan: la respuesta del chat también va al modelo pesado.
  expect(s.geminiRequests.map((r) => r.model)).toEqual(['gemini-e2e-heavy', 'gemini-e2e-heavy'])
  const planPrompt = s.geminiRequests[1]!.body.contents[0]!.parts[0]!.text
  expect(planPrompt).toContain('TAREA: genera un plan de entrenamiento de 4 semanas')
  expect(planPrompt).toContain('"base_template":{"id":"strength_beginner"')
  expect(planPrompt).toContain('Pon 3 sesiones por semana')
  // Nada creado todavía.
  expect(s.userPlans).toEqual([])

  // «Ver detalle»: la vista previa completa de la propuesta.
  await card.getByRole('button', { name: 'Ver detalle' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Tres días de fuerza de cuerpo completo.')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-plan-detalle.png`, fullPage: true })
  await sheet.getByRole('button', { name: 'Cerrar' }).last().click()

  await card.getByRole('button', { name: 'Crear plan' }).click()
  await expect(
    card.getByText(
      '✅ Plan creado: 4 semanas, 3 días/semana (12 sesiones), desde el lunes 12 oct.',
    ),
  ).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-plan-creado.png`, fullPage: true })
  s = await state(request)
  expect(s.userPlans).toEqual([
    expect.objectContaining({
      status: 'active',
      source: 'ai',
      name: 'Fuerza 3 días',
      start_date: '2026-10-12',
    }),
  ])
  expect(s.plannedSessions).toHaveLength(12)
  expect(s.plannedSessions.slice(0, 3).map((p) => p.date)).toEqual([
    '2026-10-12',
    '2026-10-14',
    '2026-10-16',
  ])

  // La confirmación se conserva al volver y lleva al calendario.
  await page.reload()
  await expect(card.getByText(/✅ Plan creado: 4 semanas, 3 días\/semana/)).toBeVisible()
  expect((await state(request)).geminiRequests).toHaveLength(2)
  await card.getByRole('link', { name: 'Ver en Plan' }).click()
  await expect(page).toHaveURL(/\/plan\?semana=2026-10-12/)
  await expect(page.getByText('Fuerza 1').first()).toBeVisible()
  await expect(page.getByText('Fuerza 3').first()).toBeVisible()
})

test('chat: afirmación sin acción → texto honesto; acción inválida → descartada con aviso', async ({
  page,
  context,
  request,
}) => {
  const claim = { reply: '¡Hecho! Ya tienes el plan en tu calendario.' }
  const invalid = {
    reply: 'Te propongo mover la sesión del jueves.',
    actions: [
      {
        type: 'move_session',
        planned_session_id: 'no-existe',
        date: '2026-10-09',
        title: 'Mover el jueves al viernes',
        reason: 'Así descansas.',
      },
    ],
  }
  // Cada respuesta incoherente se reintenta una vez; después, texto honesto y descarte.
  await seed(request, [claim, claim, invalid, invalid])
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)

  await page.goto('/entrenador')
  await ask(page, 'Créame un plan')
  const conversation = page.getByRole('list', { name: 'Conversación' })
  await expect(
    conversation.getByText(
      'No he podido preparar el plan. Prueba a pedírmelo así: «Créame un plan de 3 días de fuerza».',
    ),
  ).toBeVisible()
  await expect(conversation.getByText(claim.reply)).toHaveCount(0)
  await expect(page.getByRole('region', { name: /Propuesta|Cambio propuesto/ })).toHaveCount(0)
  let s = await state(request)
  expect(s.userPlans).toEqual([])
  expect(s.plannedSessions).toEqual([])
  expect(s.geminiRequests).toHaveLength(2)
  const prompt = s.geminiRequests[0]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('Nunca digas que has creado')
  expect(s.geminiRequests[1]!.body.contents[0]!.parts[0]!.text).toContain(
    '«actions» no trae ninguna acción válida',
  )

  await ask(page, 'Muéveme el jueves')
  await expect(
    conversation.getByText(
      'No he podido preparar las sesiones. Para añadir sesiones necesitas un plan activo. Prueba a pedírmelo así: «Créame un plan de 3 días de fuerza».',
    ),
  ).toBeVisible()
  await expect(page.getByText('He quitado una propuesta que no se podía aplicar:')).toBeVisible()
  await expect(
    page.getByText('«Mover el jueves al viernes»: no tienes un plan activo.'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: /Cambio propuesto/ })).toHaveCount(0)
  s = await state(request)
  expect(s.geminiRequests).toHaveLength(4)
  expect(s.userPlans).toEqual([])
  expect(s.chatMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  void USER_ID
})

// Plan de fuerza que empieza el lunes 5/10 (lunes y miércoles).
const PLAN_ID = '00000000-0000-4000-8000-00000000c0de'
const strengthRow = (id: string, date: string, title: string) => ({
  id,
  user_plan_id: PLAN_ID,
  user_id: USER_ID,
  date,
  original_date: null,
  week: 1,
  session_type: 'strength',
  title,
  intensity: 'moderate',
  heavy_legs: false,
  duration_min: 60,
  notes: null,
  blocks: [
    {
      block_type: 'straight',
      exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8-10' }],
    },
  ],
  status: 'planned',
  workout_session_id: null,
})
const withStrengthPlan = {
  userPlans: [
    {
      id: PLAN_ID,
      user_id: USER_ID,
      template_id: 'strength_beginner',
      name: 'Fuerza',
      start_date: '2026-10-05',
      status: 'active',
      source: 'template',
      notes: null,
    },
  ],
  plannedSessions: [
    strengthRow('p-mon', '2026-10-05', 'Fuerza A'),
    strengthRow('p-wed', '2026-10-07', 'Fuerza B'),
  ],
}

const easy = (date: string, type: 'yoga' | 'cycling', title: string) => ({
  date,
  session: {
    session_type: type,
    title,
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 30,
    blocks: [
      {
        block_type: 'free',
        exercises: [{ exercise_id: type === 'cycling' ? 'bike' : 'yoga', duration_s: 1800 }],
      },
    ],
  },
})

test('chat: «de hoy al domingo» → una tarjeta con los días, desmarcar y añadir sin tocar el lunes', async ({
  page,
  context,
  request,
}) => {
  const range = {
    reply:
      'Te propongo días suaves hasta el domingo, sin impacto para la rodilla. El lunes empiezas tu plan. Si la rodilla sigue doliendo, consúltalo con un fisioterapeuta.',
    actions: [
      {
        type: 'add_sessions_range',
        title: 'Recuperación hasta el domingo',
        reason: 'Agujetas de la Deka y rodilla',
        days: [
          easy('2026-09-30', 'yoga', 'Yoga suave'),
          easy('2026-10-01', 'cycling', 'Bici suave Z1'),
          easy('2026-10-02', 'yoga', 'Movilidad y yoga'),
          easy('2026-10-03', 'cycling', 'Bici muy suave'),
          easy('2026-10-04', 'yoga', 'Yoga restaurativo'),
          // La IA insiste en el lunes (ya tiene «Fuerza A»): la tarjeta lo avisa y lo deja sin marcar.
          easy('2026-10-05', 'yoga', 'Yoga lunes'),
        ],
      },
    ],
  }
  await seed(request, [range, range], withStrengthPlan)
  // Miércoles 30/9/2026.
  await page.clock.setFixedTime(new Date('2026-09-30T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/entrenador')
  await ask(
    page,
    'Crea un plan de hoy al domingo para recuperarme de las agujetas de la Deka y de mi rodilla y así el lunes poder empezar el plan de fuerza que ya tengo',
  )
  const card = page.getByRole('region', { name: 'Propuesta: Recuperación hasta el domingo' })
  await expect(card).toBeVisible()
  let s = await state(request)
  // Planificar varios días → modelo pesado; el lunes chocaba → reintento con el normal (el pesado,
  // como mucho una vez por mensaje).
  expect(s.geminiRequests.map((r) => r.model)).toEqual(['gemini-e2e-heavy', 'gemini-2.5-flash'])

  const days = card.getByRole('list', { name: 'Días propuestos' }).getByRole('listitem')
  await expect(days).toHaveCount(6)
  await expect(card.getByText('Ya tienes «Fuerza A» ese día')).toBeVisible()
  const monday = card.getByRole('checkbox', { name: /lunes 5 oct/ })
  await expect(monday).not.toBeChecked()
  await expect(card.getByRole('button', { name: 'Añadir 5 sesiones' })).toBeVisible()

  // Desmarcar el sábado.
  await card.getByRole('checkbox', { name: /sábado 3 oct/ }).uncheck()
  // Marcar el lunes avisa antes de aplicar; se vuelve a desmarcar.
  await monday.check()
  await expect(
    card.getByText(/Vas a añadir una sesión en días que ya tienen otra planificada/),
  ).toBeVisible()
  await monday.uncheck()
  await expect(card.getByText(/Vas a añadir una sesión/)).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-range.png`, fullPage: true })

  await card.getByRole('button', { name: 'Añadir 4 sesiones' }).click()
  await expect(
    card.getByText('✅ 4 sesiones añadidas al plan · miércoles 30 sept → domingo 4 oct'),
  ).toBeVisible()
  s = await state(request)
  expect(
    s.plannedSessions.map((p) => [p.date, p.title]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
  ).toEqual([
    ['2026-09-30', 'Yoga suave'],
    ['2026-10-01', 'Bici suave Z1'],
    ['2026-10-02', 'Movilidad y yoga'],
    ['2026-10-04', 'Yoga restaurativo'],
    ['2026-10-05', 'Fuerza A'],
    ['2026-10-07', 'Fuerza B'],
  ])
  // La confirmación se conserva al volver.
  await page.reload()
  await expect(card.getByText(/✅ 4 sesiones añadidas al plan/)).toBeVisible()
  await expect(card.getByRole('checkbox')).toHaveCount(0)
})

test('chat: 3 add_session en una respuesta → 3 tarjetas; modo depuración con el modelo', async ({
  page,
  context,
  request,
}) => {
  const add = (date: string, title: string) => ({
    type: 'add_session',
    title,
    reason: 'Recuperación activa',
    ...easy(date, 'yoga', title),
  })
  const three = {
    reply: 'Te propongo tres sesiones de yoga suave: una tarjeta para cada una.',
    actions: [
      add('2026-10-01', 'Yoga jueves'),
      add('2026-10-02', 'Yoga viernes'),
      add('2026-10-04', 'Yoga domingo'),
    ],
  }
  await seed(request, [three], withStrengthPlan)
  await page.clock.setFixedTime(new Date('2026-09-30T09:00:00'))
  await login(context)

  await page.goto('/entrenador?debug=1')
  await ask(page, 'Me vendría bien algo de yoga')
  const cards = page.getByRole('region', { name: /Cambio propuesto/ })
  await expect(cards).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Cambio propuesto: Yoga viernes' })).toBeVisible()
  // Solo en modo depuración: el modelo que respondió (mensaje sin varios días → el normal).
  await expect(page.getByText('modelo: gemini-2.5-flash (light) · intentos: 1')).toBeVisible()

  await page
    .getByRole('region', { name: 'Cambio propuesto: Yoga jueves' })
    .getByRole('button', { name: 'Aceptar' })
    .click()
  await expect(page.getByText(/✅ Sesión añadida al plan · jueves 1 oct/)).toBeVisible()
  expect((await state(request)).plannedSessions.map((p) => p.title)).toContain('Yoga jueves')

  // Sin ?debug el modo sigue activo en este dispositivo hasta ?debug=0.
  await page.goto('/entrenador?debug=0')
  await expect(page.getByText(/modelo: gemini/)).toHaveCount(0)
})
