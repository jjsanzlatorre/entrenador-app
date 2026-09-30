import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

// Fase 6B: revisión semanal y chat con el entrenador contra el simulador de Gemini del mock.
// - La revisión se genera sola al abrir «Hoy» la primera vez de la semana y se guarda: volver a
//   abrirla no llama a la IA; «Regenerar» sí (con confirmación).
// - Los cambios propuestos (revisión y chat) solo se aplican al pulsar «Aceptar».
// - Con la cuota del modelo principal agotada (429) se usa el de reserva.
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const PLAN = '6b000000-0000-4000-8000-000000000001'

type State = {
  plannedSessions: { id: string; title: string; status: string; intensity: string }[]
  aiInteractions: {
    kind: string
    status: string
    model: string
    period: string | null
    accepted: boolean | null
  }[]
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

const squat = [
  {
    block_type: 'straight',
    exercises: [{ exercise_id: 'back_squat', sets: 5, reps: '5', rir: 1, rest_s: 180 }],
  },
]

function plannedRow(id: string, date: string, title: string, status = 'planned') {
  return {
    id,
    user_plan_id: PLAN,
    user_id: USER_ID,
    date,
    original_date: null,
    week: 1,
    session_type: 'strength',
    title,
    intensity: 'hard',
    heavy_legs: true,
    duration_min: 60,
    notes: null,
    blocks: squat,
    status,
    workout_session_id: null,
  }
}

// Hoy es miércoles 7/10/2026: la semana revisada es la del 28/9 al 4/10.
async function seed(request: APIRequestContext, gemini: unknown[]) {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['strength'], main: 'strength' },
        level: 'intermediate',
        availability: { days_per_week: 3, preferred_days: [1, 3, 5] },
      },
      userPlans: [
        {
          id: PLAN,
          user_id: USER_ID,
          template_id: 'strength_beginner',
          name: 'Fuerza',
          start_date: '2026-09-28',
          status: 'active',
          source: 'template',
          notes: null,
        },
      ],
      plannedSessions: [
        plannedRow('p-last-1', '2026-09-30', 'Pierna A', 'done'),
        plannedRow('p-last-2', '2026-10-02', 'Torso A', 'skipped'),
        plannedRow('p-thu', '2026-10-08', 'Pierna pesada'),
        plannedRow('p-sat', '2026-10-10', 'Torso pesado'),
      ],
      gemini,
    },
  })
}

const softSession = {
  title: 'Pierna ligera',
  intensity: 'easy',
  heavy_legs: false,
  duration_min: 40,
  blocks: [
    {
      block_type: 'straight',
      exercises: [{ exercise_id: 'goblet_squat', sets: 3, reps: '10', rir: 3, rest_s: 90 }],
    },
  ],
}

function review(headline: string) {
  return {
    headline,
    summary: 'Hiciste 1 de las 2 sesiones del plan. La carga fue baja.',
    recommendations: [
      { title: 'Reserva el jueves', detail: 'Bloquea 1 h en la agenda para la pierna.' },
      { title: 'Apunta el RPE', detail: 'Así la carga sale bien calculada.' },
      { title: 'Calienta la rodilla', detail: '5 min de movilidad antes de sentadilla.' },
    ],
    changes: [
      {
        action: 'skip',
        planned_session_id: 'p-thu',
        title: 'Descansa el jueves',
        reason: 'Vienes de una semana irregular: mejor empezar suave.',
      },
      {
        action: 'modify',
        planned_session_id: 'p-sat',
        title: 'Sábado más ligero',
        reason: 'Menos carga para retomar el ritmo.',
        session: softSession,
      },
    ],
  }
}

