import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { renderServiceWorker } from '../../scripts/vite-sw-plugin'

describe('service worker', () => {
  it('la plantilla genera JavaScript válido sin marcadores pendientes', () => {
    const template = readFileSync(join(import.meta.dirname, '../../src/sw/sw.js'), 'utf8')
    const sw = renderServiceWorker(template, 'abc123', ['/assets/a.js', '/icons/icon-192.png'])
    expect(() => new Script(sw)).not.toThrow()
    expect(sw).not.toMatch(/__VERSION__|__PRECACHE__/)
    expect(sw).toContain('const VERSION = "abc123"')
    expect(sw).toContain('const PRECACHE = ["/assets/a.js","/icons/icon-192.png"]')
  })
})

describe('páginas para abrir sin conexión', () => {
  it('todas las rutas de PAGES_TO_CACHE existen, incluidas las de la fase 4 y el plan', async () => {
    const { PAGES_TO_CACHE } = await import('../../src/lib/pwa')
    const tree = readFileSync(join(import.meta.dirname, '../../src/routeTree.gen.ts'), 'utf8')
    for (const path of PAGES_TO_CACHE) {
      if (path === '/') continue
      expect(tree, path).toContain(`'${path}': typeof`)
    }
    for (const path of [
      '/progreso/musculos',
      '/progreso/carga',
      '/plan',
      '/plan/elegir',
      '/onboarding',
    ]) {
      expect(PAGES_TO_CACHE).toContain(path)
    }
  })
})
