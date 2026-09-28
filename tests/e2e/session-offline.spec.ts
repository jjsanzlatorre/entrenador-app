import { expect, test, type Page } from '@playwright/test'

// Criterio de aceptación de la Fase 1: registrar un entreno de 5 ejercicios × 3 series
// en modo avión (incluido cerrar y reabrir la app sin conexión) y ver que se sincroniza
// al volver la conexión.
const MOCK = 'http://localhost:54321'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function authCookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, exp, role: 'authenticated', aud: 'authenticated' })}.sig`
  const session = {
    access_token: jwt,
    refresh_token: 'refresh',
    expires_at: exp,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: USER_ID, email: 'e2e@test.dev' },
  }
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
}

const EXERCISES = [
  { search: 'press banca', name: 'Press banca', kg: '60', reps: '8' },
  { search: 'sentadilla con barra', name: 'Sentadilla con barra', kg: '80', reps: '6' },
  { search: 'remo con barra', name: 'Remo con barra', kg: '50', reps: '10' },
  { search: 'press militar', name: 'Press militar', kg: '32,5', reps: '8' },
  { search: 'curl de biceps', name: 'Curl de bíceps', kg: '12', reps: '12' },
]

async function addExercise(page: Page, search: string, name: string) {
  await page.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill(search)
  await dialog.getByRole('button').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function logExercise(page: Page, blockIndex: number, kg: string, reps: string) {
  const block = page.getByRole('region', { name: `Bloque ${'ABCDE'[blockIndex]}` })
  await block
    .getByRole('button', { name: /^Peso \(kg\)/ })
    .first()
    .click()
  await block.getByRole('textbox', { name: 'Peso (kg)' }).fill(kg)
  await block.getByRole('textbox', { name: 'Peso (kg)' }).press('Enter')
  await block
    .getByRole('button', { name: /^Repeticiones/ })
    .first()
    .click()
  await block.getByRole('textbox', { name: 'Repeticiones' }).fill(reps)
  await block.getByRole('textbox', { name: 'Repeticiones' }).press('Enter')
  for (const n of [1, 2, 3]) {
    // Un toque por serie: los valores ya están precargados.
    await block.getByRole('button', { name: `Completar ${n}` }).click()
    await expect(
      block.getByRole('button', { name: `${n} hecha. Tocar para desmarcar` }),
    ).toBeVisible()
    const skip = page.getByRole('button', { name: 'Saltar descanso' })
    await expect(skip).toBeVisible()
    await skip.click()
  }
}

test('registrar 5 ejercicios × 3 series en modo avión y sincronizar al volver', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])

  await page.goto('/entrenar')
  await expect(page.getByRole('heading', { name: 'Entrenar' })).toBeVisible()

  // Espera a que el service worker controle la página y haya guardado las páginas offline.
  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker.controller) return false
      const keys = await caches.keys()
      const pages = keys.find((k) => k.startsWith('pages-'))
      if (!pages) return false
      return Boolean(await (await caches.open(pages)).match('/entrenar/sesion'))
    },
    undefined,
    { timeout: 30_000 },
  )

  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Fuerza/ }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)

  // Dos ejercicios con conexión.
  for (const [i, ex] of EXERCISES.slice(0, 2).entries()) {
    await addExercise(page, ex.search, ex.name)
    await logExercise(page, i, ex.kg, ex.reps)
  }
  await expect(page.getByRole('button', { name: 'Sincronización: Guardado' })).toBeVisible({
    timeout: 15_000,
  })

  // Modo avión.
  await context.setOffline(true)
  await expect(page.getByRole('button', { name: 'Sincronización: Sin conexión' })).toBeVisible()
  const savesBeforeOffline = (await (await request.get(`${MOCK}/__state`)).json())
    .saveCalls as number

  await addExercise(page, EXERCISES[2]!.search, EXERCISES[2]!.name)
  await logExercise(page, 2, EXERCISES[2]!.kg, EXERCISES[2]!.reps)

  // Se cierra y reabre la app sin conexión: la sesión sigue ahí.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Remo con barra', exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    page
      .getByRole('region', { name: 'Bloque C' })
      .getByRole('button', { name: '3 hecha. Tocar para desmarcar' }),
  ).toBeVisible()

  for (const [j, ex] of EXERCISES.slice(3).entries()) {
    await addExercise(page, ex.search, ex.name)
    await logExercise(page, 3 + j, ex.kg, ex.reps)
  }

  // Terminar sin conexión.
  await page.getByRole('button', { name: 'Terminar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page.getByText('¡Sesión guardada! 💪')).toBeVisible()
  await expect(
    page.getByText('Guardada en el móvil. Se subirá sola en cuanto haya conexión.'),
  ).toBeVisible()
  await expect(page.getByText('Músculos trabajados')).toBeVisible()

  // Nada ha llegado al servidor mientras no había conexión.
  const offlineState = await (await request.get(`${MOCK}/__state`)).json()
  expect(offlineState.saveCalls).toBe(savesBeforeOffline)

  // Vuelve la conexión: se sincroniza sola.
  await context.setOffline(false)
  await expect
    .poll(
      async () => {
        const state = (await (await request.get(`${MOCK}/__state`)).json()) as {
          sessions: {
            session: { ended_at: string | null; rpe: number }
            sets: { exercise_id: string; completed: boolean; weight_kg: number }[]
          }[]
        }
        const s = state.sessions[0]
        if (!s?.session.ended_at) return null
        return {
          rpe: s.session.rpe,
          exercises: new Set(s.sets.map((x) => x.exercise_id)).size,
          completed: s.sets.filter((x) => x.completed).length,
          militar: s.sets.find((x) => x.exercise_id === 'overhead_press')?.weight_kg,
        }
      },
      { timeout: 30_000 },
    )
    .toEqual({ rpe: 8, exercises: 5, completed: 15, militar: 32.5 })

  // El historial la muestra ya sincronizada.
  await page.goto('/entrenar')
  const item = page.getByRole('link', { name: /Entreno libre/ })
  await expect(item).toBeVisible()
  await expect(item.getByLabel('Pendiente de sincronizar')).toHaveCount(0)
})
