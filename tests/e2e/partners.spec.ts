import { expect, test } from '@playwright/test'

// Fase 7A: «Evolución de {nombre}» solo con las secciones compartidas, interruptores por persona
// y unirse a un entreno en pareja (misma estructura, pesos propios y pair_group_id común).
// La RLS real de cada permiso la cubren los tests PGlite (tests/db/partner-sharing.test.ts).
import { MOCK, authCookie } from './helpers'

const SHOTS = process.env.E2E_SCREENSHOTS
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!SHOTS) return
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const PARTNER_ID = '22222222-2222-4222-8222-222222222222'
const GROUP = '33333333-3333-4333-8333-333333333333'

function localKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function monday(d: Date) {
  const m = new Date(d)
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localKey(m)
}

const link = (theyShare: Record<string, boolean>) => ({
  partner_id: PARTNER_ID,
  display_name: 'Bea',
  status: 'accepted',
  i_share_adherence: true,
  i_share_sessions: false,
  i_share_muscles: false,
  i_share_achievements: false,
  i_share_metrics: false,
  they_share_adherence: false,
  they_share_sessions: false,
  they_share_muscles: false,
  they_share_achievements: false,
  they_share_metrics: false,
  ...theyShare,
  created_at: new Date().toISOString(),
})

test.beforeEach(async ({ context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
})

test('la evolución de la otra persona solo enseña lo que comparte; los permisos se cambian por persona', async ({
  page,
  request,
}) => {
  const now = new Date()
  await request.post(`${MOCK}/__seed`, {
    data: {
      commitments: [
        {
          user_id: PARTNER_ID,
          valid_from: monday(now),
          valid_to: null,
          sessions_per_week: 3,
          minutes_per_week: null,
          by_type: null,
          counts_free_activities: true,
        },
      ],
      partnerLinks: [link({ they_share_adherence: true, they_share_muscles: true })],
      partnerDays: { [PARTNER_ID]: [{ day: localKey(now), session_type: 'strength' }] },
    },
  })

  // Desde «Nosotros», el nombre lleva a su evolución.
  await page.goto('/')
  await shot(page, '7a-hoy-nosotros')
  const us = page.locator('[data-slot="card"]').filter({ hasText: 'Nosotros' })
  await us.getByRole('link', { name: 'Bea' }).click()
  await expect(page.getByRole('heading', { name: 'Evolución de Bea' })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Secciones' })
  await expect(nav.getByRole('link')).toHaveText(['Cumplimiento', 'Músculos'])
  // Sin permiso, la sección no aparece (ni siquiera como «bloqueada»).
  await expect(page.getByText(/Entrenos|Logros|Medidas|bloquead/)).toHaveCount(0)
  await expect(page.getByText('1/3 · 33 %').first()).toBeVisible()
  await expect(page.getByRole('group', { name: 'Reaccionar a su semana' })).toBeVisible()
  await shot(page, '7a-evolucion-cumplimiento')

  await nav.getByRole('link', { name: 'Músculos' }).click()
  await expect(page.getByRole('heading', { name: 'Mapa muscular' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Carga' })).toBeVisible()
  await shot(page, '7a-evolucion-musculos')

  // Perfil → Pareja y amigos → Bea: un interruptor por permiso; las fotos, nunca.
  await page.goto('/perfil/vinculos')
  await page.getByRole('link', { name: /Bea/ }).click()
  await expect(page.getByRole('heading', { name: 'Bea' })).toBeVisible()
  const switches = page.getByRole('switch')
  await expect(switches).toHaveCount(5)
  await expect(page.getByText('siempre privadas')).toBeVisible()
  const sessions = page.getByRole('switch', { name: 'Entrenos' })
  await expect(sessions).toHaveAttribute('aria-checked', 'false')
  await sessions.click()
  await expect(sessions).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Bea ya ve: Entrenos')).toBeVisible()
  await shot(page, '7a-permisos')
  const state = (await (await request.get(`${MOCK}/__state`)).json()) as {
    partnerPatches: Record<string, unknown>[]
  }
  expect(state.partnerPatches).toEqual([{ partner_id: PARTNER_ID, can_view_sessions: true }])
})

test('unirse a un entreno en pareja: misma estructura, sin sus pesos y con el mismo pair_group_id', async ({
  page,
  request,
}) => {
  await request.post(`${MOCK}/__seed`, {
    data: {
      partnerLinks: [link({ they_share_adherence: true })],
      pairInvites: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          pair_group_id: GROUP,
          from_user: PARTNER_ID,
          to_user: '11111111-1111-4111-8111-111111111111',
          status: 'pending',
          created_at: new Date().toISOString(),
          payload: {
            v: 1,
            session_type: 'strength',
            title: 'Pierna juntos',
            location: 'gym',
            blocks: [
              {
                block_type: 'straight',
                settings: null,
                exercises: [{ exercise_id: 'back_squat', rest_s: 150 }],
                sets: [1, 2, 3].map(() => ({
                  exercise_id: 'back_squat',
                  is_warmup: false,
                  reps: 8,
                  duration_s: null,
                  distance_m: null,
                })),
              },
              {
                block_type: 'straight',
                settings: null,
                exercises: [{ exercise_id: 'bench_press', rest_s: 120 }],
                sets: [1, 2].map(() => ({
                  exercise_id: 'bench_press',
                  is_warmup: false,
                  reps: 10,
                  duration_s: null,
                  distance_m: null,
                })),
              },
            ],
          },
        },
      ],
    },
  })

  await page.goto('/')
  await expect(page.getByText('Bea te invita a entrenar juntos')).toBeVisible()
  await expect(page.getByText(/Pierna juntos · 2 ejercicios/)).toBeVisible()
  await shot(page, '7a-invitacion')
  await page.getByRole('button', { name: 'Unirme' }).click()

  await expect(page).toHaveURL(/\/entrenar\/sesion/)
  await expect(page.getByLabel('Título de la sesión')).toHaveValue('Pierna juntos')
  await expect(page.getByText('Entrenando con Bea')).toBeVisible()
  await expect(page.getByText('Sentadilla con barra').first()).toBeVisible()
  await expect(page.getByText('Press banca').first()).toBeVisible()
  await shot(page, '7a-sesion-pareja')

  // La invitación queda aceptada y la sesión sube con el pair_group_id común y sin pesos ajenos.
  await expect
    .poll(async () => {
      const s = (await (await request.get(`${MOCK}/__state`)).json()) as {
        pairInvites: { status: string }[]
        sessions: {
          session: { pair_group_id: string | null; title: string }
          sets: { exercise_id: string; reps: number | null; weight_kg: number | null }[]
        }[]
      }
      const mine = s.sessions.find((x) => x.session.title === 'Pierna juntos')
      return {
        invite: s.pairInvites[0]?.status,
        group: mine?.session.pair_group_id,
        sets: mine?.sets.map((x) => [x.exercise_id, x.reps, x.weight_kg]),
      }
    })
    .toEqual({
      invite: 'accepted',
      group: GROUP,
      sets: [
        ['back_squat', 8, null],
        ['back_squat', 8, null],
        ['back_squat', 8, null],
        ['bench_press', 10, null],
        ['bench_press', 10, null],
      ],
    })
})
