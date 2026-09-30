import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

// Fase 6A: entrenador IA contra el simulador de Gemini del mock (nunca la API real).
// - Check-in con energía 1 y agujetas 5 → la IA propone reducir; solo se aplica al aceptar.
// - «Elegir plan» → «Recomiéndame un plan» → vista previa → Aceptar crea un plan de origen IA.
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const PLAN = '6a000000-0000-4000-8000-000000000001'

type Planned = {
  id: string
  title: string
  status: string
  intensity: string
  duration_min: number
}
type State = {
  plannedSessions: Planned[]
  userPlans: { status: string; source: string; notes: string | null; name: string }[]
  aiInteractions: { kind: string; status: string; accepted: boolean | null }[]
  geminiRequests: {
    model: string
    key: string
    body: { contents: { parts: { text: string }[] }[] }
  }[]
}

async function state(request: APIRequestContext) {
  return (await (await request.get(`${MOCK}/__state`)).json()) as State
}

const reduce = {
  decision: 'reduce',
  reason: 'Energía 1 y agujetas 5: hoy mejor una sesión suave para recuperar.',
  session: {
    title: 'Pierna suave',
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 35,
    blocks: [
      {
        block_type: 'straight',
        exercises: [{ exercise_id: 'goblet_squat', sets: 2, reps: '10', rir: 4, rest_s: 90 }],
      },
    ],
  },
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

test('ajuste del día: energía 1 y agujetas 5 → reducir, solo al aceptar', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['strength'], main: 'strength' },
        level: 'intermediate',
        availability: { days_per_week: 3, preferred_days: [1, 3, 5] },
        limitations: 'Rodilla derecha sensible',
      },
      userPlans: [
        {
          id: PLAN,
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
        {
          id: 'p-wed',
          user_plan_id: PLAN,
          user_id: USER_ID,
          date: '2026-10-07',
          original_date: null,
          week: 1,
          session_type: 'strength',
          title: 'Pierna pesada',
          intensity: 'hard',
          heavy_legs: true,
          duration_min: 60,
          notes: null,
          blocks: [
            {
              block_type: 'straight',
              exercises: [{ exercise_id: 'back_squat', sets: 5, reps: '5', rir: 1, rest_s: 180 }],
            },
          ],
          status: 'planned',
          workout_session_id: null,
        },
      ],
      gemini: [reduce, { ...reduce, reason: 'Segunda propuesta.' }],
    },
  })
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/')
  const today = page.getByRole('region', { name: 'Plan de hoy' })
  await expect(today.getByText('Pierna pesada')).toBeVisible()

  const checkin = page.getByRole('region', { name: 'Check-in de hoy' })
  await checkin.getByRole('button', { name: 'Sueño 3' }).click()
  await checkin.getByRole('button', { name: 'Energía 1' }).click()
  await checkin.getByRole('button', { name: 'Agujetas 5' }).click()
  await checkin.getByRole('button', { name: 'Estrés 3' }).click()
  await expect(today.getByText('Tu check-in de hoy indica cansancio')).toBeVisible()

  await today.getByRole('button', { name: '¿Ajusto el entreno de hoy?' }).click()
  const proposal = today.getByRole('region', { name: 'Propuesta de la IA' })
  await expect(proposal.getByText('Reducir la sesión')).toBeVisible()
  await expect(proposal.getByText(reduce.reason)).toBeVisible()
  await expect(proposal.getByText('Sentadilla goblet · 2 × 10 reps')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hoy-ia-propuesta.png`, fullPage: true })

  // La IA recibió el check-in, la sesión de hoy y las limitaciones; con la clave en cabecera.
  let s = await state(request)
  expect(s.geminiRequests).toHaveLength(1)
  expect(s.geminiRequests[0]!.key).toBe('e2e-gemini-key')
  const prompt = s.geminiRequests[0]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('"energy":1')
  expect(prompt).toContain('"soreness":5')
  expect(prompt).toContain('"title":"Pierna pesada"')
  expect(prompt).toContain('Rodilla derecha sensible')
  expect(prompt).not.toContain('e2e@test.dev')
  // Aún no se ha aplicado nada.
  expect(s.plannedSessions[0]).toMatchObject({ title: 'Pierna pesada', intensity: 'hard' })
  expect(s.aiInteractions).toEqual([
    expect.objectContaining({ kind: 'daily_adjust', status: 'ok', accepted: null }),
  ])

  await proposal.getByRole('button', { name: 'Aceptar' }).click()
  await expect(today.getByText('Pierna suave')).toBeVisible()
  await expect(today.getByText('Cambio de la IA aceptado')).toBeVisible()
  s = await state(request)
  expect(s.plannedSessions[0]).toMatchObject({
    title: 'Pierna suave',
    intensity: 'easy',
    duration_min: 35,
  })
  expect(s.aiInteractions[0]!.accepted).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hoy-ia-aplicada.png`, fullPage: true })

  // Deshacer vuelve a la sesión original.
  await today.getByRole('button', { name: 'Deshacer' }).click()
  await expect(today.getByText('Pierna pesada')).toBeVisible()
  await expect
    .poll(async () => (await state(request)).plannedSessions[0]!.title)
    .toBe('Pierna pesada')

  // Descartar: no cambia nada y queda registrada como no aceptada.
  await today.getByRole('button', { name: '¿Ajusto el entreno de hoy?' }).click()
  await expect(proposal.getByText('Segunda propuesta.')).toBeVisible()
  await proposal.getByRole('button', { name: 'Descartar' }).click()
  await expect(proposal).toBeHidden()
  await expect.poll(async () => (await state(request)).aiInteractions[1]?.accepted).toBe(false)
  expect((await state(request)).plannedSessions[0]!.title).toBe('Pierna pesada')

  // Cuota del proveedor agotada (sin más respuestas en el simulador): mensaje claro y la app
  // sigue funcionando.
  await today.getByRole('button', { name: '¿Ajusto el entreno de hoy?' }).click()
  await expect(today.getByText(/agotado su cuota/)).toBeVisible()
  await expect(today.getByRole('button', { name: 'Empezar planificada' })).toBeVisible()
})

