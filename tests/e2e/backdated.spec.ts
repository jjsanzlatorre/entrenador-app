import { expect, test } from '@playwright/test'

// Entrenos con fecha pasada: «Registrar como hecha» una planificada de un día pasado (queda
// enlazada y sube la adherencia), «Registrar entreno pasado» desde una sesión anterior sin
// conexión (la cola conserva la fecha), «Cambiar fecha» de una sesión del historial (el
// cumplimiento de las dos semanas se recalcula), sin fechas futuras, y «Registrar actividad»
// con «Anteayer».
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const PLAN = 'bd000000-0000-4000-8000-000000000001'
const TORSO = 'bd000000-0000-4000-8000-0000000000a1'

type State = {
  sessions: {
    session: {
      id: string
      title: string | null
      started_at: string
      ended_at: string | null
      planned_session_id: string | null
      session_type: string
    }
    sets: { completed: boolean; weight_kg: number | null; completed_at: string | null }[]
  }[]
  plannedSessions: { id: string; status: string; workout_session_id: string | null }[]
}

// Hora local del contenedor (la misma para el navegador y para el test).
const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString()

function planned(id: string, date: string, title: string) {
  return {
    id,
    user_plan_id: PLAN,
    user_id: USER_ID,
    date,
    original_date: null,
    week: 1,
    session_type: 'strength',
    title,
    intensity: 'moderate',
    heavy_legs: false,
    duration_min: 60,
    notes: null,
    blocks: [
      {
        block_type: 'straight',
        exercises: [{ exercise_id: 'bench_press', sets: 3, reps: '8-10', rir: 2, rest_s: 120 }],
      },
    ],
    status: 'planned',
    workout_session_id: null,
  }
}

async function state(request: import('@playwright/test').APIRequestContext) {
  return (await (await request.get(`${MOCK}/__state`)).json()) as State
}

