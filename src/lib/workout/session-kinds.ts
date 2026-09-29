// Tipos de sesión que se pueden empezar y el «Registrar actividad» rápido.
import {
  activityEmoji,
  activityKey,
  activityLabel,
  getActivityType,
  sessionTypeForActivity,
} from '@/lib/activities/catalog'
import type { SessionLocation, SessionType } from '@/types/database'
import { createSession, type IdFn } from './session-ops'
import { addTimedBlock } from './timed-blocks'
import type { LocalBlock, LocalSession } from './types'

export type StartOption = {
  sessionType: SessionType
  label: string
  title: string
  location: SessionLocation
  // Ejercicio del bloque continuo (cronómetro + distancia) con el que arranca.
  exerciseId: string | null
}

export const START_OPTIONS: StartOption[] = [
  {
    sessionType: 'strength',
    label: 'Fuerza',
    title: 'Entreno libre',
    location: 'gym',
    exerciseId: null,
  },
  {
    sessionType: 'functional',
    label: 'Functional',
    title: 'Functional',
    location: 'gym',
    exerciseId: null,
  },
  {
    sessionType: 'running',
    label: 'Carrera',
    title: 'Carrera',
    location: 'outdoor',
    exerciseId: 'run',
  },
  {
    sessionType: 'swimming',
    label: 'Natación',
    title: 'Natación',
    location: 'pool',
    exerciseId: 'swim_freestyle',
  },
  { sessionType: 'cycling', label: 'Bici', title: 'Bici', location: 'outdoor', exerciseId: 'bike' },
  {
    sessionType: 'spinning',
    label: 'Spinning',
    title: 'Spinning',
    location: 'gym',
    exerciseId: 'spinning',
  },
]

export const CARDIO_TYPES = new Set<SessionType>(['running', 'swimming', 'cycling', 'spinning'])

// Ejercicio de cardio por defecto para intervalos según el tipo de sesión.
export function cardioExerciseFor(sessionType: SessionType) {
  return START_OPTIONS.find((o) => o.sessionType === sessionType)?.exerciseId ?? null
}

export function createSessionOfType(
  userId: string,
  sessionType: SessionType,
  now: number,
  newId?: IdFn,
): LocalSession {
  const option = START_OPTIONS.find((o) => o.sessionType === sessionType) ?? START_OPTIONS[0]!
  const session = createSession(
    userId,
    now,
    newId,
    option.title,
    option.sessionType,
    option.location,
  )
  if (!option.exerciseId) return session
  // Carrera, natación y bici empiezan con un bloque continuo: cronómetro + distancia.
  return addTimedBlock(
    session,
    { kind: 'free' },
    [{ exercise: { id: option.exerciseId, defaultRestS: 0 }, targetReps: null }],
    now,
    newId,
  )
}

// ── Registrar actividad (deportes, clases, yoga, personalizadas…) ─────────
// Las opciones salen del catálogo de actividades (quickActivityOptions en
// src/lib/activities/catalog.ts).

export type QuickActivityInput = {
  // Id de la actividad: tipo de sesión (globales) o 'a_…' (personalizada).
  activityId: string
  title: string
  startedAt: string
  durationMin: number
  rpe: number
  notes: string | null
  avgHr: number | null
  maxHr: number | null
  calories: number | null
}

// Sesión en curso de una actividad (p. ej. un entreno en pareja de pádel o de una actividad
// personalizada): cronómetro continuo con el ejercicio de la actividad.
export function createActivitySession(
  userId: string,
  activityId: string,
  now: number,
  newId?: IdFn,
): LocalSession {
  const activity = getActivityType(activityId) ?? getActivityType('other')!
  const { sessionType, activityTypeId } = sessionTypeForActivity(activity)
  const session = {
    ...createSession(userId, now, newId, activity.name, sessionType, activity.location),
    activityTypeId,
  }
  return addTimedBlock(
    session,
    { kind: 'free' },
    [{ exercise: { id: activity.exerciseId, defaultRestS: 0 }, targetReps: null }],
    now,
    newId,
  )
}

// Crea una sesión ya terminada, lista para guardar y sincronizar.
export function createQuickActivity(
  userId: string,
  input: QuickActivityInput,
  now: number,
  newId: IdFn = () => crypto.randomUUID(),
): LocalSession {
  const activity = getActivityType(input.activityId) ?? getActivityType('other')!
  const { sessionType, activityTypeId } = sessionTypeForActivity(activity)
  const started = new Date(input.startedAt).getTime()
  const endedAt = new Date(started + input.durationMin * 60_000).toISOString()
  const block: LocalBlock = {
    id: newId(),
    order: 0,
    blockType: 'free',
    exercises: [{ exerciseId: activity.exerciseId, restS: 0 }],
    sets: [
      {
        id: newId(),
        exerciseId: activity.exerciseId,
        setIndex: 0,
        isWarmup: false,
        weightKg: null,
        reps: null,
        rir: null,
        durationS: input.durationMin * 60,
        distanceM: null,
        calories: null,
        completed: true,
        completedAt: endedAt,
      },
    ],
  }
  const base = createSession(
    userId,
    now,
    newId,
    input.title.trim() || activity.name,
    sessionType,
    activity.location,
  )
  return {
    ...base,
    activityTypeId,
    startedAt: new Date(started).toISOString(),
    endedAt,
    durationMin: input.durationMin,
    rpe: input.rpe,
    notes: input.notes,
    avgHr: input.avgHr,
    maxHr: input.maxHr,
    calories: input.calories,
    blocks: [block],
  }
}

// Nombre y emoji del tipo de sesión (o de la actividad personalizada, si se pasa su id).
export function sessionTypeLabel(type: SessionType, activityTypeId?: string | null) {
  return activityLabel(activityKey({ sessionType: type, activityTypeId }))
}

export function sessionTypeEmoji(type: SessionType, activityTypeId?: string | null) {
  return activityEmoji(activityKey({ sessionType: type, activityTypeId }))
}
