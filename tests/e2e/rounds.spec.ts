import { expect, test, type Page } from '@playwright/test'

// Superseries y circuitos por rondas (caso real): «Escribir entreno» con el bloque de 5
// ejercicios × 4 → «✓ Ronda», «Aplicar a las rondas siguientes», «+1 ronda» / «Quitar ronda»
// → 20 series guardadas; después «Registrar entreno pasado» con «Copiar bloque de otra sesión»;
// y «cada lado» en el cronómetro de la plancha lateral.
import { MOCK, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const REAL =
  'plancha lateral 45s/lado + hip thrust 20 + dominadas 5 + plancha 45s + flexiones 25, x4'

type SavedSet = { exercise_id: string; reps: number | null; completed: boolean }
type Saved = {
  session: { id: string; title: string; ended_at: string | null; started_at: string }
  blocks: { config: { exercises: { exercise_id: string; per_side?: boolean }[] } }[]
  sets: SavedSet[]
}

async function login(page: Page) {
  await page.request.post(`${MOCK}/__reset`)
  await page.request.post(`${MOCK}/__seed`, {
    data: { profile: { show_equivalence_popups: false } },
  })
  await page
    .context()
    .addCookies([
      { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
    ])
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })
}

const sessions = async (page: Page): Promise<Saved[]> =>
  (await (await page.request.get(`${MOCK}/__state`)).json()).sessions

async function skipRest(page: Page) {
  await page.getByRole('button', { name: 'Saltar descanso' }).click()
}

