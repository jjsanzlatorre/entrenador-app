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
