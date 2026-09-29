import { expect, test } from '@playwright/test'

// Fase 5B: «Hoy» con la sesión del plan y las atrasadas, check-in sin conexión, sugerencia de
// peso al empezar la planificada, aviso al mover una sesión y adherencia al plan.
import { MOCK, USER_ID, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const PLAN = '5b000000-0000-4000-8000-000000000001'

type State = {
  plannedSessions: { id: string; date: string; status: string }[]
  dailyCheckins: { date: string; sleep: number; energy: number; soreness: number; stress: number }[]
}

const strength = (exercise: string) => ({
  block_type: 'straight',
  exercises: [{ exercise_id: exercise, sets: 3, reps: '8-10', rir: 2, rest_s: 120 }],
})

function planned(id: string, date: string, title: string, patch: Record<string, unknown> = {}) {
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
    blocks: [strength('bench_press')],
    status: 'planned',
    workout_session_id: null,
    ...patch,
  }
}

test('Hoy: planificada, atrasada, check-in offline, sugerencia de peso y aviso al mover', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  await request.post(`${MOCK}/__seed`, {
    data: {
      trainingProfile: {
        goals: { selected: ['health'], main: 'health' },
        level: 'beginner',
        availability: { days_per_week: 4, preferred_days: [1, 3, 5, 6] },
        fixed_activities: [{ type: 'padel_fronton', days: [4], minutes: null, label: null }],
      },
      userPlans: [
        {
          id: PLAN,
          user_id: USER_ID,
          template_id: 'hybrid_beginner',
          name: 'Híbrido · 4 días',
          start_date: '2026-10-05',
          status: 'active',
          source: 'template',
          notes: null,
        },
      ],
      plannedSessions: [
        planned('p-mon', '2026-10-05', 'Full body A', {
          intensity: 'hard',
          heavy_legs: true,
          blocks: [strength('back_squat')],
        }),
        planned('p-wed', '2026-10-07', 'Full body B'),
        planned('p-fri', '2026-10-09', 'Rodaje suave', {
          session_type: 'running',
          intensity: 'easy',
        }),
        planned('p-sat', '2026-10-10', 'Full body C', {
          intensity: 'hard',
          heavy_legs: true,
          blocks: [strength('back_squat')],
        }),
      ],
    },
  })
  // La última vez: press banca 3×10 con 60 kg (techo del rango 8–10).
  const block = '5b000000-0000-4000-8000-0000000000b1'
  await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, {
    data: {
      payload: {
        session: {
          id: '5b000000-0000-4000-8000-0000000000a1',
          session_type: 'strength',
          title: 'Torso',
          started_at: '2026-10-02T09:00:00Z',
          ended_at: '2026-10-02T10:00:00Z',
          duration_min: 60,
          rpe: 7,
          client_rev: 1,
        },
        blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
        sets: [0, 1, 2].map((i) => ({
          id: `5b000000-0000-4000-8000-00000000c00${i}`,
          block_id: block,
          exercise_id: 'bench_press',
          set_index: i,
          is_warmup: false,
          weight_kg: 60,
          reps: 10,
          completed: true,
        })),
      },
    },
  })

  // Miércoles 7 oct 2026 a las 9:00.
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'))
  await context.addCookies([
    {
      name: 'sb-localhost-auth-token',
      value: authCookie(Math.floor(Date.parse('2026-10-08T00:00:00Z') / 1000)),
      url: 'http://localhost:3100',
    },
  ])
  if (SHOTS) await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/')
  const today = page.getByRole('region', { name: 'Plan de hoy' })
  await expect(today.getByText('Full body B')).toBeVisible()
  await expect(today.getByRole('button', { name: 'Empezar planificada' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entreno libre' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Registrar actividad' })).toBeVisible()

  // Atrasada del lunes: saltarla.
  await expect(today.getByText('Te quedó una sesión de esta semana')).toBeVisible()
  await expect(today.getByText('Full body A')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hoy-plan.png`, fullPage: true })
  await today.getByRole('button', { name: 'Saltar' }).click()
  await expect(today.getByText('Te quedó una sesión de esta semana')).toBeHidden()
  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as State
      return s.plannedSessions.find((p) => p.id === 'p-mon')?.status
    })
    .toBe('skipped')

  // Check-in sin conexión: 4 toques y queda guardado en el móvil.
  const checkin = page.getByRole('region', { name: 'Check-in de hoy' })
  await context.setOffline(true)
  await checkin.getByRole('button', { name: 'Sueño 4' }).click()
  await checkin.getByRole('button', { name: 'Energía 3' }).click()
  await checkin.getByRole('button', { name: 'Agujetas 2' }).click()
  await checkin.getByRole('button', { name: 'Estrés 1' }).click()
  await expect(checkin.getByText(/se subirá al recuperar la conexión/)).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/hoy-checkin.png`, fullPage: true })
  await context.setOffline(false)
  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as State
      return s.dailyCheckins
    })
    .toEqual([
      expect.objectContaining({ date: '2026-10-07', sleep: 4, energy: 3, soreness: 2, stress: 1 }),
    ])
  await expect(checkin.getByText(/se subirá/)).toBeHidden()

  // Empezar la planificada: peso sugerido con el motivo; se puede volver al de la última vez.
  await today.getByRole('button', { name: 'Empezar planificada' }).click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  const suggestion = page.getByLabel('Sugerencia de peso')
  await expect(suggestion).toContainText('+2,5 kg: completaste 3×10 con 60 kg la última vez')
  await expect(page.getByText('62,5').first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sesion-sugerencia.png`, fullPage: true })
  await suggestion.getByRole('button', { name: 'Usar 60 kg' }).click()
  await expect(suggestion).toContainText('Con el peso de la última vez (60 kg)')
  await expect(page.getByText('62,5')).toHaveCount(0)

  // Mover la pierna pesada del sábado al miércoles (día antes del frontón): avisa, no bloquea.
  await page.goto('/plan')
  await expect(page.getByText('Adherencia al plan')).toBeVisible()
  await expect(page.getByText('0 de 1 (0 %)')).toBeVisible()
  await page.getByRole('button', { name: /Full body C/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Mover' }).click()
  await sheet.getByRole('button', { name: 'miércoles 7 oct (con aviso)' }).click()
  await expect(
    page.getByText('Pierna pesada el día antes de frontón (el jueves 8 oct).'),
  ).toBeVisible()
  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as State
      return s.plannedSessions.find((p) => p.id === 'p-sat')?.date
    })
    .toBe('2026-10-07')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-aviso.png`, fullPage: true })

  // Cumplimiento: adherencia al plan aparte del compromiso; Mi compromiso ofrece usar el plan.
  await page.goto('/progreso/cumplimiento')
  await expect(page.getByText('Adherencia al plan')).toBeVisible()
  await page.goto('/perfil/compromiso')
  await page
    .getByRole('button', { name: 'Usar las de mi plan «Híbrido · 4 días»: 4 por semana' })
    .click()
  await expect(page.getByText('Igual que tu plan «Híbrido · 4 días»')).toBeVisible()
})
