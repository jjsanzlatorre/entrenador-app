import type { QueryClient } from '@tanstack/react-query'
import { getAuthState } from '@/server/auth.functions'
import type { AuthState } from '@/server/auth.server'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { clearCachedPages } from '@/lib/pwa'
import { disablePush } from '@/lib/notifications/push'

export const authQueryKey = ['auth'] as const

const AUTH_CACHE_KEY = 'entrenador:auth'

function readCachedAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY)
    return raw ? (JSON.parse(raw) as AuthState) : null
  } catch {
    return null
  }
}

function writeCachedAuth(auth: AuthState) {
  try {
    if (auth.status === 'active') localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(auth))
    else localStorage.removeItem(AUTH_CACHE_KEY)
  } catch {
    // almacenamiento no disponible: sin caché offline
  }
}

// Estado de sesión cacheado 1 min para no pedirlo al servidor en cada navegación.
// En el navegador, si no hay conexión, se usa el último estado conocido para poder
// seguir registrando el entreno (el servidor sigue validando cada escritura).
export function ensureAuthState(queryClient: QueryClient) {
  return queryClient.ensureQueryData({
    queryKey: authQueryKey,
    queryFn: async () => {
      if (typeof window === 'undefined') return getAuthState()
      try {
        const auth = await getAuthState()
        writeCachedAuth(auth)
        return auth
      } catch (error) {
        const cached = readCachedAuth()
        if (cached) {
          console.warn('[auth] sin conexión: usando la sesión guardada', error)
          return cached
        }
        throw error
      }
    },
    staleTime: 60_000,
    networkMode: 'always',
  })
}

// Vuelve a pedir el estado (p. ej. tras editar el perfil). El root lo lee con
// ensureQueryData, que devuelve la copia en caché aunque esté invalidada, y la query no
// tiene observadores: hay que forzar el refetch también de las queries inactivas.
export function resetAuthState(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: authQueryKey, refetchType: 'all' })
}

// Cierra sesión y borra lo que permitiría ver la app sin conexión.
export async function signOut(queryClient: QueryClient) {
  // Este dispositivo deja de recibir las notificaciones de quien sale (antes de perder la sesión).
  await disablePush().catch(() => {})
  await getSupabaseBrowserClient().auth.signOut()
  try {
    localStorage.removeItem(AUTH_CACHE_KEY)
  } catch {
    // nada que borrar
  }
  await clearCachedPages()
  queryClient.removeQueries({ queryKey: authQueryKey })
}
