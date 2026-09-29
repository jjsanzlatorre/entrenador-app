import { expect, test, type Page } from '@playwright/test'

// Márgenes de seguridad (CLAUDE.md §2): simula un iPhone con Dynamic Island y barra de gestos
// (vertical: 59 px arriba y 34 abajo; horizontal: 59 a cada lado y 21 abajo) sobrescribiendo las
// variables --safe-* que la app toma de env(safe-area-inset-*). En cada pantalla comprueba que
// ningún control queda bajo la barra de estado, que lo fijo abajo (navegación, barras, pies de
// hoja) no queda bajo la barra de gestos y que, en horizontal, nada queda bajo el notch.
import { MOCK, authCookie } from './helpers'

type Insets = { top: number; right: number; bottom: number; left: number }
const PORTRAIT: Insets = { top: 59, right: 0, bottom: 34, left: 0 }
const LANDSCAPE: Insets = { top: 0, right: 59, bottom: 21, left: 59 }

async function simulateInsets(page: Page, insets: Insets) {
  await page.addInitScript((i) => {
    const css = `:root{--safe-top:${i.top}px!important;--safe-right:${i.right}px!important;--safe-bottom:${i.bottom}px!important;--safe-left:${i.left}px!important}`
    const add = () => {
      if (document.getElementById('e2e-safe-area')) return
      const style = document.createElement('style')
      style.id = 'e2e-safe-area'
      style.textContent = css
      document.documentElement.appendChild(style)
    }
    if (document.documentElement) add()
    document.addEventListener('DOMContentLoaded', add)
  }, insets)
}

// Controles visibles que invaden una zona insegura. Solo lo que está en pantalla: lo que queda
// más abajo en una página con scroll se alcanza desplazándola; lo fijo o sticky, no.
async function violations(page: Page, insets: Insets) {
  return page.evaluate((i) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pinned = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const p = getComputedStyle(e).position
        if (p === 'fixed' || p === 'sticky') return true
      }
      return false
    }
    // Parte visible del control: lo que sobresale de un contenedor con scroll (el cuerpo de una
    // hoja, p. ej.) está recortado y se alcanza desplazándolo.
    const clipped = (el: Element, r: DOMRect) => {
      let top = r.top
      let bottom = r.bottom
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowY
        if (o === 'visible') continue
        const c = e.getBoundingClientRect()
        top = Math.max(top, c.top)
        bottom = Math.min(bottom, c.bottom)
      }
      return { top, bottom }
    }
    const out: string[] = []
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, textarea, select, [role="switch"], [role="tab"]',
    )
    for (const el of controls) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue
      // Fondo de las hojas (botón «Cerrar» que cubre la pantalla): no es un control visible.
      if (r.width >= vw - 1 && r.height >= vh - 1) continue
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
        .trim()
        .slice(0, 40)
      // Lo que se desplaza por debajo de la banda de la barra de estado está tapado por ella (no
      // se puede tocar hasta volver a bajar); con la página arriba del todo, nada puede estar ahí.
      const scrolled = window.scrollY > 0
      const v = clipped(el, r)
      if (v.bottom <= v.top) continue
      if (v.top < i.top - 0.5 && (pinned(el) || !scrolled))
        out.push(`bajo la barra de estado: «${name}» (top ${v.top})`)
      if (pinned(el) && v.bottom > vh - i.bottom + 0.5)
        out.push(`bajo la barra de gestos: «${name}» (bottom ${v.bottom})`)
      if (r.left < i.left - 0.5 || r.right > vw - i.right + 0.5)
        out.push(`bajo el notch: «${name}» (${r.left}–${r.right})`)
    }
    return out
  }, insets)
}

async function expectSafe(page: Page, insets: Insets, label: string) {
  // Deja terminar las animaciones de entrada (hojas, pop-ups).
  await page.waitForTimeout(400)
  expect(await violations(page, insets), label).toEqual([])
}

