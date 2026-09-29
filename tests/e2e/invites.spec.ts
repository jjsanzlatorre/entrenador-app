import { expect, test, type Page } from '@playwright/test'

// Invitaciones por enlace: /unirse/{código} (válido, caducado, anulado, usado, inexistente,
// email existente y límite de intentos), «Invitar con enlace» en Pareja y amigos, ajustes del
// admin y contraseña temporal obligatoria de cambiar. La lógica SQL (canje atómico, RLS) la
// cubren los tests PGlite (tests/db/invites.test.ts).
import { MOCK, authCookie } from './helpers'

const APP = 'http://localhost:3100'
const CODE = 'K7P4-QX2M-AB3C'
const SHOTS = process.env.E2E_SCREENSHOTS
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

type State = {
  inviteCodes: { code: string; uses: number; used_by: string | null; revoked: boolean }[]
  inviteAttempts: number
  inviteSettings: { members_can_invite: boolean; max_active_invites_per_user: number }
  authUsers: {
    id: string
    email: string
    password: string
    user_metadata: { display_name?: string }
  }[]
  deletedUsers: string[]
  redeemed: { code: string; user: string }[]
  passwordUpdates: { id: string; password: string }[]
  otherProfiles: Record<string, { must_change_password?: boolean; display_name?: string }>
  profile: { must_change_password?: boolean }
}

async function state(request: import('@playwright/test').APIRequestContext) {
  return (await (await request.get(`${MOCK}/__state`)).json()) as State
}

async function login(page: Page) {
  await page
    .context()
    .addCookies([{ name: 'sb-localhost-auth-token', value: authCookie(), url: APP }])
}

