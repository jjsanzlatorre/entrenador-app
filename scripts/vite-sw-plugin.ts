import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })
}

// Sustituye los marcadores del código (no los de los comentarios) de la plantilla.
export function renderServiceWorker(template: string, version: string, precache: string[]) {
  if (!template.includes("'__VERSION__'") || !template.includes('= __PRECACHE__')) {
    throw new Error('La plantilla del service worker no tiene los marcadores esperados')
  }
  return template
    .replaceAll("'__VERSION__'", JSON.stringify(version))
    .replaceAll('= __PRECACHE__', `= ${JSON.stringify(precache)}`)
}

// Genera /sw.js en el build del cliente con la lista de assets a precargar y una versión
// derivada de su contenido: cada deploy instala un service worker nuevo y limpia cachés viejas.
export function serviceWorkerPlugin(options: { template: string; publicDir: string }): Plugin {
  return {
    name: 'entrenador-service-worker',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !f.endsWith('.html') && f !== 'sw.js')
        .map((f) => `/${f}`)
      const publicFiles = listFiles(options.publicDir)
        .map((f) => `/${relative(options.publicDir, f).split('\\').join('/')}`)
        .filter((f) => f !== '/sw.js' && !f.endsWith('.svg'))
      const precache = [...new Set([...built, ...publicFiles])].sort()
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const source = renderServiceWorker(readFileSync(options.template, 'utf8'), version, precache)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
