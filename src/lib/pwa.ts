// Registro del service worker y utilidades de la caché de páginas (ver src/sw/sw.js).
// Se guardan al abrir la app con conexión para poder abrirlas después sin red, en frío.
export const PAGES_TO_CACHE = [
  '/',
  '/entrenar',
  '/entrenar/sesion',
  '/entrenar/ejercicios',
  '/progreso/musculos',
  '/progreso/carga',
  '/plan',
  '/plan/elegir',
  '/onboarding',
]

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

// Evento beforeinstallprompt (Chrome/Android): llega pronto, antes de que se abra la pantalla de
// instalar, así que se captura al arrancar la app y se guarda para usarlo después.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let installPrompt: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt = e as InstallPromptEvent
    for (const fn of installListeners) fn()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    for (const fn of installListeners) fn()
  })
}

export function canPromptInstall() {
  return installPrompt !== null
}

export function onInstallPromptChange(fn: () => void) {
  installListeners.add(fn)
  return () => {
    installListeners.delete(fn)
  }
}

export async function promptInstall() {
  const event = installPrompt
  if (!event) return false
  installPrompt = null
  await event.prompt()
  const { outcome } = await event.userChoice
  for (const fn of installListeners) fn()
  return outcome === 'accepted'
}
