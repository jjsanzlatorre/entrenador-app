import { expect, test, type Locator, type Page } from '@playwright/test'

// Fase 6C: técnica de ejercicios en la biblioteca y en la sesión en curso (sin perder el
// descanso), imágenes cargadas solo al abrir el detalle y guardadas en caché tras verlas.
import { MOCK, authCookie } from './helpers'

// E2E_SCREENSHOTS=<dir> guarda capturas a 375 px.
const SHOTS = process.env.E2E_SCREENSHOTS

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

async function expectImagesLoaded(images: Locator, count: number) {
  await expect(images).toHaveCount(count)
  for (let i = 0; i < count; i++) {
    await expect
      .poll(() => images.nth(i).evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)
  }
}

function exerciseImageRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/exercises/')) urls.push(r.url())
  })
  return urls
}

test.beforeEach(async ({ context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
})

test('biblioteca: imágenes, pasos, errores, vídeo y fuente; sin imágenes en la lista', async ({
  page,
}) => {
  const imageRequests = exerciseImageRequests(page)
  await page.goto('/entrenar/ejercicios')
  await expect(page.getByRole('heading', { name: 'Ejercicios' })).toBeVisible()
  await expect(page.getByRole('button').filter({ hasText: 'Press banca' }).first()).toBeVisible()
  expect(imageRequests).toEqual([])

  await page.getByRole('button').filter({ hasText: 'Press banca' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Pasos clave' })).toBeVisible()
  await expect(dialog.getByRole('listitem').first()).toContainText('Túmbate')
  await expect(dialog.getByRole('heading', { name: /Errores típicos/ })).toBeVisible()
  await expectImagesLoaded(dialog.getByRole('img', { name: /Press banca: posición/ }), 2)
  await expect(dialog.getByText('Posición inicial')).toBeVisible()
  await expect(dialog.getByText('Posición final')).toBeVisible()
  await expect(dialog.getByText(/Free Exercise DB.*Unlicense/)).toBeVisible()
  await shot(page, 'technique-library')

  const video = dialog.getByRole('link', { name: /Ver técnica en vídeo/ })
  await expect(video).toHaveAttribute('target', '_blank')
  const href = new URL((await video.getAttribute('href'))!)
  expect(href.hostname).toBe('www.youtube.com')
  expect(href.searchParams.get('search_query')).toBe('técnica Press banca')

  // Tras verlas una vez quedan en la caché del service worker.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  })
  await page.reload()
  await page.getByRole('button').filter({ hasText: 'Press banca' }).first().click()
  await expectImagesLoaded(
    page.getByRole('dialog').getByRole('img', { name: /Press banca: posición/ }),
    2,
  )
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('exercise-images-v1')
        return (await cache.keys()).map((r) => new URL(r.url).pathname).sort()
      }),
    )
    .toEqual(['/exercises/bench_press-end.webp', '/exercises/bench_press-start.webp'])

  // Un ejercicio sin imagen (HYROX): pasos y vídeo, sin fuente.
  await page.keyboard.press('Escape')
  await page.getByRole('searchbox').fill('wall ball')
  await page.getByRole('button').filter({ hasText: 'Wall ball' }).first().click()
  const wall = page.getByRole('dialog')
  await expect(wall.getByRole('heading', { name: 'Pasos clave' })).toBeVisible()
  await expect(wall.getByRole('img')).toHaveCount(0)
  await expect(wall.getByRole('link', { name: /Ver técnica en vídeo/ })).toBeVisible()
  await expect(wall.getByText(/Free Exercise DB/)).toHaveCount(0)
})

test('sesión: la técnica se abre en una hoja sin perder el descanso', async ({ page }) => {
  await page.goto('/entrenar')
  await page.getByRole('button', { name: 'Empezar entreno' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Fuerza/ })
    .click()
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)

  await page.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByRole('searchbox', { name: 'Buscar ejercicio' }).fill('sentadilla con barra')
  await picker.getByRole('button').filter({ hasText: 'Sentadilla con barra' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Sentadilla con barra', exact: true }),
  ).toBeVisible()

  const block = page.getByRole('region', { name: 'Bloque A' })
  await block
    .getByRole('button', { name: /^Peso \(kg\)/ })
    .first()
    .click()
  await block.getByRole('textbox', { name: 'Peso (kg)' }).fill('60')
  await block.getByRole('textbox', { name: 'Peso (kg)' }).press('Enter')
  await block
    .getByRole('button', { name: /^Repeticiones/ })
    .first()
    .click()
  await block.getByRole('textbox', { name: 'Repeticiones' }).fill('5')
  await block.getByRole('textbox', { name: 'Repeticiones' }).press('Enter')
  await block.getByRole('button', { name: 'Completar 1' }).click()
  const timer = page.getByRole('timer')
  await expect(timer).toContainText('Descanso')

  // Un toque en el nombre abre la técnica.
  await block.getByRole('button', { name: 'Sentadilla con barra', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Sentadilla con barra' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Pasos clave' })).toBeVisible()
  await expectImagesLoaded(sheet.getByRole('img', { name: /Sentadilla con barra: posición/ }), 2)
  await expect(sheet.getByRole('link', { name: /Ver técnica en vídeo/ })).toBeVisible()
  await shot(page, 'technique-session')
  await page.waitForTimeout(1500)
  await sheet.getByRole('button', { name: 'Cerrar' }).last().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Seguimos en la sesión y el descanso sigue corriendo.
  await expect(page).toHaveURL(/\/entrenar\/sesion$/)
  await expect(timer).toContainText('Descanso')
  const seconds = async () => {
    const text = (await timer.locator('p').nth(1).textContent()) ?? ''
    const [m, s] = text.split(':').map(Number)
    return m! * 60 + s!
  }
  const first = await seconds()
  expect(first).toBeLessThan(180)
  await expect.poll(seconds).toBeLessThan(first)
  await expect(block.getByRole('button', { name: '1 hecha. Tocar para desmarcar' })).toBeVisible()

  // También desde el menú del ejercicio.
  await block.getByRole('button', { name: 'Opciones de Sentadilla con barra' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ver técnica' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Pasos clave' })).toBeVisible()
})
