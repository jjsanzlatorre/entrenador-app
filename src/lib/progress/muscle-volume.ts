// Volumen semanal por músculo (CLAUDE.md §5 y §6):
// - Serie efectiva (completada, sin calentamiento): 1 por músculo principal y 0,5 por secundario.
// - Cardio y deportes (aproximado): cada 30 min suman 2 series equivalentes a cada músculo de
//   su lista (yoga: 0,5), en proporción a la duración.
import type { MuscleRole, SessionType } from '@/types/database'
import { sessionMinutes } from './adherence'
import { addDays, localDateKey, type DateKey } from './dates'
import type { SessionLogEntry } from './types'

export const MUSCLE_IDS = [
  'chest',
  'lats',
  'upper_back',
  'lower_back',
  'delt_front',
  'delt_side',
  'delt_rear',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
] as const

export type MuscleId = (typeof MUSCLE_IDS)[number]

// Aproximación del cardio y los deportes: músculos y series por cada 30 min (a cada uno).
export const CARDIO_APPROX: Partial<
  Record<SessionType, { muscles: MuscleId[]; setsPer30Min: number }>
> = {
  running: { muscles: ['quads', 'hamstrings', 'calves', 'glutes'], setsPer30Min: 2 },
  swimming: {
    muscles: ['lats', 'delt_front', 'delt_side', 'triceps', 'core'],
    setsPer30Min: 2,
  },
  cycling: { muscles: ['quads', 'glutes', 'calves'], setsPer30Min: 2 },
  spinning: { muscles: ['quads', 'glutes', 'calves'], setsPer30Min: 2 },
  surf: { muscles: ['lats', 'delt_front', 'core', 'triceps'], setsPer30Min: 2 },
  padel_fronton: { muscles: ['delt_front', 'forearms', 'core', 'quads'], setsPer30Min: 2 },
  yoga: { muscles: ['core', 'glutes', 'hamstrings'], setsPer30Min: 0.5 },
}

// Series equivalentes que una sesión de cardio o deporte aporta a cada músculo de su lista.
export function cardioApproxSets(sessionType: SessionType, minutes: number | null) {
  const approx = CARDIO_APPROX[sessionType]
  if (!approx || !minutes || minutes <= 0) return []
  const sets = (approx.setsPer30Min * minutes) / 30
  return approx.muscles.map((muscleId) => ({ muscleId, sets }))
}

// Series efectivas de un ejercicio en una sesión (del servidor o calculadas en el móvil).
export type ExerciseSetCount = { sessionId: string; exerciseId: string; sets: number }

export type VolumeSession = Pick<
  SessionLogEntry,
  'id' | 'sessionType' | 'startedAt' | 'endedAt' | 'durationMin'
>

type MuscleCatalog = Map<string, { muscles: { muscleId: string; role: MuscleRole }[] }>

// De dónde salen las series de un músculo: un ejercicio o un tipo de cardio/deporte.
export type Contribution =
  | { kind: 'exercise'; exerciseId: string; role: MuscleRole; sets: number; rawSets: number }
  | { kind: 'cardio'; sessionType: SessionType; sets: number; sessions: number; minutes: number }

export type MuscleVolume = {
  muscleId: string
  // Total (series efectivas + aproximación de cardio).
  sets: number
  // Parte aproximada (cardio y deportes).
  approxSets: number
  contributions: Contribution[]
}

export type VolumeMap = Map<string, MuscleVolume>

function entry(map: VolumeMap, muscleId: string) {
  let v = map.get(muscleId)
  if (!v) {
    v = { muscleId, sets: 0, approxSets: 0, contributions: [] }
    map.set(muscleId, v)
  }
  return v
}

// Volumen por músculo de un conjunto de sesiones.
export function muscleVolume(
  sessions: VolumeSession[],
  setCounts: ExerciseSetCount[],
  catalog: MuscleCatalog,
): VolumeMap {
  const ids = new Set(sessions.map((s) => s.id))
  const map: VolumeMap = new Map()

  for (const c of setCounts) {
    if (!ids.has(c.sessionId) || c.sets <= 0) continue
    const exercise = catalog.get(c.exerciseId)
    if (!exercise) continue
    for (const { muscleId, role } of exercise.muscles) {
      const sets = c.sets * (role === 'primary' ? 1 : 0.5)
      const v = entry(map, muscleId)
      v.sets += sets
      const found = v.contributions.find(
        (x) => x.kind === 'exercise' && x.exerciseId === c.exerciseId,
      )
      if (found && found.kind === 'exercise') {
        found.sets += sets
        found.rawSets += c.sets
      } else {
        v.contributions.push({
          kind: 'exercise',
          exerciseId: c.exerciseId,
          role,
          sets,
          rawSets: c.sets,
        })
      }
    }
  }

  for (const s of sessions) {
    const minutes = sessionMinutes(s)
    for (const { muscleId, sets } of cardioApproxSets(s.sessionType, minutes)) {
      const v = entry(map, muscleId)
      v.sets += sets
      v.approxSets += sets
      const found = v.contributions.find(
        (x) => x.kind === 'cardio' && x.sessionType === s.sessionType,
      )
      if (found && found.kind === 'cardio') {
        found.sets += sets
        found.sessions += 1
        found.minutes += minutes
      } else {
        v.contributions.push({
          kind: 'cardio',
          sessionType: s.sessionType,
          sets,
          sessions: 1,
          minutes,
        })
      }
    }
  }

  for (const v of map.values()) v.contributions.sort((a, b) => b.sets - a.sets)
  return map
}

