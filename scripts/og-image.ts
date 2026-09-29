// Genera public/og-invite.png (1200 × 630): vista previa de los enlaces /unirse/* en WhatsApp.
// Sin datos personales. Uso: node scripts/og-image.ts
// (en el contenedor: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const root = join(import.meta.dirname, '..')
const icon = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8')

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; font-family: 'DejaVu Sans', system-ui, sans-serif;
    background: #1d4ed8; color: #fff;
    display: flex; align-items: center; padding: 0 96px; gap: 72px; overflow: hidden; }
  .icon { width: 260px; height: 260px; flex: none; border-radius: 60px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, .35); }
  .icon svg { width: 100%; height: 100%; }
  .kicker { font-size: 34px; font-weight: 600; opacity: .85; letter-spacing: .5px; }
  h1 { font-size: 68px; line-height: 1.05; font-weight: 800; margin: 16px 0 28px; }
  p { font-size: 34px; line-height: 1.35; opacity: .92; max-width: 640px; }
  .emoji { font-size: 40px; }
</style></head><body>
  <div class="icon">${icon}</div>
  <div>
    <div class="kicker">Entrenador</div>
    <h1>Te han invitado<br>a entrenar juntos</h1>
    <p>Registra tus entrenos, cumple tu compromiso semanal y ved vuestro progreso.</p>
  </div>
</body></html>`

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
})
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html)
await page.screenshot({ path: join(root, 'public/og-invite.png'), type: 'png' })
await browser.close()
console.log('public/og-invite.png')