test('revisión semanal: se genera una vez, se guarda y los cambios solo al aceptar', async ({
  page,
  context,
  request,
}) => {
  const again = review('Revisión nueva')
  // La nueva ya no propone nada para el jueves (se aceptó el descanso).
  again.changes = again.changes.slice(1)
  await seed(request, [review('¡Semana a medias, pero seguimos!'), again])
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/')
  const card = page.getByRole('link', { name: /Revisión semanal/ })
  await expect(card.getByText('¡Semana a medias, pero seguimos!')).toBeVisible()
  await expect(card.getByText('2 cambios propuestos')).toBeVisible()
  let s = await state(request)
  expect(s.geminiRequests).toHaveLength(1)
  expect(s.aiInteractions).toEqual([
    expect.objectContaining({ kind: 'weekly_review', status: 'ok', period: '2026-09-28' }),
  ])
  const prompt = s.geminiRequests[0]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('"review_week":{"weekStart":"2026-09-28"')
  expect(prompt).toContain('"planned_session_id":"p-thu"')

  await card.click()
  await expect(page).toHaveURL(/\/plan\/revision$/)
  await expect(page.getByText('Semana del 28 sept – 4 oct')).toBeVisible()
  // Datos calculados por la app: 1 de 2 sesiones del plan.
  await expect(page.getByText('1 de 2', { exact: true })).toBeVisible()
  await expect(page.getByText('3. Calienta la rodilla')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/revision-semanal.png`, fullPage: true })

  // Nada ha cambiado aún.
  expect((await state(request)).plannedSessions.map((p) => p.status)).toEqual([
    'done',
    'skipped',
    'planned',
    'planned',
  ])
  const skip = page.getByRole('region', { name: 'Cambio propuesto: Descansa el jueves' })
  await expect(skip.getByText('Pierna pesada')).toBeVisible()
  await skip.getByRole('button', { name: 'Aceptar' }).click()
  await expect(skip.getByText(/Sesión cambiada por descanso · jueves 8 oct/)).toBeVisible()
  await expect
    .poll(async () => (await state(request)).plannedSessions.find((p) => p.id === 'p-thu')?.status)
    .toBe('skipped')

  const modify = page.getByRole('region', { name: 'Cambio propuesto: Sábado más ligero' })
  await modify.getByRole('button', { name: 'Descartar' }).click()
  await expect(modify.getByText('Descartado')).toBeVisible()
  expect((await state(request)).plannedSessions.find((p) => p.id === 'p-sat')?.title).toBe(
    'Torso pesado',
  )

  // Volver a abrirla: la guardada, sin llamar a la IA ni gastar consulta.
  await page.reload()
  await expect(page.getByText('¡Semana a medias, pero seguimos!')).toBeVisible()
  await expect(
    page.getByText(/Revisión guardada: volver a abrirla no gasta consultas/),
  ).toBeVisible()
  await expect(skip.getByText(/Sesión cambiada por descanso/)).toBeVisible()
  await expect(modify.getByText('Descartado')).toBeVisible()
  expect((await state(request)).geminiRequests).toHaveLength(1)

  // Regenerar: pide confirmación y gasta una consulta.
  await page.getByRole('button', { name: 'Regenerar' }).click()
  await expect(page.getByText(/Gasta 1 consulta a la IA \(te quedan 4 hoy\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Regenerar', exact: true }).click()
  await expect(page.getByText('Revisión nueva')).toBeVisible()
  // Las respuestas a los cambios son de cada revisión: el del sábado vuelve a estar pendiente.
  await expect(modify.getByRole('button', { name: 'Aceptar' })).toBeVisible()
  s = await state(request)
  expect(s.geminiRequests).toHaveLength(2)
  expect(s.aiInteractions.filter((a) => a.kind === 'weekly_review')).toHaveLength(2)
})

test('chat: historial, cambio como tarjeta aceptable y modelo de reserva ante un 429', async ({
  page,
  context,
  request,
}) => {
  const reply = {
    reply: 'Entendido: te propongo una pierna ligera el sábado para que llegues fresco al frontón.',
    actions: [
      {
        type: 'modify_session',
        planned_session_id: 'p-sat',
        title: 'Sábado más ligero',
        reason: 'Tienes frontón el domingo.',
        session: softSession,
      },
    ],
  }
  // Primera respuesta del simulador: 429 (cuota del modelo principal agotada).
  await seed(request, [{ __status: 429 }, reply])
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/plan')
  await page.getByRole('link', { name: 'Preguntar' }).click()
  await expect(page).toHaveURL(/\/entrenador$/)
  await expect(page.getByText('Consultas a la IA que te quedan hoy: 5')).toBeVisible()

  const box = page.getByLabel('Mensaje para el entrenador')
  await box.fill('El domingo tengo frontón, ¿cambio algo del sábado?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  const conversation = page.getByRole('list', { name: 'Conversación' })
  await expect(conversation.getByText(reply.reply)).toBeVisible()
  await expect(page.getByText('Consultas a la IA que te quedan hoy: 4')).toBeVisible()

  let s = await state(request)
  // 429 del principal → una vez con el de reserva.
  expect(s.geminiRequests.map((r) => r.model)).toEqual(['gemini-2.5-flash', 'gemini-e2e-fallback'])
  expect(s.aiInteractions).toEqual([
    expect.objectContaining({ kind: 'chat', status: 'ok', model: 'gemini-e2e-fallback' }),
  ])
  expect(s.chatMessages.map((m) => m.role)).toEqual(['user', 'assistant'])
  const prompt = s.geminiRequests[1]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('"message":"El domingo tengo frontón, ¿cambio algo del sábado?"')
  expect(s.plannedSessions.find((p) => p.id === 'p-sat')?.title).toBe('Torso pesado')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-entrenador.png`, fullPage: true })

  const change = page.getByRole('region', { name: 'Cambio propuesto: Sábado más ligero' })
  await change.getByRole('button', { name: 'Aceptar' }).click()
  await expect(change.getByText(/Sesión cambiada · sábado 10 oct/)).toBeVisible()
  await expect(change.getByRole('link', { name: 'Ver en Plan' })).toBeVisible()
  await expect
    .poll(async () => (await state(request)).plannedSessions.find((p) => p.id === 'p-sat')?.title)
    .toBe('Pierna ligera')

  // El historial se conserva.
  await page.reload()
  await expect(
    conversation.getByText('El domingo tengo frontón, ¿cambio algo del sábado?'),
  ).toBeVisible()
  await expect(conversation.getByText(reply.reply)).toBeVisible()
  await expect(change.getByText(/Sesión cambiada · sábado 10 oct/)).toBeVisible()

  // Sin más respuestas (cuota agotada también en la reserva): aviso y el texto no se pierde.
  await box.fill('¿Y el jueves?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText(/agotado su cuota gratuita/)).toBeVisible()
  await expect(box).toHaveValue('¿Y el jueves?')
  s = await state(request)
  expect(s.chatMessages).toHaveLength(2)
})
