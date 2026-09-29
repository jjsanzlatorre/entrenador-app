// Tipos de actividad desde Supabase (RLS: globales, propios y los de personas vinculadas que me
// comparten entrenos, mapa o logros), con copia en IndexedDB para usarlos sin conexión.
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { idbGet, idbPut } from '@/lib/offline/idb'
import { OfflineError, isOnline, withTimeout } from '@/lib/workout/api'
import type { ActivityTypeRow } from '@/types/database'
import { fromActivityRow, setActivityTypes, type ActivityType } from './catalog'

const cacheKey = (userId: string) => `activity-types:${userId}`

export async function fetchActivityTypes(userId: string): Promise<ActivityType[]> {
  let list: ActivityType[] | undefined
  if (isOnline()) {
    try {
      const { data, error } = await withTimeout(
        getSupabaseBrowserClient().from('activity_types').select('*').order('sort_order'),
      )
      if (error) throw new Error(error.message)
      list = (data as ActivityTypeRow[]).map(fromActivityRow)
      await idbPut('kv', cacheKey(userId), list)
    } catch (error) {
      console.error('[activity-types] usando la copia local', error)
    }
  }
  list ??= (await idbGet<ActivityType[]>('kv', cacheKey(userId))) ?? []
  setActivityTypes(list)
  return list
}

export type CustomActivityInput = { name: string; emoji: string; muscles: string[] }

function clean(input: CustomActivityInput) {
  const name = input.name.trim().slice(0, 40)
  if (!name) throw new Error('Ponle un nombre a la actividad')
  return { name, emoji: input.emoji.trim() || '⭐', muscles: [...new Set(input.muscles)] }
}

export async function createCustomActivity(userId: string, input: CustomActivityInput) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para crear actividades')
  const { data, error } = await getSupabaseBrowserClient()
    .from('activity_types')
    .insert({ ...clean(input), owner_id: userId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return fromActivityRow(data as ActivityTypeRow)
}

export async function updateCustomActivity(
  id: string,
  patch: Partial<CustomActivityInput> & { archived?: boolean },
) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión para cambiar actividades')
  const values =
    patch.name !== undefined
      ? { ...clean({ name: patch.name, emoji: patch.emoji ?? '', muscles: patch.muscles ?? [] }) }
      : {}
  const { data, error } = await getSupabaseBrowserClient()
    .from('activity_types')
    .update({ ...values, ...(patch.archived !== undefined ? { archived: patch.archived } : {}) })
    .eq('id', id)
    .select('*')
  if (error) throw new Error(error.message)
  // Sin filas: la RLS no ha dejado cambiarla (no es propia).
  if (!data || data.length === 0) throw new Error('No se ha podido guardar la actividad')
  return fromActivityRow(data[0] as ActivityTypeRow)
}