async function seedCode(
  request: import('@playwright/test').APIRequestContext,
  extra: Record<string, unknown> = {},
) {
  await request.post(`${MOCK}/__seed`, {
    data: {
      inviteCodes: [
        {
          code: CODE,
          created_by: '44444444-4444-4444-8444-444444444444',
          created_by_name: 'Ana',
          ...extra,
        },
      ],
    },
  })
}

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`)
})

test('código válido: crea la cuenta, vincula, inicia sesión y lleva al onboarding y a instalar', async ({
  page,
  request,
}) => {
  await seedCode(request)
  await request.post(`${MOCK}/__seed`, { data: { trainingProfile: null } })

  await page.goto(`/unirse/${CODE.toLowerCase().replace(/-/g, '')}`)
  await expect(page.getByText('Ana te ha invitado')).toBeVisible()

  // Vista previa de WhatsApp: Open Graph sin datos personales, imagen absoluta y servida.
  await expect(page).toHaveTitle('Te han invitado a Entrenador')
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Te han invitado a Entrenador',
  )
  const image = await page.locator('meta[property="og:image"]').getAttribute('content')
  expect(image).toBe(`${APP}/og-invite.png`)
  const png = await request.get(image!)
  expect(png.status()).toBe(200)
  expect(png.headers()['content-type']).toContain('image/png')
  const description = await page.locator('meta[property="og:description"]').getAttribute('content')
  expect(description).not.toContain('Ana')
  await shot(page, 'unirse-form')

  await page.getByLabel('Nombre').fill('Bea')
  await page.getByLabel('Email').fill('Bea@Test.dev')
  await page.getByLabel('Contraseña (mínimo 8 caracteres)').fill('secreta123')
  await page.getByLabel('Repite la contraseña').fill('secreta124')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page.getByRole('alert')).toHaveText('Las contraseñas no coinciden')
  expect((await state(request)).authUsers).toEqual([])

  await page.getByLabel('Repite la contraseña').fill('secreta123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page).toHaveURL(/\/onboarding/)

  const s = await state(request)
  expect(s.authUsers).toHaveLength(1)
  expect(s.authUsers[0]).toMatchObject({
    email: 'bea@test.dev',
    password: 'secreta123',
    user_metadata: { display_name: 'Bea' },
  })
  expect(s.redeemed).toEqual([{ code: CODE, user: s.authUsers[0]!.id }])
  expect(s.inviteCodes[0]).toMatchObject({ uses: 1, used_by: s.authUsers[0]!.id })
  expect(s.deletedUsers).toEqual([])

  // Tras el onboarding, la pantalla de instalar la PWA.
  await page.getByRole('button', { name: /Saltar todo/ }).click()
  await expect(page).toHaveURL(/\/instalar/)
  await expect(page.getByRole('heading', { name: 'Instala la app' })).toBeVisible()
  await expect(page.getByText(/Instalar app/).first()).toBeVisible()
  await shot(page, 'instalar')
  await page.getByRole('link', { name: /continuar/i }).click()
  await expect(page).toHaveURL(`${APP}/`)
})

for (const [label, extra, text] of [
  ['caducado', { expires_at: '2020-01-01T00:00:00Z' }, /ha caducado/],
  ['anulado', { revoked: true }, /se ha anulado/],
  ['ya usado', { uses: 1, used_by: '55555555-5555-4555-8555-555555555555' }, /ya se ha usado/],
] as const) {
  test(`código ${label}: mensaje claro y sin formulario`, async ({ page, request }) => {
    await seedCode(request, extra)
    await page.goto(`/unirse/${CODE}`)
    await expect(page.getByText('Invitación no válida')).toBeVisible()
    await expect(page.getByText(text)).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveCount(0)
    expect((await state(request)).authUsers).toEqual([])
  })
}

test('sin código válido no se puede crear cuenta; 10 intentos fallidos bloquean la IP', async ({
  page,
  request,
}) => {
  await page.goto('/unirse/ZZZZ-ZZZZ-ZZZZ')
  await expect(page.getByText(/no existe/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear cuenta' })).toHaveCount(0)
  // El login no ofrece registrarse.
  await page.goto('/login')
  await expect(page.getByText('Acceso solo por invitación')).toBeVisible()
  await expect(page.getByText(/registr|crear cuenta/i)).toHaveCount(0)

  for (let i = 0; i < 9; i++) await page.goto(`/unirse/ZZZZ-ZZZZ-ZZZ${i + 2}`)
  expect((await state(request)).inviteAttempts).toBe(10)
  // Aunque ahora sea un código bueno, esta conexión está bloqueada un rato.
  await seedCode(request)
  await page.goto(`/unirse/${CODE}`)
  await expect(page.getByText(/Demasiados intentos/)).toBeVisible()
  expect((await state(request)).authUsers).toEqual([])
})

test('email ya registrado: «Ya tienes cuenta» y al entrar se aplica el vínculo', async ({
  page,
  request,
}) => {
  await seedCode(request)
  await page.goto(`/unirse/${CODE}`)
  await page.getByLabel('Nombre').fill('E2E')
  await page.getByLabel('Email').fill('e2e@test.dev')
  await page.getByLabel('Contraseña (mínimo 8 caracteres)').fill('otraclave1')
  await page.getByLabel('Repite la contraseña').fill('otraclave1')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page.getByText('Ya tienes cuenta, inicia sesión.')).toBeVisible()
  expect((await state(request)).redeemed).toEqual([])

  await page.getByRole('link', { name: 'Iniciar sesión' }).click()
  await expect(page).toHaveURL(/\/login\?invitacion=/)
  await expect(page.getByText(/se aplicará la invitación/)).toBeVisible()
  await page.getByRole('button', { name: 'Entrar con contraseña' }).click()
  await page.getByLabel('Email').fill('e2e@test.dev')
  await page.getByLabel('Contraseña').fill('otraclave1')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByText('Ya estás vinculado con Ana')).toBeVisible()
  const s = await state(request)
  expect(s.redeemed).toEqual([{ code: CODE, user: '11111111-1111-4111-8111-111111111111' }])
  expect(s.authUsers).toEqual([])
})

test('Pareja y amigos: invitar con enlace, compartir por WhatsApp, lista y anular', async ({
  page,
  request,
}) => {
  await login(page)
  // Sin permiso del admin, un miembro no ve el botón.
  await page.goto('/perfil/vinculos')
  await expect(page.getByRole('heading', { name: 'Pareja y amigos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invitar con enlace' })).toHaveCount(0)

  await request.post(`${MOCK}/__seed`, {
    data: { inviteSettings: { members_can_invite: true, max_active_invites_per_user: 1 } },
  })
  await page.reload()
  await page.getByRole('button', { name: 'Invitar con enlace' }).click()
  const url = page.getByTestId('invite-url')
  await expect(url).toContainText(`${APP}/unirse/`)
  const link = (await url.textContent())!.trim()
  const code = link.split('/unirse/')[1]!
  const wa = page.getByRole('link', { name: 'Compartir por WhatsApp' })
  await expect(wa).toHaveAttribute(
    'href',
    `https://wa.me/?text=${encodeURIComponent(`E2E te invita a entrenar juntos 💪 ${link}`)}`,
  )
  await expect(page.getByRole('button', { name: 'Copiar enlace' })).toBeVisible()
  await shot(page, 'invitar-enlace')
  await page.keyboard.press('Escape')

  const list = page.getByRole('list', { name: 'Invitaciones' })
  await expect(list.getByText(code)).toBeVisible()
  await expect(list.getByText(/^Pendiente/)).toBeVisible()
  // Máximo de 1 activa: no se puede crear otra.
  await expect(page.getByRole('button', { name: 'Invitar con enlace' })).toHaveCount(0)
  await expect(page.getByText(/el máximo/)).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await list.getByRole('button', { name: 'Anular' }).click()
  await expect(list.getByText('Anulada')).toBeVisible()
  expect((await state(request)).inviteCodes[0]!.revoked).toBe(true)
  await expect(page.getByRole('button', { name: 'Invitar con enlace' })).toBeVisible()
})

