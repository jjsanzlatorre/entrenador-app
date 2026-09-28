// Registro del service worker y utilidades de la caché de páginas (ver src/sw/sw.js).
export const PAGES_TO_CACHE = ['/', '/entrenar', '/entrenar/sesion', '/entrenar/ejercicios']

// Solo en producción (en dev interferiría con Vite HMR).
export function registerServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.error('No se pudo registrar el service worker', err)
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

async function postToServiceWorker(message: unknown) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  registration.active?.postMessage(message)
}

// Guarda las páginas principales para poder abrir la app sin conexión.
export function warmPageCache() {
  if (import.meta.env.DEV || !navigator.onLine) return
  void postToServiceWorker({ type: 'cache-pages', urls: PAGES_TO_CACHE })
}

export async function clearCachedPages() {
  if (typeof window === 'undefined') return
  await postToServiceWorker({ type: 'clear-pages' })
}
