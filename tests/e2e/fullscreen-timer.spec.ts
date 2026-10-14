import { expect, test, type Page } from '@playwright/test'

// Usabilidad 2/3: cronómetro a pantalla completa (EMOM de 10 min en horizontal, tocar = pausa,
// +15 s, saltar, giro a vertical) y la herramienta «Cronómetro» (AMRAP con «+1 ronda»,
// intervalos personalizados con favoritos y «Guardar como sesión»).
// Reloj del navegador simulado y PARADO mientras corre el temporizador (como timers.spec.ts).
import { MOCK, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS

type SavedState = {
  sessions: {
    session: { ended_at: string | null; session_type: string; duration_min: number; rpe: number }
    blocks: { block_type: string; result: Record<string, unknown> | null }[]
  }[]
}

async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1000)
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
  await page.clock.install()
})

test('EMOM de 10 min a pantalla completa en horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Functional/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)

  await page.getByRole('button', { name: 'Añadir bloque con temporizador' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: /EMOM/ }).click()
  await sheet.getByLabel('Rondas (minutos)').fill('10')
  await sheet.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const picker = page.getByRole('dialog').last()
  await picker.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill('kettlebell swing')
  await picker.getByRole('button').filter({ hasText: 'Kettlebell swing' }).first().click()
  await sheet.getByLabel('Repeticiones de Kettlebell swing').fill('15')
  await sheet.getByRole('button', { name: 'Crear bloque' }).click()

  const block = page.getByRole('region', { name: 'Bloque A' })
  await expect(block.getByLabel('Abrir a pantalla completa al empezar')).toBeChecked()
  await pauseClock(page)
  await block.getByRole('button', { name: 'Empezar con cuenta atrás de 10 segundos' }).click()

  // Se abre sola, en la fase de preparación.
  const full = page.getByRole('dialog', { name: 'EMOM a pantalla completa' })
  await expect(full).toBeVisible()
  await expect(full).toHaveAttribute('data-phase', 'prep')
  await expect(full).toContainText('Prepárate')
  await expect(full).toContainText('Siguiente: 15 × Kettlebell swing')

  // 40 s: minuto 1, 0:30, trabajo.
  await page.clock.fastForward(40_000)
  await expect(full).toHaveAttribute('data-phase', 'work')
  await expect(full).toContainText('Minuto 1/10')
  const clock = full.getByRole('timer')
  await expect(clock).toHaveText('0:30')
  await expect(full).toContainText('15 × Kettlebell swing')

  // Dígitos enormes que caben en la pantalla.
  const box = (await clock.locator('span').boundingBox())!
  expect(box.height).toBeGreaterThan(150)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(844)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/emom-horizontal.png` })

  // Tocar en cualquier sitio = pausa; el tiempo no corre; otro toque = continuar.
  await clock.click()
  await expect(full).toHaveAttribute('data-phase', 'paused')
  await expect(full).toContainText('Toca la pantalla para continuar')
  await page.clock.fastForward(20_000)
  await expect(clock).toHaveText('0:30')
  await clock.click()
  await expect(full).toHaveAttribute('data-phase', 'work')

  // +15 s no pausa; saltar pasa al minuto 2.
  await full.getByRole('button', { name: 'Sumar 15 segundos' }).click()
  await expect(clock).toHaveText('0:45')
  await expect(full).toHaveAttribute('data-phase', 'work')
  await full.getByRole('button', { name: 'Saltar fase' }).click()
  await expect(full).toContainText('Minuto 2/10')
  await expect(clock).toHaveText('1:00')

  // En vertical también cabe.
  await page.setViewportSize({ width: 390, height: 844 })
  const portrait = (await clock.locator('span').boundingBox())!
  expect(portrait.x + portrait.width).toBeLessThanOrEqual(390)
  expect(portrait.height).toBeGreaterThan(110)
  await page.setViewportSize({ width: 844, height: 390 })

  // Salir y volver a entrar.
  await full.getByRole('button', { name: 'Salir de pantalla completa' }).click()
  await expect(full).toHaveCount(0)
  await expect(block.getByRole('timer')).toContainText('Minuto 2 de 10')
  await block.getByRole('button', { name: 'Pantalla completa' }).click()
  await expect(full).toBeVisible()

  // Hasta el final: se cierra sola y el bloque queda terminado.
  await page.clock.fastForward(10 * 60_000)
  await expect(full).toHaveCount(0)
  await expect(block.getByText('EMOM terminado')).toBeVisible()
  await expect(block.getByText('10 de 10 minutos')).toBeVisible()
})

test('Cronómetro: AMRAP con «+1 ronda», intervalos favoritos y guardar como sesión', async ({
  page,
  request,
}) => {
  await page.goto('/entrenar')
  await page.getByRole('link', { name: /Cronómetro/ }).click()
  await expect(page.getByRole('heading', { name: 'Cronómetro' })).toBeVisible()

  // AMRAP de 1 minuto: botón enorme «+1 ronda» a pantalla completa.
  await page.getByRole('button', { name: 'AMRAP', exact: true }).click()
  await page.getByLabel('Duración').fill('1')
  await pauseClock(page)
  await page.getByRole('button', { name: 'Empezar sin cuenta atrás' }).click()
  const full = page.getByRole('dialog', { name: /a pantalla completa/ })
  await expect(full).toBeVisible()
  await full.getByRole('button', { name: 'Sumar una ronda' }).click()
  await full.getByRole('button', { name: 'Sumar una ronda' }).click()
  await expect(full).toContainText('2 rondas')
  // «+1 ronda» no pausa.
  await expect(full).toHaveAttribute('data-phase', 'work')
  await page.clock.fastForward(61_000)
  await expect(full).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Resultado' })).toContainText('2 rondas')
  await page.getByRole('button', { name: 'Cerrar' }).click()

  // Intervalos personalizados: Sentadilla 30 s + descanso 15 s × 2 rondas, guardado en favoritos.
  await page.clock.resume()
  await page.getByRole('button', { name: 'Intervalos', exact: true }).click()
  await page.getByLabel('Nombre').first().fill('Sentadilla')
  await page.locator('#step-0-duration').fill('30')
  await page.locator('#step-1-duration').fill('15')
  await page.getByRole('textbox', { name: 'Rondas' }).fill('2')
  await expect(page.getByText('Intervalos: Sentadilla 0:30 + Descanso 0:15 × 2')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar como favorito' }).click()
  await page.getByLabel('Nombre del favorito').fill('Piernas exprés')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('«Piernas exprés» guardado en favoritos')).toBeVisible()

  // Tras recargar sigue en favoritos y se carga con un toque.
  await page.reload()
  await page.getByRole('button', { name: 'Tabata', exact: true }).click()
  await page.getByRole('button', { name: /^Piernas exprés/ }).click()
  await expect(page.getByRole('button', { name: 'Intervalos', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('#step-0-duration')).toHaveValue('30')

  await pauseClock(page)
  await page.getByRole('button', { name: 'Empezar sin cuenta atrás' }).click()
  await expect(full).toBeVisible()
  await expect(full).toContainText('Ronda 1/2')
  await expect(full).toContainText('Sentadilla')
  await expect(full).toContainText('Siguiente: Descanso · 0:15')
  await page.clock.fastForward(35_000)
  await expect(full).toHaveAttribute('data-phase', 'rest')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/intervalos-descanso.png` })
  // Ronda 2 y fin (30 + 15 + 30 = 75 s).
  await page.clock.fastForward(45_000)
  await expect(full).toHaveCount(0)
  const result = page.getByRole('region', { name: 'Resultado' })
  await expect(result).toContainText('Tiempo total: 1:15')

  // Guardar como sesión.
  await page.clock.resume()
  await page.getByRole('button', { name: 'Guardar como sesión' }).click()
  const save = page.getByRole('dialog', { name: 'Guardar como sesión' })
  await expect(save.getByRole('button', { name: 'Functional' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await save.getByRole('button', { name: '7', exact: true }).click()
  await save.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page).toHaveURL(/\/entrenar\/historial\//)
  await expect(page.getByText('¡Sesión guardada! 💪')).toBeVisible()

  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as SavedState
      return s.sessions.find((x) => x.session.ended_at)?.session.session_type ?? null
    })
    .toBe('functional')
  const s = (await (await request.get(`${MOCK}/__state`)).json()) as SavedState
  const saved = s.sessions.find((x) => x.session.ended_at)!
  expect(saved.session).toMatchObject({ duration_min: 1, rpe: 7 })
  expect(saved.blocks[0]).toMatchObject({
    block_type: 'free',
    result: { kind: 'free', elapsed_s: 75 },
  })
})
