// Registra el service worker solo en producción (en dev interferiría con Vite HMR).
export function registerServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.error('No se pudo registrar el service worker', err)
    })
  })
}
