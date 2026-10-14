import { expect, test, type Page } from '@playwright/test'

// Biblioteca ampliada, búsqueda tolerante (plurales, inglés), filtros por tipo, «Crear» con lo
// buscado, serie isométrica cronometrada y entrada de tiempos con vista previa.
import { MOCK, authCookie } from './helpers'

test.beforeEach(async ({ context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
})

const item = (page: Page, name: string) =>
  page.getByRole('button').filter({ hasText: name }).first()

test('búsqueda: plurales, inglés, filtros por tipo y crear con lo buscado', async ({ page }) => {
  await page.goto('/entrenar/ejercicios')
  await expect(page.getByRole('heading', { name: 'Ejercicios' })).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Buscar ejercicio' })

  await search.fill('ZANCADAS')
  await expect(item(page, 'Zancadas')).toBeVisible()
  await search.fill('stairmaster')
  await expect(item(page, 'Escaladora / StairMaster')).toBeVisible()
  await search.fill('pullups')
  await expect(item(page, 'Dominadas')).toBeVisible()

  // Filtro por tipo: máquinas de cardio.
  await search.fill('')
  await page
    .getByRole('group', { name: 'Filtrar por tipo' })
    .getByRole('button', { name: 'Máquinas de cardio' })
    .click()
  await expect(item(page, 'Elíptica')).toBeVisible()
  await expect(item(page, 'Press banca')).toHaveCount(0)
  await page
    .getByRole('group', { name: 'Filtrar por tipo' })
    .getByRole('button', { name: 'Todo' })
    .click()

  // Sin resultados: crear con el nombre ya puesto.
  await search.fill('Patada voladora')
  await expect(
    page.getByText('No hay ningún ejercicio que se llame «Patada voladora».'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Crear «Patada voladora»' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Crear ejercicio' })).toBeVisible()
  await expect(sheet.getByLabel('Nombre')).toHaveValue('Patada voladora')
  await expect(sheet.getByLabel('Descanso')).toHaveValue('1:30')
})

test('sesión: plancha lateral cronometrada y duración con vista previa', async ({ page }) => {
  await page.clock.install()
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)

  await page.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill('side plank')
  await picker.getByRole('button').filter({ hasText: 'Plancha lateral' }).first().click()
  const block = page.getByRole('region', { name: 'Bloque A' })
  await expect(block.getByRole('heading', { name: 'Plancha lateral' })).toBeVisible()

  // El número suelto son segundos: «45» = 45 s, con la vista previa mientras se escribe.
  await block
    .getByRole('button', { name: /^Tiempo \(s\)/ })
    .first()
    .click()
  const input = block.getByRole('textbox', { name: 'Tiempo (s)' })
  await input.fill('45')
  await expect(block.getByText('= 45 s')).toBeVisible()
  await input.fill('1:05')
  await expect(block.getByText('= 1 min 5 s')).toBeVisible()
  await input.fill('45')
  await input.press('Enter')
  await expect(block.getByRole('button', { name: /^Tiempo \(s\): 0:45/ }).first()).toBeVisible()

  // ▶: cuenta atrás desde 45 s; al acabar se completa la serie y arranca el descanso.
  await block.getByRole('button', { name: 'Empezar a cronometrar la serie' }).first().click()
  await expect(block.getByRole('timer', { name: 'Cuenta atrás de la serie' })).toBeVisible()
  await page.clock.runFor(46_000)
  await expect(block.getByRole('button', { name: '1 hecha. Tocar para desmarcar' })).toBeVisible()
  await expect(page.getByRole('timer').filter({ hasText: 'Descanso' })).toBeVisible()

  // Terminar: «25:30» = 25 min 30 s y se guarda como 26 min.
  await page.getByRole('button', { name: 'Terminar' }).click()
  const finish = page.getByRole('dialog')
  await finish.getByRole('button', { name: '7', exact: true }).click()
  const duration = finish.getByLabel('Duración')
  await duration.fill('25:30')
  await expect(finish.getByText('= 25 min 30 s')).toBeVisible()
  await expect(finish.getByText('Se guarda como 26 min.')).toBeVisible()
  await duration.fill('1h05')
  await expect(finish.getByText('= 1 h 5 min')).toBeVisible()
  await finish.getByRole('button', { name: '45 min' }).click()
  await expect(duration).toHaveValue('45')
  await finish.getByRole('button', { name: 'Más 5 min' }).click()
  await expect(duration).toHaveValue('50')
  await expect(finish.getByRole('button', { name: 'Guardar sesión' })).toBeEnabled()
  await duration.fill('25 30')
  await expect(finish.getByText(/Escribe minutos/)).toBeVisible()
  await expect(finish.getByRole('button', { name: 'Guardar sesión' })).toBeDisabled()
})