test('admin: ajustes de invitación y contraseña temporal que obliga a cambiarla', async ({
  page,
  request,
}) => {
  const OTHER = '66666666-6666-4666-8666-666666666666'
  await request.post(`${MOCK}/__seed`, {
    data: {
      profile: { role: 'admin' },
      authUsers: [{ id: OTHER, email: 'bea@test.dev', display_name: 'Bea' }],
    },
  })
  await login(page)
  await page.goto('/admin/invitaciones')
  const toggle = page.getByRole('switch', { name: 'Permitir que los usuarios inviten' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.getByLabel('Máximo de invitaciones activas por usuario').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect
    .poll(async () => (await state(request)).inviteSettings)
    .toEqual({ members_can_invite: true, max_active_invites_per_user: 5 })

  const row = page.getByRole('listitem').filter({ hasText: 'bea@test.dev' })
  page.once('dialog', (d) => void d.accept())
  await row.getByRole('button', { name: /Generar contraseña temporal/ }).click()
  const pw = page.getByTestId('temp-password')
  await expect(pw).toHaveText(/^[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}$/)
  const password = (await pw.textContent())!
  const s = await state(request)
  expect(s.passwordUpdates).toEqual([{ id: OTHER, password }])
  expect(s.otherProfiles[OTHER]!.must_change_password).toBe(true)
  await shot(page, 'contrasena-temporal')
  // Se muestra una sola vez.
  await page.getByRole('button', { name: 'Hecho' }).click()
  await expect(page.getByTestId('temp-password')).toHaveCount(0)
  await expect(row.getByText('Contraseña temporal', { exact: true })).toBeVisible()

  // Quien entra con una contraseña temporal tiene que cambiarla antes de nada.
  await request.post(`${MOCK}/__seed`, {
    data: { profile: { role: 'member', must_change_password: true } },
  })
  await page.goto('/progreso')
  await expect(page).toHaveURL(/\/cambiar-contrasena/)
  await page.getByLabel('Nueva contraseña (mínimo 8 caracteres)').fill('nuevaclave9')
  await page.getByLabel('Repite la contraseña').fill('nuevaclave9')
  await page.getByRole('button', { name: 'Guardar y entrar' }).click()
  await expect(page).toHaveURL(`${APP}/`)
  const after = await state(request)
  expect(after.passwordUpdates.at(-1)).toEqual({
    id: '11111111-1111-4111-8111-111111111111',
    password: 'nuevaclave9',
  })
  expect(after.profile.must_change_password).toBe(false)
})
