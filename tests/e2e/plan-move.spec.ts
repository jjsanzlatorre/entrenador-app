import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Usabilidad 2/3: mover sesiones (tira de 14 días con «Deshacer», intercambiar, desde «Hoy»),
// mantener pulsado y arrastrar en el calendario, y mover el plan entero (pausar, desplazar,
// repetir semana) con vista previa y «Deshacer».
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const PLAN = '43000000-0000-4000-8000-000000000001'

type State = {
  plannedSessions: { id: string; date: string; status: string; original_date: string | null }[]
  userPlans: { id: string; start_date: string }[]
  planChanges: { kind: string; undone_at: string | null }[]
}

function planned(id: string, date: string, title: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    user_plan_id: PLAN,
    user_id: USER_ID,
    date,
    original_date: null,
    week: date < '2026-10-19' ? 1 : 2,
    session_type: 'strength',
    title,
    intensity: 'moderate',
    heavy_legs: false,
    duration_min: 60,
    notes: null,
    blocks: [
      {
        block_type: 'straight',
        exercises: [{ exercise_id: 'bench_press', sets: 3, reps: '8-10', rir: 2, rest_s: 120 }],
      },
    ],
    status: 'planned',
    workout_session_id: null,
    ...patch,
  }
}

async function seed(request: APIRequestContext) {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['strength'], main: 'strength' },
        level: 'beginner',
        availability: { days_per_week: 3, preferred_days: [1, 3, 5] },
        fixed_activities: [],
      },
      userPlans: [
        {
          id: PLAN,
          user_id: USER_ID,
          template_id: 'strength_beginner',
          name: 'Fuerza · 3 días',
          start_date: '2026-10-12',
          status: 'active',
          source: 'template',
          notes: null,
        },
      ],
      plannedSessions: [
        planned('p-mon', '2026-10-12', 'Full body A', { status: 'done' }),
        planned('p-wed', '2026-10-14', 'Full body B'),
        planned('p-fri', '2026-10-16', 'Rodaje suave', { session_type: 'running' }),
        planned('p-mon2', '2026-10-19', 'Full body C'),
        planned('p-wed2', '2026-10-21', 'Full body D'),
        planned('p-fri2', '2026-10-23', 'Rodaje largo', { session_type: 'running' }),
      ],
    },
  })
}

async function state(request: APIRequestContext) {
  return (await (await request.get(`${MOCK}/__state`)).json()) as State
}

const dateOf = async (request: APIRequestContext, id: string) =>
  (await state(request)).plannedSessions.find((p) => p.id === id)?.date