export function sessionsInRange<T extends Pick<SessionLogEntry, 'startedAt'>>(
  sessions: T[],
  from: DateKey,
  to: DateKey,
) {
  return sessions.filter((s) => {
    const day = localDateKey(s.startedAt)
    return day >= from && day <= to
  })
}

// Volumen de la semana que empieza en `weekStart` (lunes).
export function weekVolume(
  sessions: VolumeSession[],
  setCounts: ExerciseSetCount[],
  catalog: MuscleCatalog,
  weekStart: DateKey,
) {
  return muscleVolume(
    sessionsInRange(sessions, weekStart, addDays(weekStart, 6)),
    setCounts,
    catalog,
  )
}

export const setsOf = (map: VolumeMap, muscleId: string) => map.get(muscleId)?.sets ?? 0

// Escala del mapa: 0 / 1–5 / 6–10 / 11–20 / >20 series.
export type VolumeLevel = 0 | 1 | 2 | 3 | 4

export function volumeLevel(sets: number): VolumeLevel {
  if (sets <= 0) return 0
  if (sets <= 5) return 1
  if (sets <= 10) return 2
  if (sets <= 20) return 3
  return 4
}

export const VOLUME_LEVEL_LABELS: Record<VolumeLevel, string> = {
  0: '0',
  1: '1–5',
  2: '6–10',
  3: '11–20',
  4: '>20',
}

// Diferencia de series por músculo frente a la semana anterior.
export function weekComparison(current: VolumeMap, previous: VolumeMap) {
  return MUSCLE_IDS.map((muscleId) => {
    const now = setsOf(current, muscleId)
    const before = setsOf(previous, muscleId)
    return { muscleId, sets: now, previous: before, diff: now - before }
  })
}

// Músculos descuidados: 0 series en las 2 últimas semanas o más (hasta la semana elegida).
// `weeks` son los volúmenes de semanas consecutivas, de la más reciente (la elegida) hacia
// atrás. Solo se avisa si hay historial desde antes de esas 2 semanas: a un usuario nuevo
// no se le marca todo como descuidado.
export function neglectedMuscles(
  weeks: VolumeMap[],
  selectedWeekStart: DateKey,
  firstSessionDay: DateKey | null,
  minWeeks = 2,
) {
  if (!firstSessionDay || firstSessionDay > addDays(selectedWeekStart, -7 * (minWeeks - 1))) {
    return []
  }
  const result: { muscleId: MuscleId; weeks: number; orMore: boolean }[] = []
  for (const muscleId of MUSCLE_IDS) {
    let empty = 0
    while (empty < weeks.length && setsOf(weeks[empty]!, muscleId) === 0) empty++
    if (empty >= minWeeks) {
      result.push({ muscleId, weeks: empty, orMore: empty === weeks.length })
    }
  }
  return result
}

// Series efectivas por ejercicio de una sesión local (pendiente de subir o recién terminada).
export function localSetCounts(session: {
  id: string
  blocks: { sets: { exerciseId: string; completed: boolean; isWarmup: boolean }[] }[]
}): ExerciseSetCount[] {
  const counts = new Map<string, number>()
  for (const set of session.blocks.flatMap((b) => b.sets)) {
    if (!set.completed || set.isWarmup) continue
    counts.set(set.exerciseId, (counts.get(set.exerciseId) ?? 0) + 1)
  }
  return [...counts].map(([exerciseId, sets]) => ({ sessionId: session.id, exerciseId, sets }))
}

// «4», «2,5», «1,3»: series con un decimal como mucho.
export function formatSets(sets: number) {
  const rounded = Math.round(sets * 10) / 10
  return rounded.toLocaleString('es-ES', { maximumFractionDigits: 1 })
}