test('registrar entrenos pasados, enlazar la planificada y cambiar la fecha', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      commitments: [
        {
          user_id: USER_ID,
          valid_from: '2026-09-28',
          valid_to: null,
          sessions_per_week: 2,
          minutes_per_week: null,
          by_type: null,
          counts_free_activities: true,
        },
      ],
      trainingProfile: {
        goals: { selected: ['health'], main: 'health' },
        level: 'beginner',
        availability: { days_per_week: 3, preferred_days: [2, 4, 6] },
        fixed_activities: [],
      },
      userPlans: [
        {
          id: PLAN,
          user_id: USER_ID,
          template_id: 'strength_beginner',
          name: 'Fuerza · 3 días',
          start_date: '2026-10-12',
          status: 'active',
          source: 'template',
          notes: null,
        },
      ],
      plannedSessions: [
        planned('p-tue', '2026-10-13', 'Full body A'),
        planned('p-thu', '2026-10-15', 'Full body B'),
        planned('p-sat', '2026-10-17', 'Full body C'),
      ],
    },
  })
  // Una sesión anterior para «Repetir…»: press banca 3×8 con 60 kg.
  const block = 'bd000000-0000-4000-8000-0000000000b1'
  await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, {
    data: {
      payload: {
        session: {
          id: TORSO,
          session_type: 'strength',
          title: 'Torso',
          started_at: '2026-10-01T09:00:00Z',
          ended_at: '2026-10-01T10:00:00Z',
          duration_min: 60,
          rpe: 7,
          client_rev: 1,
        },
        blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
        sets: [0, 1, 2].map((i) => ({
          id: `bd000000-0000-4000-8000-00000000c00${i}`,
          block_id: block,
          exercise_id: 'bench_press',
          set_index: i,
          is_warmup: false,
          weight_kg: 60,
          reps: 8,
          completed: true,
        })),
      },
    },
  })

  // Jueves 15 oct 2026 a las 12:00.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 12, 0))
  await context.addCookies([
    {
      name: 'sb-localhost-auth-token',
      value: authCookie(Math.floor(Date.parse('2026-10-17T00:00:00Z') / 1000)),
      url: 'http://localhost:3100',
    },
  ])
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  // 1. «Hoy»: la del martes quedó sin hacer → «Registrar como hecha».
  await page.goto('/')
  const week = page.getByRole('link', { name: /Esta semana/ })
  await expect(week).toContainText('0/2')
  const today = page.getByRole('region', { name: 'Plan de hoy' })
  await expect(today.getByText('Te quedó una sesión de esta semana')).toBeVisible()
  await today.getByRole('button', { name: 'Registrar como hecha' }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(page.getByTestId('past-badge')).toContainText('Entreno pasado · anteayer, 18:00')
  await expect(page.getByText('Press banca').first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasado-sesion.png`, fullPage: true })
  // Sin cuenta en vivo ni descanso: guardar con «Marcar todas como hechas».
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  let sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Guardar entreno')).toBeVisible()
  await expect(sheet.getByTestId('when-preview')).toContainText('anteayer, 18:00')
  await sheet.getByRole('button', { name: 'Marcar todas como hechas' }).click()
  await sheet.getByRole('button', { name: '7', exact: true }).click()
  await sheet.locator('#duration').fill('50')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasado-guardar.png`, fullPage: true })
  await sheet.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page.getByText('¡Sesión guardada! 💪')).toBeVisible()

  await expect
    .poll(async () => {
      const s = await state(request)
      const linked = s.sessions.find((x) => x.session.planned_session_id === 'p-tue')
      return {
        started: linked?.session.started_at,
        ended: linked?.session.ended_at,
        done: linked?.sets.filter((x) => x.completed).length,
        planned: s.plannedSessions.find((p) => p.id === 'p-tue')?.status,
      }
    })
    .toEqual({ started: local(13, 18), ended: local(13, 18, 50), done: 3, planned: 'done' })

  // El cumplimiento de la semana sube y la adherencia al plan también.
  await page.goto('/')
  await expect(week).toContainText('1/2 · 50 %')
  await expect(today.getByText('Te quedó una sesión de esta semana')).toBeHidden()
  await page.goto('/plan')
  await expect(page.getByText('1 de 1 (100 %)')).toBeVisible()

  // 2. Entrenar → «Registrar entreno pasado» (ayer, por defecto), sin conexión.
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Registrar entreno pasado' }).click()
  sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Ayer', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Nada en el futuro: hoy a las 13:30 no vale.
  await sheet.getByRole('button', { name: 'Hoy', exact: true }).click()
  await sheet.getByLabel('Hora').fill('13:30')
  await expect(sheet.getByRole('alert')).toHaveText('No se pueden registrar entrenos en el futuro')
  await expect(sheet.getByRole('button', { name: /Fuerza/ })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Ayer', exact: true }).click()
  await sheet.getByLabel('Hora').fill('19:15')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasado-hoja.png`, fullPage: true })
  await sheet.getByRole('button', { name: /Repetir «Torso»/ }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(page.getByTestId('past-badge')).toContainText('ayer, 19:15')

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Marcar todas como hechas' }).click()
  await sheet.getByRole('button', { name: '8', exact: true }).click()
  await sheet.locator('#duration').fill('45')
  await sheet.getByRole('button', { name: 'Guardar sesión' }).click()
  await expect(page.getByText('Guardada en el móvil')).toBeVisible()
  // Sin conexión, «Hoy» ya cuenta la de ayer en esta semana (tras agotar las peticiones a la red).
  await page.getByRole('link', { name: 'Volver a Hoy' }).click()
  await expect(week).toContainText('2/2 · 100 %', { timeout: 20_000 })
  // Se sube al volver la conexión, con la fecha elegida (no la de hoy).
  await context.setOffline(false)

  let repeatedId = ''
  await expect
    .poll(async () => {
      const s = await state(request)
      const r = s.sessions.find(
        (x) => x.session.title === 'Torso' && x.session.id !== TORSO && x.session.ended_at,
      )
      repeatedId = r?.session.id ?? ''
      return r && { started: r.session.started_at, ended: r.session.ended_at }
    })
    .toEqual({ started: local(14, 19, 15), ended: local(14, 20, 0) })
  await page.goto('/')
  await expect(week).toContainText('2/2 · 100 %')

  // 3. Historial → «Cambiar fecha»: de ayer al viernes de la semana pasada.
  await page.goto(`/entrenar/historial/${repeatedId}`)
  await page.getByRole('button', { name: 'Cambiar fecha' }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByTestId('when-date').fill('2026-10-09')
  await expect(sheet.getByTestId('when-preview')).toContainText('viernes 9 oct, 19:15')
  await sheet.getByRole('button', { name: 'Guardar fecha' }).click()
  await expect(page.getByText('Fecha cambiada')).toBeVisible()
  await expect
    .poll(async () => {
      const s = await state(request)
      const r = s.sessions.find((x) => x.session.id === repeatedId)
      return r && { started: r.session.started_at, ended: r.session.ended_at }
    })
    .toEqual({ started: local(9, 19, 15), ended: local(9, 20, 0) })
  // Esta semana vuelve a 1 de 2; la semana pasada, con la del viernes, ya cuenta 1.
  await page.goto('/')
  await expect(week).toContainText('1/2 · 50 %')
  await page.goto('/progreso/cumplimiento')
  await expect(page.getByLabel('Cumplimiento de las últimas 12 semanas')).toBeVisible()

  // 4. «Registrar actividad» con «Anteayer».
  await page.goto('/entrenar/actividad')
  await page.getByRole('button', { name: /Surf/ }).click()
  await page.getByRole('button', { name: 'Anteayer', exact: true }).click()
  await page.getByLabel('Hora').fill('08:00')
  await page.getByRole('button', { name: '6', exact: true }).click()
  await page.getByRole('button', { name: 'Guardar actividad' }).click()
  await expect(page.getByText('¡Sesión guardada! 💪')).toBeVisible()
  await expect
    .poll(async () => {
      const s = await state(request)
      return s.sessions.find((x) => x.session.session_type === 'surf')?.session.started_at
    })
    .toBe(local(13, 8))
})
