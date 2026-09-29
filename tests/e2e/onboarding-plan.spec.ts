import { expect, test } from '@playwright/test'

// Criterio de aceptación de la Fase 5 (parte A): un usuario nuevo hace el onboarding, elige
// Híbrido y ve 4 semanas planificadas en sus días; hacer una sesión desde el plan la enlaza.
import { MOCK, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const weekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

type State = {
  trainingProfile: {
    goals: { main: string }
    level: string
    availability: { days_per_week: number; preferred_days: number[] }
    fixed_activities: { type: string; days: number[] }[]
  } | null
  userPlans: { id: string; template_id: string; status: string; start_date: string }[]
  plannedSessions: {
    id: string
    date: string
    week: number
    title: string
    status: string
    workout_session_id: string | null
  }[]
  commitments: { sessions_per_week: number }[]
  profile: { home_city: string | null }
}

test('onboarding → Híbrido → 4 semanas en sus días → sesión desde el plan', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, { data: { trainingProfile: null } })
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  // Primera vez: «Hoy» lleva al onboarding.
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText('Paso 1 de 6')).toBeVisible()
  const next = page.getByRole('button', { name: 'Siguiente' })

  // 1. Objetivos.
  await page.getByRole('button', { name: /Salud general/ }).click()
  await page.getByRole('button', { name: /Ganar fuerza/ }).click()
  await expect(page.getByRole('heading', { name: '¿Cuál es el principal?' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onb-1.png`, fullPage: true })
  await next.click()

  // 2. Nivel y marcas.
  await page.getByRole('button', { name: /Principiante/ }).click()
  await page.getByLabel('5K (mm:ss)').fill('28:30')
  await next.click()

  // 3. Disponibilidad: 4 días, 60 min, lunes, miércoles, viernes y sábado.
  await expect(page.getByText('Paso 3 de 6')).toBeVisible()
  await page.getByRole('button', { name: 'Más días' }).click()
  await page.getByRole('button', { name: '60 min' }).click()
  const preferred = page.getByRole('group', { name: 'Días preferidos' })
  for (const day of ['lunes', 'miércoles', 'viernes', 'sábado']) {
    await preferred.getByRole('button', { name: day, exact: true }).click()
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onb-3.png`, fullPage: true })
  await next.click()

  // 4. Material.
  await page.getByRole('button', { name: 'Gimnasio' }).click()
  await page.getByRole('button', { name: 'Barra', exact: true }).click()
  await page.getByRole('button', { name: 'Mancuernas' }).click()
  await next.click()

  // 5. Frontón los jueves.
  await page
    .getByRole('group', { name: /Días de .*Frontón/ })
    .getByRole('button', { name: 'jueves', exact: true })
    .click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onb-5.png`, fullPage: true })
  await next.click()

  // 6. Compromiso (propone los 4 días) y ciudad.
  await expect(page.getByText('Paso 6 de 6')).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar ciudad' }).fill('Barcelona')
  await page.getByRole('button', { name: 'Barcelona', exact: true }).click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onb-6.png`, fullPage: true })
  await page.getByRole('button', { name: 'Terminar' }).click()

  // Elegir plan: el recomendado es Híbrido (objetivo principal: salud general, principiante).
  await expect(page).toHaveURL(/\/plan\/elegir$/)
  const recommended = page.locator('[data-slot="card"]').filter({ hasText: 'Recomendado para ti' })
  await expect(recommended).toContainText('Híbrido · 4 días')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/elegir.png`, fullPage: true })
  await recommended.getByRole('button', { name: 'Ver y elegir' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Semana 1 en tus días')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/elegir-sheet.png` })
  await sheet.getByRole('button', { name: 'Crear plan' }).click()

  // Plan: 4 semanas con 4 sesiones en sus días (nunca el jueves del frontón).
  await expect(page).toHaveURL(/\/plan/)
  await expect(page.getByText(/0 de 4 hechas/)).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan.png`, fullPage: true })

  const state = (await (await request.get(`${MOCK}/__state`)).json()) as State
  expect(state.trainingProfile?.goals.main).toBe('health')
  expect(state.trainingProfile?.level).toBe('beginner')
  expect(state.trainingProfile?.availability).toMatchObject({
    days_per_week: 4,
    preferred_days: [1, 3, 5, 6],
  })
  expect(state.trainingProfile?.fixed_activities).toEqual([
    expect.objectContaining({ type: 'padel_fronton', days: [4] }),
  ])
  expect(state.commitments.at(-1)?.sessions_per_week).toBe(4)
  expect(state.profile.home_city).toBe('Barcelona')
  expect(state.userPlans).toHaveLength(1)
  expect(state.userPlans[0]).toMatchObject({ template_id: 'hybrid_beginner', status: 'active' })
  expect(state.plannedSessions).toHaveLength(16)
  expect([1, 2, 3, 4].map((w) => state.plannedSessions.filter((s) => s.week === w).length)).toEqual(
    [4, 4, 4, 4],
  )
  expect(new Set(state.plannedSessions.map((s) => weekday(s.date)))).toEqual(new Set([1, 3, 5, 6]))
  // Pierna pesada nunca el miércoles (día antes del frontón).
  for (const s of state.plannedSessions.filter((x) => x.week < 4)) {
    if (s.title.startsWith('Full body')) expect(weekday(s.date), s.title).not.toBe(3)
  }

  // Las 4 semanas se ven en el calendario.
  for (let w = 0; w < 3; w++) {
    await page.getByRole('button', { name: 'Semana siguiente' }).click()
    await expect(page.getByText(/de 4 hechas/)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(page.getByText('Sin sesiones planificadas')).toBeVisible()

  // Hacer la primera sesión desde el plan: queda enlazada y «Hecha».
  const first = [...state.plannedSessions].sort((a, b) => a.date.localeCompare(b.date))[0]!
  await page.goto(`/plan?semana=${first.date}`)
  await page.getByRole('button', { name: new RegExp(first.title) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Empezar ahora' }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(
    page.getByRole('heading', { name: 'Sentadilla con barra', exact: true }),
  ).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sesion.png`, fullPage: true })
  await page.getByRole('button', { name: 'Terminar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '7', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page).toHaveURL(/\/entrenar\/historial\//)

  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as State
      return s.plannedSessions.find((p) => p.id === first.id)?.status
    })
    .toBe('done')
  await page.goto(`/plan?semana=${first.date}`)
  await expect(page.getByText(/1 de 4 hechas/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: new RegExp(`${first.title}.*Hecha`) }),
  ).toBeVisible()
})
