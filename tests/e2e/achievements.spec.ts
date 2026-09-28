import { expect, test, type Page } from '@playwright/test'

// Criterio de aceptación de la Fase 3B: al superar el tonelaje (o la distancia) de un objeto o
// destino del catálogo aparece el pop-up una sola vez; y el resumen del mes al abrir la app.
import { MOCK, authCookie } from './helpers'

const OLD_STRENGTH = 'bbbbbbbb-0000-4000-8000-000000000001'
const NEW_STRENGTH = 'bbbbbbbb-0000-4000-8000-000000000002'
const OLD_RUN = 'bbbbbbbb-0000-4000-8000-000000000003'
const NEW_RUN = 'bbbbbbbb-0000-4000-8000-000000000004'

function session(
  id: string,
  type: string,
  start: Date,
  sets: { exercise: string; weight?: number; reps?: number; distance?: number }[],
  distanceM: number | null = null,
) {
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    session: {
      id,
      session_type: type,
      title: type,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      duration_min: 60,
      rpe: 7,
      distance_m: distanceM,
      client_rev: 1,
    },
    blocks: [],
    sets: sets.map((s, i) => ({
      id: `${id.slice(0, 24)}${String(i).padStart(12, '0')}`,
      exercise_id: s.exercise,
      set_index: i,
      is_warmup: false,
      weight_kg: s.weight ?? null,
      reps: s.reps ?? null,
      distance_m: s.distance ?? null,
      completed: true,
    })),
  }
}

async function dialogShownOnce(page: Page, url: string, text: RegExp) {
  await page.goto(url)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(text)
  await dialog.getByRole('button', { name: 'Cerrar' }).last().click()
  await expect(dialog).toHaveCount(0)
  // Al volver a abrir la misma pantalla ya no aparece.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('pop-up de tonelaje y de distancia una sola vez, y resumen del mes', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  const now = new Date()
  const today = new Date(now)
  today.setHours(Math.max(0, now.getHours() - 2), 0, 0, 0)
  // El día 15 del mes pasado (a las 10:00): cuenta para el total y para el resumen del mes.
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0)
  const runLastMonth = new Date(lastMonth.getTime() + 3 * 3600_000)

  const saves = [
    // 7 × 70 kg × 10 = 4.900 kg el mes pasado; hoy 300 kg más → 5.200 kg: supera el tractor.
    session(
      OLD_STRENGTH,
      'strength',
      lastMonth,
      Array.from({ length: 7 }, () => ({ exercise: 'bench_press', weight: 70, reps: 10 })),
    ),
    session(NEW_STRENGTH, 'strength', today, [{ exercise: 'bench_press', weight: 60, reps: 5 }]),
    // 85 km el mes pasado + 5 km hoy: supera Girona (≈ 88 km de Barcelona en línea recta).
    session(OLD_RUN, 'running', runLastMonth, [{ exercise: 'run', distance: 85_000 }], 85_000),
  ]
  for (const payload of saves) {
    await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, { data: { payload } })
  }
  await request.post(`${MOCK}/__seed`, {
    data: { profile: { home_city: 'Barcelona', home_lat: 41.3874, home_lng: 2.1686 } },
  })
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])

  // Tonelaje: el hito más llamativo es el del total.
  await dialogShownOnce(
    page,
    `/entrenar/historial/${NEW_STRENGTH}?nueva=1`,
    /En total has levantado el peso de un tractor[\s\S]*5\.200 kg/,
  )

  // Distancia: ahora la carrera de hoy.
  const run = session(
    NEW_RUN,
    'running',
    new Date(today.getTime() + 30 * 60_000),
    [{ exercise: 'run', distance: 5000 }],
    5000,
  )
  await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, { data: { payload: run } })
  await dialogShownOnce(
    page,
    `/entrenar/historial/${NEW_RUN}?nueva=1`,
    /En total has corrido la distancia de Barcelona a Girona, en línea recta/,
  )

  const state = (await (await request.get(`${MOCK}/__state`)).json()) as {
    milestones: { milestone_key: string }[]
  }
  const keys = state.milestones.map((m) => m.milestone_key)
  expect(keys).toContain('tonnage_total_tractor')
  expect(keys).toContain('run_total_girona')
  // El resto de hitos cruzados a la vez se marcan como vistos (no saltan en la siguiente).
  expect(keys).toContain('dist_total_girona')

  // Resumen del mes anterior al abrir la app en un mes nuevo; solo una vez.
  await dialogShownOnce(page, '/', /Tu resumen de/)

  // Mis logros: acumulados, equivalencia y los hitos conseguidos.
  await page.goto('/progreso/logros')
  await page.getByRole('tab', { name: 'Total' }).click()
  await expect(page.getByText('5.200 kg')).toBeVisible()
  await expect(page.getByText('En total has levantado el peso de un tractor.')).toBeVisible()
  const history = page.locator('[data-slot="card"]').filter({ hasText: 'Hitos conseguidos' })
  await expect(history).toContainText('Tractor')
  await expect(history).toContainText('Girona')
  await expect(page.getByText(/Destinos alcanzados/)).toBeVisible()
})
