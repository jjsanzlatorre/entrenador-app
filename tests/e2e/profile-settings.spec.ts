import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Perfil: la ciudad y los pop-ups se guardan y se ven al volver; un guardado que falla muestra
// un aviso. Compromiso: quitarlo deja «Hoy» sin porcentajes y el historial se puede borrar.
import { MOCK, USER_ID, authCookie } from './helpers'

async function login(context: BrowserContext) {
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
}

function localKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function monday(d: Date, weeksAgo = 0) {
  const m = new Date(d)
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksAgo)
  return localKey(m)
}

async function openProfile(page: Page) {
  await page.getByRole('navigation').getByRole('link', { name: 'Perfil' }).click()
  await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible()
}

const popupsSwitch = (page: Page) => page.getByRole('switch', { name: 'Pop-ups de logros' })

test.beforeEach(async ({ request, context }) => {
  await request.post(`${MOCK}/__reset`)
  await login(context)
})

test('los pop-ups desactivados siguen desactivados al volver y al recargar', async ({
  page,
  request,
}) => {
  // Se entra por «Hoy» y se navega dentro de la app, como en la PWA: así el estado de sesión
  // ya está en la caché del cliente (el fallo no se veía entrando directamente en /perfil).
  await page.goto('/')
  await openProfile(page)
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'true')
  await popupsSwitch(page).click()
  await expect(page.getByText('Pop-ups de logros desactivados')).toBeVisible()
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'false')

  // Navegación dentro de la app (sin recargar): antes volvía a salir marcado.
  await page.getByRole('link', { name: /Mi compromiso/ }).click()
  await openProfile(page)
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'false')

  // Segundo cambio en la misma visita.
  await popupsSwitch(page).click()
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'true')
  await popupsSwitch(page).click()
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'false')

  await page.reload()
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'false')
  const state = (await (await request.get(`${MOCK}/__state`)).json()) as {
    profile: { show_equivalence_popups: boolean }
  }
  expect(state.profile.show_equivalence_popups).toBe(false)
})

test('la ciudad de referencia se guarda y aparece en Perfil', async ({ page }) => {
  await page.goto('/')
  await openProfile(page)
  await page.getByRole('link', { name: /Ciudad de referencia/ }).click()
  await page.getByLabel('Buscar ciudad').fill('valen')
  await page.getByRole('button', { name: 'Valencia' }).click()
  await expect(page).toHaveURL(/\/perfil$/)
  await expect(page.getByRole('link', { name: /Ciudad de referencia/ })).toContainText('Valencia')
  await page.reload()
  await expect(page.getByRole('link', { name: /Ciudad de referencia/ })).toContainText('Valencia')
})

test('si el guardado no llega a la base de datos, se avisa y no cambia', async ({
  page,
  request,
}) => {
  await request.post(`${MOCK}/__seed`, { data: { profileUpdateBlocked: true } })
  await page.goto('/perfil')
  await popupsSwitch(page).click()
  await expect(page.getByText(/No se ha podido guardar la preferencia/)).toBeVisible()
  await expect(popupsSwitch(page)).toHaveAttribute('aria-checked', 'true')

  await page.getByLabel('Nombre').fill('Otro nombre')
  await page.getByRole('button', { name: 'Guardar' }).first().click()
  await expect(page.getByText(/No se ha podido guardar el nombre/)).toBeVisible()
})

test('quitar el compromiso deja «Hoy» sin porcentajes y el historial se puede borrar', async ({
  page,
  request,
}) => {
  const now = new Date()
  const base = {
    user_id: USER_ID,
    minutes_per_week: null,
    by_type: null,
    counts_free_activities: true,
  }
  await request.post(`${MOCK}/__seed`, {
    data: {
      commitments: [
        {
          ...base,
          id: 'c0000000-0000-4000-8000-000000000001',
          valid_from: monday(now, 3),
          valid_to: localKey(new Date(new Date(`${monday(now)}T12:00:00`).getTime() - 86_400_000)),
          sessions_per_week: 2,
        },
        {
          ...base,
          id: 'c0000000-0000-4000-8000-000000000002',
          valid_from: monday(now),
          valid_to: null,
          sessions_per_week: 3,
        },
      ],
    },
  })

  await page.goto('/')
  await expect(page.getByRole('link', { name: /Esta semana/ })).toContainText('0/3')

  await page.goto('/perfil/compromiso')
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Quitar compromiso' }).click()
  await expect(page.getByText('Compromiso quitado')).toBeVisible()
  await expect(page.getByText('Ahora mismo no tienes compromiso')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quitar compromiso' })).toHaveCount(0)

  // Historial: las dos entradas siguen; se borra la antigua.
  const history = page.locator('[data-slot="card"]').filter({ hasText: 'Historial' })
  await expect(history.locator('li')).toHaveCount(2)
  page.once('dialog', (d) => void d.accept())
  await history
    .getByRole('button', { name: /Borrar el compromiso/ })
    .last()
    .click()
  await expect(page.getByText('Compromiso borrado')).toBeVisible()
  await expect(history.locator('li')).toHaveCount(1)

  await page.goto('/')
  await expect(page.getByText('Ahora mismo no tienes compromiso')).toBeVisible()
  await expect(page.getByRole('link', { name: /Esta semana/ })).toHaveCount(0)

  await page.goto('/progreso/cumplimiento')
  await expect(page.getByRole('link', { name: 'Crear un compromiso' })).toBeVisible()
  await expect(page.getByText('Semana en curso')).toHaveCount(0)
})
