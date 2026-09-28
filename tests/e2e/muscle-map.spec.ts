import { expect, test, type Page } from '@playwright/test'

// Criterio de aceptación de la Fase 4: una sesión de pierna colorea cuádriceps, glúteo e
// isquios, y una carrera de 30 min suma su parte aproximada (también gemelos).
import { MOCK, authCookie } from './helpers'

const LEG = 'cccccccc-0000-4000-8000-000000000001'
const RUN = 'cccccccc-0000-4000-8000-000000000002'
const SHOTS = process.env.E2E_SCREENSHOTS

function session(
  id: string,
  type: string,
  start: Date,
  minutes: number,
  sets: { exercise: string; weight?: number; reps?: number; distance?: number; warmup?: boolean }[],
) {
  return {
    session: {
      id,
      session_type: type,
      title: type === 'running' ? 'Carrera' : 'Pierna',
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
      duration_min: minutes,
      rpe: 7,
      distance_m: sets.reduce((a, s) => a + (s.distance ?? 0), 0) || null,
      client_rev: 1,
    },
    blocks: [],
    sets: sets.map((s, i) => ({
      id: `${id.slice(0, 24)}${String(i).padStart(12, '0')}`,
      exercise_id: s.exercise,
      set_index: i,
      is_warmup: s.warmup ?? false,
      weight_kg: s.weight ?? null,
      reps: s.reps ?? null,
      distance_m: s.distance ?? null,
      completed: true,
    })),
  }
}

const level = (page: Page, view: number, muscle: string) =>
  page.locator('figure').nth(view).locator(`path[data-muscle="${muscle}"]`)

test('pierna + carrera de 30 min colorean el mapa y el detalle muestra qué aporta', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  // Hoy, un rato antes (sin salir del día para que caiga en la semana en curso).
  const start = new Date()
  start.setHours(Math.max(0, start.getHours() - 3), 0, 0, 0)
  const saves = [
    session(LEG, 'strength', start, 60, [
      { exercise: 'back_squat', weight: 40, reps: 10, warmup: true },
      ...Array.from({ length: 4 }, () => ({ exercise: 'back_squat', weight: 80, reps: 8 })),
      ...Array.from({ length: 3 }, () => ({ exercise: 'romanian_deadlift', weight: 70, reps: 10 })),
      ...Array.from({ length: 3 }, () => ({ exercise: 'leg_curl', weight: 40, reps: 12 })),
    ]),
    session(RUN, 'running', new Date(start.getTime() + 90 * 60_000), 30, [
      { exercise: 'run', distance: 5000 },
    ]),
  ]
  for (const payload of saves) {
    await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, { data: { payload } })
  }
  // Capturas a 375 px (el ancho más estrecho que se quiere soportar).
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])

  await page.goto('/progreso/musculos')
  // Frente (0): cuádriceps 4 + 2 aprox. = 6 → nivel 2; pectoral sin series.
  await expect(level(page, 0, 'quads')).toHaveAttribute('data-level', '2')
  await expect(level(page, 0, 'chest')).toHaveAttribute('data-level', '0')
  // Espalda (1): glúteo 4 + 3 + 2 = 9 → 2; isquios 3 + 3 + 2 = 8 → 2; gemelos solo carrera 2 → 1.
  await expect(level(page, 1, 'glutes')).toHaveAttribute('data-level', '2')
  await expect(level(page, 1, 'hamstrings')).toHaveAttribute('data-level', '2')
  await expect(level(page, 1, 'calves')).toHaveAttribute('data-level', '1')
  await expect(level(page, 1, 'lats')).toHaveAttribute('data-level', '0')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/map.png`, fullPage: true })

  // Tocar el cuádriceps: número exacto y lo que lo aporta (incluida la carrera, aproximada).
  // (El path tiene las dos piernas: el centro de su caja cae entre ellas, así que se toca el
  // borde izquierdo; con teclado también se abre.)
  const box = (await level(page, 0, 'quads').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.5)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Cuádriceps')
  await expect(dialog).toContainText('6')
  await expect(dialog).toContainText('Sentadilla con barra')
  await expect(dialog).toContainText('4 series · principal (×1)')
  await expect(dialog).toContainText('Carrera')
  await expect(dialog).toContainText('(aproximado)')
  await expect(dialog).toContainText('1 sesión · 30 min')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/detail.png` })
  await dialog.getByRole('button', { name: 'Cerrar' }).last().click()

  // Tabla con comparación frente a la semana anterior (vacía → +N).
  const row = page.locator('tr').filter({ hasText: 'Gemelos' })
  await expect(row).toContainText('≈2 aprox.')
  await expect(row).toContainText('+2')

  // Mini mapa en el resumen de la carrera: solo su parte aproximada.
  await page.goto(`/entrenar/historial/${RUN}`)
  const card = page.locator('[data-slot="card"]').filter({ hasText: 'Músculos trabajados' })
  await expect(card.locator('figure').nth(0).locator('path[data-muscle="quads"]')).toHaveAttribute(
    'data-level',
    '1',
  )
  await expect(card).toContainText('parte aproximada')
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/mini.png` })

  // Carga: con menos de 4 semanas de datos no se da un ratio engañoso.
  await page.goto('/progreso/carga')
  await expect(page.getByText(/Datos insuficientes/)).toBeVisible()
  await expect(page.getByText('Últimos 7 días', { exact: true })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/load.png`, fullPage: true })

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/progreso/musculos')
    await expect(level(page, 0, 'quads')).toHaveAttribute('data-level', '2')
    await page.screenshot({ path: `${SHOTS}/map-dark.png`, fullPage: true })
  }
})
