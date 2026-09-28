// Service worker de la PWA. Plantilla: el build (scripts/vite-sw-plugin.ts) sustituye
// los marcadores de VERSION y PRECACHE por la versión y la lista de assets de ese build.
//
// Estrategia:
// - Assets del build (JS/CSS con hash) e iconos: se precargan al instalar y se sirven de caché.
// - Páginas: red primero (con límite de tiempo); si no hay red, la última copia guardada
//   de esa página. Así la app abre y la sesión en curso se puede seguir registrando offline.
// - Funciones de servidor y Supabase: siempre red (los datos offline van por IndexedDB).
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const STATIC_CACHE = `static-${VERSION}`
const PAGES_CACHE = `pages-${VERSION}`
const NAVIGATION_TIMEOUT_MS = 4000
const NO_CACHE_PATHS = ['/login', '/auth/', '/api/', '/bloqueado', '/_serverFn']

const OFFLINE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}a{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none}</style>
</head><body><div><h1>Sin conexión</h1><p>Esta página aún no está guardada en el móvil.</p>
<a href="/entrenar/sesion">Ir a la sesión en curso</a></div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function shouldCachePage(url) {
  return !NO_CACHE_PATHS.some((p) => url.pathname.startsWith(p))
}

function pageKey(url) {
  // Una copia por ruta, sin query ni hash.
  return new Request(url.origin + url.pathname)
}

async function cachePage(url, response) {
  if (!response.ok || response.redirected || !shouldCachePage(url)) return
  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/html')) return
  const cache = await caches.open(PAGES_CACHE)
  await cache.put(pageKey(url), response)
}

async function handleNavigation(request) {
  const url = new URL(request.url)
  const network = fetch(request).then((response) => {
    cachePage(url, response.clone()).catch(() => {})
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS))
  try {
    const response = await Promise.race([network, timeout])
    if (response) return response
  } catch {
    // sin red: se intenta la copia guardada
  }
  const cached = await caches.match(pageKey(url), { cacheName: PAGES_CACHE })
  if (cached) return cached
  try {
    // Cobertura lenta: si no hay copia, se sigue esperando a la red.
    return await network
  } catch {
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE)
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(handleAsset(request))
  }
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'cache-pages' && Array.isArray(data.urls)) {
    event.waitUntil(
      Promise.all(
        data.urls.map(async (path) => {
          const url = new URL(path, self.location.origin)
          try {
            const response = await fetch(url, { credentials: 'same-origin' })
            await cachePage(url, response)
          } catch {
            // sin conexión: se intentará la próxima vez
          }
        }),
      ),
    )
  }
  if (data.type === 'clear-pages') {
    event.waitUntil(caches.delete(PAGES_CACHE))
  }
})
