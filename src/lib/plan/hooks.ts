import { useQuery, type QueryClient } from '@tanstack/react-query'
import { fetchActivePlan, fetchTemplates, fetchTrainingProfile } from './api'

export const trainingProfileKey = (userId: string) => ['training-profile', userId] as const
export const activePlanKey = (userId: string) => ['active-plan', userId] as const

export function useTrainingProfile(userId: string) {
  return useQuery({
    queryKey: trainingProfileKey(userId),
    queryFn: () => fetchTrainingProfile(userId),
    networkMode: 'always',
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export function usePlanTemplates() {
  return useQuery({
    queryKey: ['plan-templates'],
    queryFn: fetchTemplates,
    networkMode: 'always',
    staleTime: 60 * 60_000,
    retry: 1,
  })
}

export function useActivePlan(userId: string) {
  return useQuery({
    queryKey: activePlanKey(userId),
    queryFn: () => fetchActivePlan(userId),
    networkMode: 'always',
    staleTime: 30_000,
    retry: 1,
  })
}

export async function refreshPlan(queryClient: QueryClient, userId: string) {
  await queryClient.invalidateQueries({ queryKey: activePlanKey(userId) })
}