async function open(page: Page, path: string) {
  // Miércoles 14 oct 2026 a las 9:00 (los temporizadores siguen corriendo).
  await page.clock.setFixedTime(new Date('2026-10-14T09:00:00'))
  await page
    .context()
    .addCookies([
      { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
    ])
  await page.goto(path)
}

test.beforeEach(async ({ request }) => {
  await seed(request)
})

test('mover con la tira de 14 días, deshacer desde el aviso, intercambiar y mover desde Hoy', async ({
  page,
  request,
}) => {
  await open(page, '/plan')
  await page.getByRole('button', { name: /Rodaje suave/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mover', exact: true }).click()

  const sheet = page.getByRole('dialog', { name: /Mover «Rodaje suave»/ })
  await expect(sheet.getByText('Esta semana')).toBeVisible()
  await expect(sheet.getByText('Semana siguiente')).toBeVisible()
  // Los días pasados no se pueden elegir; el actual está marcado.
  await expect(sheet.getByRole('button', { name: /^Mover al martes 13 oct/ })).toBeDisabled()
  await expect(sheet.getByRole('button', { name: /^Mover al viernes 16 oct/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Un día con otra sesión lo dice (y la tira enseña su emoji).
  await expect(
    sheet.getByRole('button', { name: /^Mover al lunes 19 oct.*ya tienes Full body C/ }),
  ).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mover-tira.png` })

  // Un toque mueve.
  await sheet.getByRole('button', { name: /^Mover al sábado 17 oct/ }).click()
  await expect(page.getByText('«Rodaje suave» movida al sábado 17 oct')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-fri')).toBe('2026-10-17')
  expect((await state(request)).plannedSessions.find((p) => p.id === 'p-fri')).toMatchObject({
    status: 'moved',
    original_date: '2026-10-16',
  })

  // «Deshacer» en el propio aviso.
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText('Cambio deshecho')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-fri')).toBe('2026-10-16')
  expect((await state(request)).plannedSessions.find((p) => p.id === 'p-fri')?.status).toBe(
    'planned',
  )

  // Intercambiar: Full body B (miércoles) ⇄ Rodaje suave (viernes).
  await page.getByRole('button', { name: /Full body B/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mover', exact: true }).click()
  const swap = page.getByRole('dialog', { name: /Mover «Full body B»/ })
  await swap.getByRole('button', { name: 'Intercambiar' }).click()
  await swap.getByRole('button', { name: /Rodaje suave/ }).click()
  await expect(page.getByText(/^Intercambiadas:/)).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-wed')).toBe('2026-10-16')
  expect(await dateOf(request, 'p-fri')).toBe('2026-10-14')

  // Desde «Hoy»: la sesión de hoy (ahora el rodaje) se mueve a mañana.
  await page.goto('/')
  await expect(page.getByText('Hoy en tu plan · semana 1')).toBeVisible()
  await page.getByRole('button', { name: 'Mover', exact: true }).first().click()
  await page
    .getByRole('dialog', { name: /Mover «Rodaje suave»/ })
    .getByRole('button', { name: /^Mover al jueves 15 oct/ })
    .click()
  await expect.poll(() => dateOf(request, 'p-fri')).toBe('2026-10-15')
})

test('mantener pulsado y arrastrar una sesión a otro día del calendario', async ({
  page,
  request,
}) => {
  await open(page, '/plan')
  const card = page.locator('[data-planned-id="p-wed"]')
  await expect(card).toBeVisible()
  // Las hechas no se arrastran.
  await expect(page.locator('[data-planned-id="p-mon"] svg.lucide-grip-vertical')).toHaveCount(0)

  // La sesión en el centro de la pantalla: el jueves queda debajo, lejos de los bordes (cerca
  // del borde la página se desplaza sola).
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const from = (await card.boundingBox())!
  const target = page.locator('[data-drop-date="2026-10-15"]')
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Mantener pulsado (400 ms) antes de mover: si no, es un toque o scroll normal.
  await page.waitForTimeout(600)
  await page.mouse.move(to.x + to.width / 2, to.y + 12, { steps: 12 })
  await expect(target).toHaveClass(/border-solid/)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/arrastrar.png` })
  await page.mouse.up()

  await expect(page.getByText('«Full body B» movida al jueves 15 oct')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-wed')).toBe('2026-10-15')
  // Soltar no abre la hoja de la sesión.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Un toque sin mantener abre la sesión (no arrastra).
  await page.locator('[data-planned-id="p-wed"]').click()
  await expect(page.getByRole('dialog', { name: /Full body B/ })).toBeVisible()
})

test('pausar el plan una semana con vista previa y deshacer; desplazar y repetir semana', async ({
  page,
  request,
}) => {
  await open(page, '/plan')
  await page.getByRole('button', { name: 'Opciones del plan' }).click()
  await page.getByRole('button', { name: /Pausar plan/ }).click()

  const sheet = page.getByRole('dialog', { name: 'Pausar plan' })
  await expect(sheet.getByLabel('Desde')).toHaveValue('2026-10-14')
  await expect(sheet.getByLabel('Hasta (incluido)')).toHaveValue('2026-10-20')
  const preview = sheet.getByRole('region', { name: 'Vista previa' })
  await expect(preview).toContainText('5 sesiones cambian de día (1 semana después)')
  await expect(preview).toContainText('X 14 oct → X 21 oct')
  await expect(preview).toContainText('El plan terminará el V 30 oct (antes, el V 23 oct)')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pausar-vista-previa.png` })
  await sheet.getByRole('button', { name: 'Aplicar' }).click()

  await expect(page.getByText('Plan en pausa hasta el 20 oct')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-wed')).toBe('2026-10-21')
  const s = await state(request)
  expect(s.plannedSessions.map((p) => `${p.id}:${p.date}:${p.status}`).sort()).toEqual(
    [
      'p-mon:2026-10-12:done',
      'p-wed:2026-10-21:planned',
      'p-fri:2026-10-23:planned',
      'p-mon2:2026-10-26:planned',
      'p-wed2:2026-10-28:planned',
      'p-fri2:2026-10-30:planned',
    ].sort(),
  )
  // El calendario lo enseña.
  await expect(page.getByText('Plan en pausa').first()).toBeVisible()
  await expect(page.getByText('en pausa', { exact: false }).first()).toBeVisible()

  // Deshacer el último cambio desde el menú.
  await page.getByRole('button', { name: 'Opciones del plan' }).click()
  await page.getByRole('button', { name: /Deshacer el último cambio/ }).click()
  await expect(page.getByText('Cambio deshecho')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-wed')).toBe('2026-10-14')

  // Desplazar 2 días desde el lunes 19.
  await page.getByRole('button', { name: 'Opciones del plan' }).click()
  await page.getByRole('button', { name: /Desplazar plan/ }).click()
  const shift = page.getByRole('dialog', { name: 'Desplazar plan' })
  await shift.getByLabel('Desde').fill('2026-10-19')
  await shift.getByRole('button', { name: 'Días' }).click()
  await shift.getByLabel('Cuánto').fill('2')
  await expect(shift.getByRole('region', { name: 'Vista previa' })).toContainText(
    '3 sesiones cambian de día',
  )
  // Hacia atrás más de la cuenta: error y no deja aplicar.
  await shift.getByRole('button', { name: /Antes/ }).click()
  await shift.getByLabel('Cuánto').fill('9')
  await expect(shift.getByRole('alert')).toContainText('pasado')
  await expect(shift.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  await shift.getByRole('button', { name: /Después/ }).click()
  await shift.getByLabel('Cuánto').fill('2')
  await shift.getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText('Plan desplazado 2 días después')).toBeVisible()
  await expect.poll(() => dateOf(request, 'p-mon2')).toBe('2026-10-21')
  expect(await dateOf(request, 'p-wed')).toBe('2026-10-14')

  // Repetir esta semana: 3 sesiones nuevas la semana siguiente y el resto, 7 días después.
  await page.getByRole('button', { name: 'Opciones del plan' }).click()
  await page.getByRole('button', { name: /Repetir esta semana/ }).click()
  const repeat = page.getByRole('dialog', { name: 'Repetir esta semana' })
  await expect(repeat.getByRole('region', { name: 'Vista previa' })).toContainText(
    '3 sesiones cambian de día · 3 sesiones nuevas',
  )
  await repeat.getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText('Semana repetida: 3 sesiones añadidas')).toBeVisible()
  await expect.poll(async () => (await state(request)).plannedSessions.length).toBe(9)
  expect(await dateOf(request, 'p-mon2')).toBe('2026-10-28')
})
