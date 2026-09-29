import { expect, test, type Page } from '@playwright/test'

// Actividades nuevas (0031): registrar un GAP, un pádel y una actividad personalizada creada
// desde «Registrar actividad»; se guardan con su tipo, salen en el historial con su emoji y se
// pueden filtrar por tipo.
import { MOCK, authCookie } from './helpers'

type State = {
  sessions: { session: { session_type: string; activity_type_id: string | null; title: string } }[]
  customActivities: { id: string; name: string; muscles: string[] }[]
}

async function register(page: Page, activity: RegExp, rpe: string) {
  await page.goto('/entrenar/actividad')
  await page
    .getByRole('group', { name: 'Tipo de actividad' })
    .getByRole('button', { name: activity })
    .click()
  await page.getByRole('button', { name: '45', exact: true }).click()
  await page.getByRole('button', { name: rpe, exact: true }).click()
  await page.getByRole('button', { name: 'Guardar actividad' }).click()
  await expect(page).toHaveURL(/\/entrenar\/historial\//)
}

test.beforeEach(async ({ request, context }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
})

test('registrar un GAP, un pádel y una actividad personalizada', async ({ page, request }) => {
  await register(page, /GAP/, '7')
  await expect(page.getByRole('heading', { name: /GAP/ })).toBeVisible()
  // Mapa muscular de la sesión con la aproximación de GAP.
  await expect(page.getByText(/aproximad/i).first()).toBeVisible()

  await register(page, /Pádel/, '6')
  await expect(page.getByRole('heading', { name: /Pádel/ })).toBeVisible()

  // Nueva actividad desde la misma pantalla: queda elegida.
  await page.goto('/entrenar/actividad')
  await page.getByRole('button', { name: 'Nueva' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Nombre').fill('Body pump')
  await sheet.getByRole('button', { name: 'Emoji 🥊' }).click()
  await sheet.getByRole('button', { name: 'Cuádriceps' }).click()
  await sheet.getByRole('button', { name: 'Pectoral' }).click()
  await sheet.getByRole('button', { name: 'Crear actividad' }).click()
  await expect(page.getByText('«Body pump» creada')).toBeVisible()
  await expect(
    page
      .getByRole('group', { name: 'Tipo de actividad' })
      .getByRole('button', { name: /Body pump/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '60', exact: true }).click()
  await page.getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar actividad' }).click()
  await expect(page.getByRole('heading', { name: /Body pump/ })).toBeVisible()
  await expect(page.getByText(/Body pump ·/)).toBeVisible()

  await expect
    .poll(async () => {
      const state = (await (await request.get(`${MOCK}/__state`)).json()) as State
      return state.sessions.map((s) => s.session.session_type).sort()
    })
    .toEqual(['custom', 'gap', 'padel'])
  const state = (await (await request.get(`${MOCK}/__state`)).json()) as State
  const custom = state.sessions.find((s) => s.session.session_type === 'custom')!
  expect(state.customActivities).toEqual([
    expect.objectContaining({ name: 'Body pump', muscles: ['quads', 'chest'] }),
  ])
  expect(custom.session.activity_type_id).toBe(state.customActivities[0]!.id)

  // Historial: filtro por tipo con las tres.
  await page.goto('/entrenar')
  const filter = page.getByRole('group', { name: 'Filtrar por tipo' })
  await expect(filter.getByRole('button', { name: /GAP/ })).toBeVisible()
  await expect(filter.getByRole('button', { name: /Pádel/ })).toBeVisible()
  await filter.getByRole('button', { name: /Body pump/ }).click()
  await expect(page.getByRole('link', { name: /Body pump/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /GAP/ })).toHaveCount(0)

  // Perfil → Mis actividades.
  await page.goto('/perfil/actividades')
  await expect(page.getByText('Cuádriceps, Pectoral')).toBeVisible()
})
