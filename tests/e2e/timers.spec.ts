import { expect, test, type Page } from '@playwright/test'
import { MOCK, authCookie } from './helpers'

// Criterio de aceptación de la Fase 2: completar un EMOM de 12 min y un 6×400 m con la
// pantalla bloqueada a ratos (y la app cerrada una vez); los tiempos cuadran.
//
// El reloj del navegador está simulado: «bloquear la pantalla» = pasar a segundo plano y
// adelantar el reloj sin que se ejecuten los ticks intermedios.

type SavedState = {
  sessions: {
    session: { ended_at: string | null; distance_m: number | null; session_type: string }
    blocks: { block_type: string; result: Record<string, unknown> | null }[]
    sets: {
      block_id: string
      exercise_id: string
      completed: boolean
      reps: number | null
      distance_m: number | null
      duration_s: number | null
    }[]
  }[]
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function lockScreen(page: Page, ms: number) {
  await setVisibility(page, 'hidden')
  await page.clock.fastForward(ms)
  await setVisibility(page, 'visible')
}

async function startSession(page: Page, type: RegExp) {
  await page.goto('/entrenar')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page.getByRole('dialog').getByRole('button', { name: type }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
}

async function finishSession(page: Page) {
  await page.getByRole('button', { name: 'Terminar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page.getByText('¡Sesión guardada! 💪')).toBeVisible()
}

async function savedSession(page: Page) {
  let saved: SavedState['sessions'][number] | undefined
  await expect
    .poll(
      async () => {
        const state = (await (await page.request.get(`${MOCK}/__state`)).json()) as SavedState
        saved = state.sessions.find((s) => s.session.ended_at)
        return Boolean(saved)
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  return saved!
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
  await page.clock.install()
})

test('EMOM de 12 minutos con la pantalla bloqueada a ratos', async ({ page }) => {
  await startSession(page, /Functional/)

  await page.getByRole('button', { name: 'Añadir bloque con temporizador' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: /EMOM/ }).click()
  await expect(sheet.getByLabel('Rondas (minutos)')).toHaveValue('12')
  await sheet.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const picker = page.getByRole('dialog').last()
  await picker.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill('kettlebell swing')
  await picker.getByRole('button').filter({ hasText: 'Kettlebell swing' }).first().click()
  await sheet.getByLabel('Repeticiones de Kettlebell swing').fill('15')
  await sheet.getByRole('button', { name: 'Crear bloque' }).click()

  const block = page.getByRole('region', { name: 'Bloque A' })
  const timer = block.getByRole('timer')
  await block.getByRole('button', { name: 'Empezar con cuenta atrás de 10 segundos' }).click()
  await expect(timer).toContainText('Prepárate')

  // 40 s: 10 s de preparación + 30 s del primer minuto.
  await lockScreen(page, 40_000)
  await expect(timer).toContainText('Minuto 1 de 12')
  await expect(timer).toContainText(/0:(29|30)/)
  await expect(timer).toContainText('15 × Kettlebell swing')

  // Pantalla bloqueada 4 min → t = 4:40 → minuto 5.
  await lockScreen(page, 240_000)
  await expect(timer).toContainText('Minuto 5 de 12')
  await expect(timer).toContainText(/0:(29|30)/)

  // La app se cierra 2 min y se vuelve a abrir → t = 6:40 → minuto 7.
  await page.clock.fastForward(120_000)
  await page.reload()
  await expect(timer).toContainText('Minuto 7 de 12', { timeout: 20_000 })
  await expect(timer).toContainText(/0:(29|30)/)

  // Pantalla bloqueada hasta pasado el final (12:10): el bloque se cierra solo.
  await lockScreen(page, 7 * 60_000)
  await expect(block.getByText('EMOM terminado')).toBeVisible()
  await expect(block.getByText('12 de 12 minutos')).toBeVisible()

  await finishSession(page)
  const saved = await savedSession(page)
  expect(saved.blocks).toHaveLength(1)
  expect(saved.blocks[0]).toMatchObject({
    block_type: 'emom',
    result: { kind: 'emom', minutes: 12, minutes_completed: 12 },
  })
  expect(saved.sets).toHaveLength(12)
  expect(saved.sets.every((s) => s.completed && s.reps === 15)).toBe(true)
})

test('6×400 m con recuperación de 90 s y la pantalla bloqueada a ratos', async ({ page }) => {
  await startSession(page, /Carrera/)

  // La carrera empieza con un bloque continuo (A); se añaden las series (B).
  await page.getByRole('button', { name: 'Añadir bloque con temporizador' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: /Intervalos/ }).click()
  await expect(sheet.getByLabel('Series')).toHaveValue('6')
  await expect(sheet.getByLabel('Distancia por serie')).toHaveValue('400')
  await expect(sheet.getByLabel('Recuperación')).toHaveValue('90')
  await expect(sheet.getByRole('button', { name: 'Carrera', pressed: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Crear bloque' }).click()

  const block = page.getByRole('region', { name: 'Bloque B' })
  const timer = block.getByRole('timer')
  await block.getByRole('button', { name: 'Empezar sin cuenta atrás' }).click()

  // Cada 400 m en 88 s (3:40/km) con la pantalla bloqueada mientras se corre. El reloj
  // simulado sigue avanzando en tiempo real entre pasos: margen de 1–2 s.
  for (let rep = 1; rep <= 6; rep++) {
    await expect(timer).toContainText(`Serie ${rep} de 6 · 400 m`)
    await lockScreen(page, 88_000)
    await expect(timer).toContainText(/1:(2[89]|30)/)
    await block.getByRole('button', { name: 'Vuelta hecha' }).click()
    if (rep === 6) break
    await expect(timer).toContainText(`Recuperación ${rep} de 6`)
    if (rep === 3) {
      // A mitad de la recuperación se cierra la app; al volver sigue en su sitio.
      await page.clock.fastForward(45_000)
      await page.reload()
      await expect(timer).toContainText('Recuperación 3 de 6', { timeout: 20_000 })
      await expect(timer).toContainText(/0:4[45]/)
      await lockScreen(page, 45_000)
    } else {
      await lockScreen(page, 91_000)
    }
  }

  await expect(block.getByText('Intervalos terminado')).toBeVisible()
  await expect(block.getByText('6 series', { exact: true })).toBeVisible()

  await finishSession(page)
  const saved = await savedSession(page)
  expect(saved.session.session_type).toBe('running')
  expect(saved.session.distance_m).toBe(2400)
  const intervals = saved.blocks.find((b) => b.block_type === 'intervals')
  const splits = intervals?.result?.splits as { distance_m: number; duration_s: number }[]
  expect(splits).toHaveLength(6)
  for (const s of splits) {
    expect(s.distance_m).toBe(400)
    expect(s.duration_s).toBeGreaterThanOrEqual(88)
    expect(s.duration_s).toBeLessThanOrEqual(90)
  }
  const runSets = saved.sets.filter((s) => s.completed && s.distance_m === 400)
  expect(runSets).toHaveLength(6)
})
