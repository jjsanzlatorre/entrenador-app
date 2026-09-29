import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchActivityTypes } from './api'
import { activityTypesVersion, subscribeActivityTypes } from './catalog'

export const activityTypesQueryKey = (userId: string) => ['activity-types', userId] as const

// Carga los tipos de actividad (y las personalizadas) en el registro y hace que el componente se
// vuelva a pintar cuando cambian. Devuelve la versión del registro (para dependencias de useMemo).
export function useActivityTypes(userId: string) {
  useQuery({
    queryKey: activityTypesQueryKey(userId),
    queryFn: () => fetchActivityTypes(userId),
    staleTime: 5 * 60_000,
    networkMode: 'always',
    retry: 1,
  })
  return useSyncExternalStore(subscribeActivityTypes, activityTypesVersion, activityTypesVersion)
}
