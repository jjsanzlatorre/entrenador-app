import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Fase 7B: exportar datos (JSON y CSV), Notificaciones sin claves y dark mode sin roturas.
import { MOCK, authCookie } from './helpers'

test.beforeEach(async ({ context, request }) => {
  await request.post(`${MOCK}/__reset`)
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: authCookie(), url: 'http://localhost:3100' },
  ])
})

test('Exportar mis datos: JSON completo y CSV en ZIP', async ({ page }) => {
  await page.goto('/perfil')
  await page.getByRole('link', { name: /Exportar mis datos/ }).click()
  await expect(page.getByRole('heading', { name: 'Exportar mis datos' })).toBeVisible()

  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar JSON' }).click(),
  ])
  expect(json.suggestedFilename()).toMatch(/^entrenador-copia-\d{4}-\d{2}-\d{2}\.json$/)
  const data = JSON.parse(readFileSync((await json.path())!, 'utf8')) as {
    app: string
    tables: Record<string, unknown[]>
  }
  expect(data.app).toBe('entrenador')
  for (const t of ['workout_sessions', 'exercise_sets', 'body_metrics', 'commitments'])
    expect(Array.isArray(data.tables[t])).toBe(true)

  const [zip] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar CSV (ZIP)' }).click(),
  ])
  expect(zip.suggestedFilename()).toMatch(/\.zip$/)
  const bytes = readFileSync((await zip.path())!)
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
  expect(bytes.toString('latin1')).toContain('series.csv')
})

test('Notificaciones sin claves VAPID: aviso claro, la app sigue igual', async ({ page }) => {
  await page.goto('/perfil/notificaciones')
  await expect(page.getByText('Notificaciones sin configurar')).toBeVisible()
  await expect(page.getByText(/administrador aún no ha activado/)).toBeVisible()
})

test('modo oscuro: los colores siguen al sistema', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/perfil')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // Fondo oscuro (oklch 0.145): los tres canales por debajo de 60.
  const channels = (bg.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  expect(bg.startsWith('oklch') ? Number(channels[0]) < 0.3 : channels.every((c) => c < 60)).toBe(
    true,
  )
})
