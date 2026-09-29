// Tipos de actividad (CLAUDE.md §6): los globales (carrera, natación, deportes, clases de
// gimnasio…) con su aproximación muscular y las actividades personalizadas de cada usuario.
// Los datos salen de la tabla activity_types (semilla: supabase/seed/activity_types.json); el
// mismo JSON va en el bundle como valores por defecto para que todo funcione sin conexión y en
// el servidor. Lógica pura + un registro en memoria que la app rellena al cargar la tabla.
import seed from '../../../supabase/seed/activity_types.json'
import type { ActivityTypeRow, SessionLocation, SessionType } from '@/types/database'

export type ActivityType = {
  // Globales: id = session_type. Personalizadas: 'a_…'.
  id: string
  ownerId: string | null
  name: string
  emoji: string
  exerciseId: string
  location: SessionLocation
  muscles: string[]
  setsPer30Min: number
  // Sale en «Registrar actividad».
  quick: boolean
  // Se puede elegir como actividad fija (onboarding / perfil de entrenamiento).
  fixed: boolean
  // Solo cuenta para el compromiso si counts_free_activities.
  freeActivity: boolean
  // El planificador no pone pierna pesada el día antes (ni ese día).
  legLoading: boolean
  // Cuenta como sesión intensa de pierna y core («dos intensas seguidas»).
  hardLegs: boolean
  sortOrder: number
  archived: boolean
}

type SeedActivity = (typeof seed.activity_types)[number]

function fromSeed(a: SeedActivity): ActivityType {
  return {
    id: a.id,
    ownerId: null,
    name: a.name,
    emoji: a.emoji,
    exerciseId: a.exercise_id,
    location: a.location as SessionLocation,
    muscles: a.muscles,
    setsPer30Min: a.sets_per_30min,
    quick: a.quick,
    fixed: a.fixed,
    freeActivity: a.free_activity,
    legLoading: a.leg_loading,
    hardLegs: a.hard_legs,
    sortOrder: a.sort_order,
    archived: false,
  }
}

export function fromActivityRow(row: ActivityTypeRow): ActivityType {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    emoji: row.emoji,
    exerciseId: row.exercise_id,
    location: row.location,
    muscles: row.muscles ?? [],
    setsPer30Min: Number(row.sets_per_30min),
    quick: row.quick,
    fixed: row.fixed,
    freeActivity: row.free_activity,
    legLoading: row.leg_loading,
    hardLegs: row.hard_legs,
    sortOrder: row.sort_order,
    archived: row.archived,
  }
}

export const DEFAULT_ACTIVITY_TYPES: ActivityType[] = seed.activity_types.map(fromSeed)

// Tipos de sesión que no son una actividad del catálogo (entrenos con ejercicios).
const WORKOUT_TYPES: Partial<Record<SessionType, { label: string; emoji: string }>> = {
  strength: { label: 'Fuerza', emoji: '🏋️' },
  functional: { label: 'Functional', emoji: '🔥' },
  custom: { label: 'Actividad personalizada', emoji: '⭐' },
}

// Tipo de antes de 0031 (lo pueden traer copias locales y móviles con la versión anterior).
export function normalizeSessionType(type: string): SessionType {
  return (type === 'padel_fronton' ? 'fronton' : type) as SessionType
}

export const isCustomActivityId = (id: string) => id.startsWith('a_')

// ── Registro ────────────────────────────────────────────────

let registry = new Map<string, ActivityType>(DEFAULT_ACTIVITY_TYPES.map((a) => [a.id, a]))
let version = 0
const listeners = new Set<() => void>()

// Sustituye el registro: globales por defecto + las filas de la base de datos (que mandan).
export function setActivityTypes(rows: ActivityType[]) {
  const next = new Map<string, ActivityType>(DEFAULT_ACTIVITY_TYPES.map((a) => [a.id, a]))
  for (const r of rows) next.set(r.id, r)
  registry = next
  version++
  for (const l of listeners) l()
}

// Añade filas sin quitar las que hay (p. ej. las actividades de una persona vinculada).
export function addActivityTypes(rows: ActivityType[]) {
  if (rows.every((r) => registry.get(r.id) === r)) return
  const next = new Map(registry)
  for (const r of rows) next.set(r.id, r)
  registry = next
  version++
  for (const l of listeners) l()
}

export function subscribeActivityTypes(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const activityTypesVersion = () => version

export function allActivityTypes() {
  return [...registry.values()]
}

export function getActivityType(key: string | null | undefined) {
  return key ? registry.get(key) : undefined
}

// ── Claves, nombres y reglas ────────────────────────────────

// Clave de actividad de una sesión: la personalizada si la hay; si no, el tipo de sesión.
export function activityKey(s: { sessionType: SessionType; activityTypeId?: string | null }) {
  return s.sessionType === 'custom' && s.activityTypeId ? s.activityTypeId : s.sessionType
}

export function activityLabel(key: string) {
  return (
    registry.get(key)?.name ??
    WORKOUT_TYPES[key as SessionType]?.label ??
    (isCustomActivityId(key) ? 'Actividad personalizada' : 'Actividad')
  )
}

export function activityEmoji(key: string) {
  return registry.get(key)?.emoji ?? WORKOUT_TYPES[key as SessionType]?.emoji ?? '⭐'
}

// Aproximación muscular (§6): músculos y series equivalentes por cada 30 min.
export function activityApprox(key: string) {
  const a = registry.get(key)
  if (!a || a.muscles.length === 0 || a.setsPer30Min <= 0) return undefined
  return { muscles: a.muscles, setsPer30Min: a.setsPer30Min }
}

// Actividades libres (compromiso): las marcadas en los datos y todas las personalizadas.
export function isFreeActivity(type: SessionType) {
  if (type === 'custom') return true
  return registry.get(type)?.freeActivity ?? false
}

// Sesión registrada como actividad (duración + RPE, sin ejercicios): deportes, clases, yoga,
// «otra» y las personalizadas.
export function isActivitySessionType(type: SessionType) {
  return type === 'custom' || (registry.get(type)?.quick ?? false)
}

export const isLegLoadingActivity = (key: string) => registry.get(key)?.legLoading ?? false
export const isHardLegsActivity = (key: string) => registry.get(key)?.hardLegs ?? false

function sorted(list: ActivityType[]) {
  return list.sort(
    (a, b) =>
      Number(a.ownerId !== null) - Number(b.ownerId !== null) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, 'es'),
  )
}

// Personalizadas de un usuario (sin las archivadas, salvo que se pidan).
export function customActivities(userId: string, includeArchived = false) {
  return sorted(
    allActivityTypes().filter((a) => a.ownerId === userId && (includeArchived || !a.archived)),
  )
}

// «Registrar actividad»: globales rápidas + las personalizadas del usuario.
export function quickActivityOptions(userId: string) {
  return sorted(
    allActivityTypes().filter(
      (a) => (a.ownerId === null && a.quick) || (a.ownerId === userId && !a.archived),
    ),
  )
}

// Actividades fijas: globales marcadas + personalizadas del usuario.
export function fixedActivityOptions(userId: string) {
  return sorted(
    allActivityTypes().filter(
      (a) => (a.ownerId === null && a.fixed) || (a.ownerId === userId && !a.archived),
    ),
  )
}

// Tipo de sesión con el que se guarda una actividad.
export function sessionTypeForActivity(a: Pick<ActivityType, 'id' | 'ownerId'>): {
  sessionType: SessionType
  activityTypeId: string | null
} {
  return a.ownerId === null
    ? { sessionType: a.id as SessionType, activityTypeId: null }
    : { sessionType: 'custom', activityTypeId: a.id }
}
