import { expect, test, type Page } from '@playwright/test'

// Usabilidad 3/3: series más rápidas (deslizar para completar o borrar con «Deshacer»,
// superserie con «Unir con el siguiente»), «Guardar como plantilla», «Repetir» y «Mis
// plantillas»; feedback desde el menú ⋯ y su pantalla de admin; consejos de primera vez.
import { MOCK, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function login(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
    ])
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })
}

const state = async (page: Page) => (await page.request.get(`${MOCK}/__state`)).json()

async function addExercise(page: Page, search: string, name: string) {
  await page.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill(search)
  await dialog.getByRole('button').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function swipe(page: Page, row: ReturnType<Page['locator']>, dx: number) {
  const box = (await row.boundingBox())!
  const y = box.y + box.height / 2
  const x = box.x + box.width / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y)
  await page.mouse.up()
}

test('deslizar, superserie, plantilla y repetir con los pesos sugeridos', async ({ page }) => {
  await page.request.post(`${MOCK}/__reset`)
  // Sin pop-up de logros al terminar (no es lo que se prueba aquí).
  await page.request.post(`${MOCK}/__seed`, {
    data: { profile: { show_equivalence_popups: false } },
  })
  await login(page)
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  // Sin historial ni plantillas no hay atajos.
  await expect(page.getByRole('dialog').getByText('Repetir último entreno')).toHaveCount(0)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)

  await addExercise(page, 'press banca', 'Press banca')
  const a = page.getByRole('region', { name: 'Bloque A' })
  await a
    .getByRole('button', { name: /^Peso \(kg\)/ })
    .first()
    .click()
  await a.getByRole('textbox', { name: 'Peso (kg)' }).fill('60')
  await a.getByRole('textbox', { name: 'Peso (kg)' }).press('Enter')
  await a
    .getByRole('button', { name: /^Repeticiones/ })
    .first()
    .click()
  await a.getByRole('textbox', { name: 'Repeticiones' }).fill('8')
  await a.getByRole('textbox', { name: 'Repeticiones' }).press('Enter')

  // Deslizar a la derecha completa la serie (y arranca el descanso).
  const rows = a.locator('[data-set-row]')
  await swipe(page, rows.nth(0), 160)
  await expect(a.getByRole('button', { name: '1 hecha. Tocar para desmarcar' })).toBeVisible()
  await page.getByRole('button', { name: 'Saltar descanso' }).click()

  // Deslizar a la izquierda borra, con «Deshacer».
  await swipe(page, rows.nth(2), -160)
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(rows).toHaveCount(3)

  // Superserie con «Unir con el siguiente».
  await addExercise(page, 'remo con barra', 'Remo con barra')
  await page.getByRole('button', { name: 'Opciones de Press banca' }).click()
  await page.getByRole('button', { name: 'Unir con el siguiente (superserie)' }).click()
  await expect(a.getByText('Superserie A')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Bloque B' })).toHaveCount(0)
  await shot(page, 'u3-sesion-superserie')

  // La superserie se registra por rondas: completa el resto con «✓ Ronda» y termina.
  for (const n of [1, 2, 3]) {
    await a
      .getByRole('button', { name: `Completar ronda ${n}` })
      .first()
      .click()
    await page.getByRole('button', { name: 'Saltar descanso' }).click()
  }
  await page.getByRole('button', { name: 'Terminar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page).toHaveURL(/\/entrenar\/historial\//)

  // Guardar como plantilla.
  await page.getByRole('button', { name: 'Guardar como plantilla' }).click()
  await page.getByLabel('Nombre').fill('Torso rápido')
  await page.getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect.poll(async () => (await state(page)).templateRows.length).toBe(1)
  const saved = (await state(page)).templateRows[0]
  expect(saved.name).toBe('Torso rápido')
  expect(JSON.stringify(saved.structure)).not.toContain('weight')

  // «Repetir» desde el historial: misma estructura, pesos sugeridos.
  await page.goto('/entrenar')
  await page
    .getByRole('button', { name: /^Repetir «/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  const again = page.getByRole('region', { name: 'Bloque A' })
  await expect(again.getByText('Superserie A')).toBeVisible()
  await expect(again.getByText('Remo con barra', { exact: true })).toBeVisible()
  await expect(again.getByRole('button', { name: /^Peso \(kg\).*60/ }).first()).toBeVisible()
  await shot(page, 'u3-repetir')

  // Descartar y mirar los atajos de «Empezar entreno».
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Descartar sesión' }).click()
  await expect(page).toHaveURL(/\/entrenar$/)
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Repetir último entreno')).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'Mis plantillas' })).toContainText('Torso rápido')
  await shot(page, 'u3-empezar')
  await sheet
    .getByRole('button', { name: /Torso rápido/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(page.getByRole('textbox', { name: 'Título de la sesión' })).toHaveValue(
    'Torso rápido',
  )
})

test('feedback desde el menú ⋯ y pantalla de admin', async ({ page }) => {
  await page.request.post(`${MOCK}/__reset`)
  await page.request.post(`${MOCK}/__seed`, { data: { profile: { role: 'admin' } } })
  await login(page)
  await page.goto('/progreso')
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.getByRole('button', { name: 'Enviar feedback' }).click()
  const dialog = page.getByRole('dialog', { name: 'Enviar feedback' })
  await dialog.getByRole('radio', { name: /Fallo/ }).click()
  await dialog.getByLabel('¿Qué ha pasado o qué cambiarías?').fill('La gráfica no carga')
  await shot(page, 'u3-feedback')
  await dialog.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(async () => (await state(page)).feedbackRows.length).toBe(1)
  const row = (await state(page)).feedbackRows[0]
  expect(row).toMatchObject({ kind: 'bug', message: 'La gráfica no carga', route: '/progreso' })
  expect(row.device).toMatch(/×/)

  await page.goto('/perfil')
  await page.getByRole('link', { name: 'Feedback recibido' }).click()
  await expect(page.getByText('La gráfica no carga')).toBeVisible()
  await page.getByRole('button', { name: 'Exportar como texto' }).click()
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(
    /\[Fallo\] Nuevo[\s\S]*Pantalla: \/progreso[\s\S]*> La gráfica no carga/,
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).first().click()
  await page.getByRole('button', { name: 'Hecho', exact: true }).click()
  await expect.poll(async () => (await state(page)).feedbackRows[0].status).toBe('done')
  await shot(page, 'u3-admin-feedback')
})

test('consejo de primera vez: se cierra y no vuelve; «Cómo funciona» los restablece', async ({
  page,
}) => {
  await page.request.post(`${MOCK}/__reset`)
  await login(page)
  await page.goto('/')
  const tip = page.getByRole('complementary', { name: 'Consejo: Tu día de un vistazo' })
  await expect(tip).toBeVisible()
  await shot(page, 'u3-hoy')
  await tip.getByRole('button', { name: 'Entendido, no volver a mostrar' }).click()
  await expect(tip).toHaveCount(0)
  await expect.poll(async () => (await state(page)).dismissedTips).toContain('today')
  await page.reload()
  await expect(page.getByRole('heading', { name: /Hola/ })).toBeVisible()
  await expect(tip).toHaveCount(0)

  await page.goto('/perfil/ayuda')
  await page.getByText('Registrar una sesión').click()
  await expect(page.getByText(/desliza la serie a la derecha/)).toBeVisible()
  await page.getByRole('button', { name: 'Volver a ver los consejos' }).click()
  await expect.poll(async () => (await state(page)).dismissedTips).toEqual([])
  await page.goto('/')
  await expect(tip).toBeVisible()
})
