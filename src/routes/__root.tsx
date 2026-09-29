import { useEffect, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RootError, logError } from '@/components/root-error'
import { Toaster } from '@/components/ui/sonner'
import { ensureAuthState } from '@/lib/auth'
import { ConfigError, readPublicEnv } from '@/lib/env'
import { captureInstallPrompt, registerServiceWorker } from '@/lib/pwa'
import appCss from '@/styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context }) => {
    const { problems } = readPublicEnv()
    if (problems.length > 0) {
      const error = new ConfigError(problems)
      logError('root.beforeLoad', error)
      throw error
    }
    try {
      const auth = await ensureAuthState(context.queryClient)
      return { auth }
    } catch (error) {
      logError('root.beforeLoad', error)
      throw error
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'Entrenador' },
      { name: 'description', content: 'Tu entrenador personal' },
      { name: 'theme-color', content: '#2563eb', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#0a0a0a', media: '(prefers-color-scheme: dark)' },
      // Controles nativos (select, fecha…) en oscuro cuando el sistema lo está.
      { name: 'color-scheme', content: 'light dark' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-title', content: 'Entrenador' },
    ],
    scripts: [
      {
        // Config pública para el navegador, leída en el servidor en tiempo de ejecución.
        children: `window.__PUBLIC_ENV__=${serializePublicEnv()}`,
      },
    ],
    links: [
      // Adelanta la conexión con Supabase (DNS + TLS): «Hoy» pide datos nada más cargar.
      ...supabasePreconnect(),
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/icons/icon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  errorComponent: RootError,
  onCatch: (error) => logError('root.onCatch', error),
  notFoundComponent: () => (
    <div className="p-6 text-center">
      <p className="text-lg font-semibold">Página no encontrada</p>
      <a href="/" className="text-primary mt-4 inline-block underline">
        Volver a Hoy
      </a>
    </div>
  ),
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  useEffect(() => {
    registerServiceWorker()
    captureInstallPrompt()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  )
}

function supabasePreconnect() {
  const url = readPublicEnv().env?.supabaseUrl
  if (!url) return []
  try {
    return [{ rel: 'preconnect', href: new URL(url).origin, crossOrigin: 'anonymous' as const }]
  } catch {
    return []
  }
}

function serializePublicEnv() {
  const { env } = readPublicEnv()
  // Escapa "<" para que el valor no pueda cerrar la etiqueta <script>.
  return JSON.stringify(env ?? {}).replace(/</g, '\\u003c')
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
