import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

// Acciones del chat del entrenador (§11.5) contra el simulador de Gemini del mock:
// - «Créame un plan…» → acción create_plan → el plan se prepara con el mismo flujo que
//   «Personalizar con IA» (modelo pesado) → «Crear plan» → confirmación de la base de datos y el
//   plan en el calendario.
// - La IA afirma haber hecho algo sin acción: solo texto, nada cambia.
// - Acción inválida: se descarta con aviso.
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
  expect(s.geminiRequests.map((r) => r.model)).toEqual(['gemini-2.5-flash', 'gemini-e2e-heavy'])
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

test('chat: afirmación sin acción → solo texto; acción inválida → descartada con aviso', async ({
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
  // La acción inválida se reintenta una vez y después se descarta.
  await seed(request, [claim, invalid, invalid])
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)

  await page.goto('/entrenador')
  await ask(page, 'Créame un plan')
  const conversation = page.getByRole('list', { name: 'Conversación' })
  await expect(conversation.getByText(claim.reply)).toBeVisible()
  await expect(page.getByRole('region', { name: /Propuesta|Cambio propuesto/ })).toHaveCount(0)
  let s = await state(request)
  expect(s.userPlans).toEqual([])
  expect(s.plannedSessions).toEqual([])
  const prompt = s.geminiRequests[0]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('Nunca digas que has creado')

  await ask(page, 'Muéveme el jueves')
  await expect(conversation.getByText(invalid.reply)).toBeVisible()
  await expect(page.getByText('He quitado una propuesta que no se podía aplicar:')).toBeVisible()
  await expect(
    page.getByText('«Mover el jueves al viernes»: no tienes un plan activo.'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: /Cambio propuesto/ })).toHaveCount(0)
  s = await state(request)
  expect(s.geminiRequests).toHaveLength(3)
  expect(s.userPlans).toEqual([])
  expect(s.chatMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  void USER_ID
})
