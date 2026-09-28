import { expect, test } from '@playwright/test'

// Criterio de aceptación de la Fase 3 (cumplimiento): con un compromiso de 3 sesiones/semana
// y 2 hechas, «Hoy» muestra 67 % y lo que falta; la persona vinculada aparece en «Nosotros»
// con su porcentaje (y sin pesos: el servidor solo le da días y tipos de sesión).
import { MOCK, USER_ID, authCookie } from './helpers'

const PARTNER_ID = '22222222-2222-4222-8222-222222222222'

function localKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function monday(d: Date) {
  const m = new Date(d)
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localKey(m)
}

function finishedSession(id: string, type: string, start: Date) {
  const end = new Date(start.getTime() + 45 * 60_000)
  return {
    session: {
      id,
      session_type: type,
      title: type,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      duration_min: 45,
      rpe: 7,
      client_rev: 1,
    },
    blocks: [],
    sets: [],
  }
}

test('Hoy muestra 2 de 3 (67 %) y la tarjeta «Nosotros» con la pareja', async ({
  page,
  context,
  request,
}) => {
  await request.post(`${MOCK}/__reset`)
  const now = new Date()
  const today = localKey(now)
  const start = new Date(now)
  start.setHours(Math.max(0, now.getHours() - 2), 0, 0, 0)
  // Dos sesiones hoy de distinto tipo: cuentan las dos (una por día y tipo).
  for (const [id, type] of [
    ['aaaaaaaa-0000-4000-8000-000000000001', 'strength'],
    ['aaaaaaaa-0000-4000-8000-000000000002', 'running'],
  ] as const) {
    await request.post(`${MOCK}/rest/v1/rpc/save_workout_session`, {
      data: { payload: finishedSession(id, type, start) },
    })
  }
  const commitment = (userId: string) => ({
    user_id: userId,
    valid_from: monday(now),
    valid_to: null,
    sessions_per_week: 3,
    minutes_per_week: null,
    by_type: null,
    counts_free_activities: true,
  })
  await request.post(`${MOCK}/__seed`, {
    data: {
      commitments: [commitment(USER_ID), commitment(PARTNER_ID)],
      partnerLinks: [
        {
          partner_id: PARTNER_ID,
          display_name: 'Bea',
          status: 'accepted',
          i_share_adherence: true,
          i_share_sessions: false,
          i_share_metrics: false,
          they_share_adherence: true,
          they_share_sessions: false,
          they_share_metrics: false,
          created_at: now.toISOString(),
        },
      ],
      partnerDays: {
        [PARTNER_ID]: [
          { day: today, session_type: 'strength' },
          { day: today, session_type: 'swimming' },
        ],
      },
    },
  })
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])

  await page.goto('/')
  const week = page.getByRole('link', { name: /Esta semana/ })
  await expect(week).toContainText('2/3 · 67 %')
  await expect(week).toContainText('¡una más y semana completa!')
  await expect(page.getByRole('progressbar', { name: 'Esta semana' })).toHaveAttribute(
    'aria-valuenow',
    '67',
  )

  const us = page.locator('[data-slot="card"]').filter({ hasText: 'Nosotros' })
  await expect(us).toContainText('Bea')
  await expect(us.locator('li').filter({ hasText: 'Bea' })).toContainText('2/3 · 67 %')
  await expect(us).not.toContainText('kg')

  // Pantalla de cumplimiento: histórico de 12 semanas y racha.
  await week.click()
  await expect(page.getByRole('heading', { name: 'Cumplimiento' })).toBeVisible()
  await expect(page.getByLabel('Cumplimiento de las últimas 12 semanas')).toBeVisible()
  await expect(page.getByText('Mejor racha')).toBeVisible()
})