test('elegir plan: «Recomiéndame un plan» con IA → vista previa → aceptar', async ({
  page,
  context,
  request,
}) => {
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
    name: 'Fuerza a tu medida',
    summary: 'Tres días de fuerza sin impacto en la rodilla.',
    progression_rules: 'Sube peso al completar el techo del rango.',
    weeks: [1, 2, 3, 4].map((week) => ({
      week,
      deload: week === 4,
      sessions: [session(1, 'bench_press'), session(2, 'goblet_squat'), session(3, 'lat_pulldown')],
    })),
  }
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['strength'], main: 'strength' },
        level: 'beginner',
        availability: { days_per_week: 3, preferred_days: [1, 3, 5] },
      },
      gemini: [plan],
    },
  })
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await login(context)
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/plan/elegir')
  await expect(page.getByText('Te quedan 5 consultas hoy')).toBeVisible()
  await page.getByRole('button', { name: 'Recomiéndame un plan' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Fuerza a tu medida')).toBeVisible()
  await expect(sheet.getByText('Tres días de fuerza sin impacto en la rodilla.')).toBeVisible()
  await expect(sheet.getByText('Te quedan 4 consultas hoy', { exact: false })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-ia-vista-previa.png`, fullPage: true })
  // Partió de la plantilla recomendada por reglas.
  const prompt = (await state(request)).geminiRequests[0]!.body.contents[0]!.parts[0]!.text
  expect(prompt).toContain('Parte de la plantilla base')
  expect((await state(request)).userPlans).toEqual([])

  // Editar: quitar una sesión de la semana 1 y renombrar el plan.
  await sheet.getByRole('button', { name: 'Editar' }).click()
  await sheet.getByLabel('Nombre del plan').fill('Mi fuerza')
  await sheet.getByRole('button', { name: 'Quitar Fuerza 3' }).click()
  await sheet.getByRole('button', { name: 'Listo' }).click()
  await sheet.getByRole('button', { name: 'Aceptar y crear el plan' }).click()

  await expect(page).toHaveURL(/\/plan\?semana=/)
  await expect.poll(async () => (await state(request)).aiInteractions[0]?.accepted).toBe(true)
  const s = await state(request)
  expect(s.userPlans).toEqual([
    expect.objectContaining({ status: 'active', source: 'ai', name: 'Mi fuerza' }),
  ])
  expect(s.plannedSessions).toHaveLength(11)
  expect(s.aiInteractions[0]).toMatchObject({ kind: 'plan_generation', accepted: true })
})