test('circuito ×4 escrito en texto, por rondas, y copiado a un entreno pasado', async ({
  page,
}) => {
  await login(page)
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  const title = page.getByRole('textbox', { name: 'Título de la sesión' })
  await title.fill('Circuito core')
  await title.press('Tab')

  // «Escribir entreno»: el parser de la app lo entiende sin IA.
  await page.getByRole('button', { name: 'Escribir entreno' }).click()
  let sheet = page.getByRole('dialog', { name: 'Escribir entreno' })
  await sheet.getByLabel('Escribe el entreno como lo apuntarías en una libreta').fill(REAL)
  await sheet.getByRole('button', { name: 'Interpretar' }).click()
  await expect(sheet.getByTestId('round-item')).toHaveCount(5)
  await expect(sheet.getByTestId('round-item').nth(0)).toContainText('Plancha lateral')
  await expect(sheet.getByTestId('round-item').nth(4)).toContainText('Flexiones')
  await expect(sheet.getByLabel('Rondas', { exact: true })).toHaveValue('4')
  await expect(sheet.getByRole('checkbox', { name: /Cada lado/ }).first()).toBeChecked()
  await shot(page, 'rondas-vista-previa')
  await sheet.getByRole('button', { name: 'Añadir el bloque' }).click()

  const block = page.getByRole('region', { name: 'Bloque A' })
  await expect(block.getByTestId('round-title')).toContainText('4 rondas')
  await expect(block.getByText('Circuito A')).toBeVisible()
  const round = (n: number) => block.getByRole('group', { name: `Ronda ${n} de 4` })
  await expect(round(1)).toBeVisible()
  await expect(round(1).getByRole('button', { name: /^Tiempo \(s\): 0:45/ })).toHaveCount(2)
  await shot(page, 'rondas-sesion')

  // ✓ Ronda: la ronda entera de un toque; arranca el descanso entre rondas.
  await round(1).getByRole('button', { name: 'Completar ronda 1' }).click()
  await expect(page.getByRole('timer').filter({ hasText: 'Descanso' })).toBeVisible()
  await skipRest(page)
  await expect(round(2)).toBeVisible()

  // En la ronda 2 bajan las dominadas a 4 → «Aplicar a las rondas siguientes».
  await round(2)
    .getByRole('button', { name: /^Repeticiones/ })
    .nth(1)
    .click()
  await round(2).getByRole('textbox', { name: 'Repeticiones' }).fill('4')
  await round(2).getByRole('textbox', { name: 'Repeticiones' }).press('Enter')
  await round(2).getByRole('button', { name: 'Aplicar a las rondas siguientes (2)' }).click()

  // +1 ronda y «Quitar ronda».
  await block.getByRole('button', { name: 'Añadir una ronda' }).click()
  await expect(block.getByTestId('round-title')).toContainText('5 rondas')
  await block.getByRole('button', { name: 'Quitar la última ronda' }).click()
  await expect(block.getByTestId('round-title')).toContainText('4 rondas')

  for (const n of [2, 3, 4]) {
    await round(n)
      .getByRole('button', { name: `Completar ronda ${n}` })
      .click()
    await skipRest(page)
  }
  await expect(block.getByTestId('round-title')).toContainText('4 hechas')
  await shot(page, 'rondas-hechas')

  await page.getByRole('button', { name: 'Terminar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page).toHaveURL(/\/entrenar\/historial\//)

  let saved: Saved | undefined
  await expect
    .poll(async () => {
      saved = (await sessions(page)).find((s) => s.session.title === 'Circuito core')
      return saved?.session.ended_at ? saved.sets.filter((s) => s.completed).length : 0
    })
    .toBe(20)
  expect(saved!.sets).toHaveLength(20)
  expect(saved!.sets.filter((s) => s.exercise_id === 'pull_up').map((s) => s.reps)).toEqual([
    5, 4, 4, 4,
  ])
  expect(saved!.blocks[0]!.config.exercises[0]).toMatchObject({
    exercise_id: 'side_plank',
    per_side: true,
  })
  await expect(page.getByText('4 rondas')).toBeVisible()

  // «Registrar entreno pasado» + «Copiar bloque de otra sesión»: el circuito en segundos.
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Registrar entreno pasado' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page.getByTestId('past-badge')).toBeVisible()
  await page.getByRole('button', { name: 'Copiar bloque' }).click()
  sheet = page.getByRole('dialog', { name: 'Copiar bloque de otra sesión' })
  await sheet.getByRole('button', { name: /Circuito core/ }).click()
  await expect(page.getByRole('dialog').getByText(/Circuito · 4 rondas/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir este bloque' }).click()
  const copy = page.getByRole('region', { name: 'Bloque A' })
  await expect(copy.getByTestId('round-title')).toContainText('4 rondas · 0 hechas')
  for (const n of [1, 2, 3, 4]) {
    await copy
      .getByRole('button', { name: `Completar ronda ${n}` })
      .first()
      .click()
  }
  // En un entreno pasado no hay descanso.
  await expect(page.getByRole('button', { name: 'Saltar descanso' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  const finish = page.getByRole('dialog')
  await finish.getByRole('button', { name: '7', exact: true }).click()
  await finish.locator('#duration').fill('35')
  await finish.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect
    .poll(async () => {
      const past = (await sessions(page)).find(
        (s) => s.session.id !== saved!.session.id && s.session.ended_at,
      )
      return past ? past.sets.filter((s) => s.completed).length : 0
    })
    .toBe(20)
})

test('«cada lado»: la plancha lateral hace los dos lados con aviso al cambiar', async ({
  page,
}) => {
  await login(page)
  await page.clock.install()
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await page.getByRole('button', { name: 'Escribir entreno' }).click()
  const sheet = page.getByRole('dialog', { name: 'Escribir entreno' })
  await sheet
    .getByLabel('Escribe el entreno como lo apuntarías en una libreta')
    .fill('plancha lateral 30s/lado + flexiones 10, x2')
  await sheet.getByRole('button', { name: 'Interpretar' }).click()
  await sheet.getByRole('button', { name: 'Añadir el bloque' }).click()

  const round1 = page.getByRole('group', { name: 'Ronda 1 de 2' })
  await round1.getByRole('button', { name: 'Empezar a cronometrar la serie' }).click()
  const timer = round1.getByRole('timer', { name: 'Cuenta atrás de la serie' })
  await expect(timer.getByTestId('hold-side')).toHaveText('Lado 1')
  await page.clock.runFor(31_000)
  await expect(timer.getByTestId('hold-side')).toHaveText('Lado 2')
  await page.clock.runFor(30_000)
  await expect(round1.getByRole('button', { name: 'A1 hecha. Tocar para desmarcar' })).toBeVisible()
  await expect(round1.getByRole('button', { name: /^Tiempo \(s\): 0:30/ })).toBeVisible()
})