async function login(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
    ])
}

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`)
})

test('vertical (Dynamic Island): cabeceras, navegación, pantallas completas, hojas y avisos', async ({
  page,
}) => {
  await simulateInsets(page, PORTRAIT)

  // Pantallas sueltas, sin sesión.
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Entrenador' })).toBeVisible()
  await expectSafe(page, PORTRAIT, '/login')
  await page.goto('/unirse/ABCD-EFGH-JKLM')
  await expect(page.getByText('Invitación no válida')).toBeVisible()
  await expectSafe(page, PORTRAIT, '/unirse')

  await login(page)
  // La barra de estado tiene su banda opaca del alto del margen.
  await page.goto('/')
  const scrim = page.locator('[data-status-bar-scrim]')
  await expect(scrim).toHaveCount(1)
  expect((await scrim.boundingBox())?.height).toBe(PORTRAIT.top)

  for (const path of [
    '/',
    '/entrenar',
    '/progreso',
    '/plan',
    '/perfil',
    '/perfil/actividades',
    '/entrenar/actividad',
    '/entrenador',
    '/progreso/logros',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expectSafe(page, PORTRAIT, path)
  }

  // Navegación inferior: encima de la barra de gestos.
  const nav = await page.getByRole('navigation', { name: 'Navegación principal' }).boundingBox()
  const vh = page.viewportSize()!.height
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(vh + 0.5)
  const hoy = await page.getByRole('link', { name: 'Hoy' }).boundingBox()
  expect(hoy!.y + hoy!.height).toBeLessThanOrEqual(vh - PORTRAIT.bottom + 0.5)

  // Pantallas a pantalla completa: onboarding (el fallo original: «Atrás» y «Saltar todo»)…
  await page.goto('/onboarding')
  await expect(page.getByRole('button', { name: 'Saltar todo' })).toBeVisible()
  await expectSafe(page, PORTRAIT, '/onboarding paso 1')
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.getByRole('button', { name: 'Atrás' })).toBeVisible()
  await expectSafe(page, PORTRAIT, '/onboarding paso 2')
  // … con scroll, los botones de arriba siguen fuera de la barra.
  await page.mouse.wheel(0, 2000)
  await expectSafe(page, PORTRAIT, '/onboarding con scroll')

  // … instalar la PWA …
  await page.goto('/instalar')
  await expect(page.getByRole('heading', { name: 'Instala la app' })).toBeVisible()
  await expectSafe(page, PORTRAIT, '/instalar')

  // … la sesión en curso, con su cabecera sticky y la hoja de empezar.
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectSafe(page, PORTRAIT, 'hoja «¿Qué vas a entrenar?»')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(page.getByRole('textbox', { name: 'Título de la sesión' })).toBeVisible()
  await expectSafe(page, PORTRAIT, '/entrenar/sesion')
  await page.mouse.wheel(0, 2000)
  await expectSafe(page, PORTRAIT, '/entrenar/sesion con scroll')

  // Hoja inferior con su pie y un aviso (toast) arriba.
  await page.goto('/perfil/actividades')
  await page.getByRole('button', { name: 'Nueva actividad' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectSafe(page, PORTRAIT, 'hoja «Nueva actividad»')
  await page.getByLabel('Nombre').fill('Escalada')
  await page.getByRole('button', { name: 'Crear actividad' }).click()
  const toast = page.getByText('«Escalada» creada')
  await expect(toast).toBeVisible()
  // Tras la animación de entrada (baja desde arriba), el aviso queda bajo la barra de estado.
  await expect
    .poll(async () => (await toast.boundingBox())?.y ?? 0)
    .toBeGreaterThanOrEqual(PORTRAIT.top)
})

test('horizontal (notch a un lado): nada queda bajo el notch ni la barra de gestos', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await simulateInsets(page, LANDSCAPE)
  await login(page)
  for (const path of ['/', '/entrenar', '/perfil', '/onboarding', '/entrenar/actividad']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expectSafe(page, LANDSCAPE, `${path} (horizontal)`)
  }
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectSafe(page, LANDSCAPE, 'hoja en horizontal')
})
