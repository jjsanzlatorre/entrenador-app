import type { QueryClient } from '@tanstack/react-query'
import { getAuthState } from '@/server/auth.functions'

export const authQueryKey = ['auth'] as const

// Estado de sesión cacheado 1 min para no pedirlo al servidor en cada navegación.
export function ensureAuthState(queryClient: QueryClient) {
  return queryClient.ensureQueryData({
    queryKey: authQueryKey,
    queryFn: () => getAuthState(),
    staleTime: 60_000,
  })
}

export function resetAuthState(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: authQueryKey })
}
