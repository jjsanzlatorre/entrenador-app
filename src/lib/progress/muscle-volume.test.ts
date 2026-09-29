import { describe, expect, it } from 'vitest'
import type { MuscleRole, SessionType } from '@/types/database'
import { DEFAULT_ACTIVITY_TYPES, addActivityTypes } from '@/lib/activities/catalog'
import { BODY_SILHOUETTE, MUSCLE_PATHS } from './body-map'
import {
  cardioApproxSets,
  localSetCounts,
  MUSCLE_IDS,
  muscleVolume,
  neglectedMuscles,
  setsOf,
  volumeLevel,
  weekComparison,
  weekVolume,
  type ExerciseSetCount,
  type VolumeSession,
} from './muscle-volume'
import musclesSeed from '../../../supabase/seed/muscles.json'

const m = (primary: string[], secondary: string[] = []) => ({
  muscles: [
    ...primary.map((muscleId) => ({ muscleId, role: 'primary' as MuscleRole })),
    ...secondary.map((muscleId) => ({ muscleId, role: 'secondary' as MuscleRole })),
  ],
})

const catalog = new Map([
  ['back_squat', m(['quads', 'glutes'], ['adductors', 'core', 'lower_back'])],
  ['romanian_deadlift', m(['hamstrings', 'glutes'], ['lower_back'])],
  ['leg_extension', m(['quads'])],
  ['run', m([])],
])

function session(
  id: string,
  sessionType: SessionType,
  startedAt: string,
  durationMin: number | null,
): VolumeSession {
  return { id, sessionType, startedAt, endedAt: startedAt, durationMin }
}

describe('muscleVolume', () => {
  it('1 por principal y 0,5 por secundario, sumando ejercicios', () => {
    const sessions = [session('s1', 'strength', '2026-09-28T09:00:00', 60)]
    const counts: ExerciseSetCount[] = [
      { sessionId: 's1', exerciseId: 'back_squat', sets: 4 },
      { sessionId: 's1', exerciseId: 'romanian_deadlift', sets: 3 },
      { sessionId: 's1', exerciseId: 'leg_extension', sets: 3 },
    ]
    const v = muscleVolume(sessions, counts, catalog)
    expect(setsOf(v, 'quads')).toBe(4 + 3)
    expect(setsOf(v, 'glutes')).toBe(4 + 3)
    expect(setsOf(v, 'hamstrings')).toBe(3)
    expect(setsOf(v, 'adductors')).toBe(2)
    expect(setsOf(v, 'lower_back')).toBe(2 + 1.5)
    expect(setsOf(v, 'chest')).toBe(0)
    expect(v.get('quads')!.approxSets).toBe(0)
    // Detalle: qué ejercicios lo aportan, de más a menos.
    expect(v.get('lower_back')!.contributions).toEqual([
      { kind: 'exercise', exerciseId: 'back_squat', role: 'secondary', sets: 2, rawSets: 4 },
      {
        kind: 'exercise',
        exerciseId: 'romanian_deadlift',
        role: 'secondary',
        sets: 1.5,
        rawSets: 3,
      },
    ])
  })

  it('agrupa el mismo ejercicio de varias sesiones e ignora sesiones fuera de la lista', () => {
    const sessions = [
      session('s1', 'strength', '2026-09-28T09:00:00', 60),
      session('s2', 'strength', '2026-09-30T09:00:00', 60),
    ]
    const counts: ExerciseSetCount[] = [
      { sessionId: 's1', exerciseId: 'leg_extension', sets: 3 },
      { sessionId: 's2', exerciseId: 'leg_extension', sets: 2 },
      { sessionId: 'otra', exerciseId: 'leg_extension', sets: 10 },
      { sessionId: 's2', exerciseId: 'desconocido', sets: 5 },
    ]
    const v = muscleVolume(sessions, counts, catalog)
    expect(setsOf(v, 'quads')).toBe(5)
    expect(v.get('quads')!.contributions).toHaveLength(1)
  })

  it('las series de calentamiento o sin completar no cuentan (localSetCounts)', () => {
    const base = { weightKg: 60, reps: 8 }
    const counts = localSetCounts({
      id: 's1',
      blocks: [
        {
          sets: [
            { ...base, exerciseId: 'back_squat', completed: true, isWarmup: true },
            { ...base, exerciseId: 'back_squat', completed: true, isWarmup: false },
            { ...base, exerciseId: 'back_squat', completed: true, isWarmup: false },
            { ...base, exerciseId: 'back_squat', completed: false, isWarmup: false },
          ],
        },
      ],
    })
    expect(counts).toEqual([{ sessionId: 's1', exerciseId: 'back_squat', sets: 2 }])
  })
})

describe('aproximación de cardio y deportes', () => {
  it('carrera de 30 min: 2 series a cuádriceps, isquios, gemelos y glúteo', () => {
    expect(cardioApproxSets('running', 30)).toEqual([
      { muscleId: 'quads', sets: 2 },
      { muscleId: 'hamstrings', sets: 2 },
      { muscleId: 'calves', sets: 2 },
      { muscleId: 'glutes', sets: 2 },
    ])
  })

  it('proporcional a la duración; yoga 0,5 por cada 30 min', () => {
    expect(cardioApproxSets('swimming', 45).map((x) => x.sets)).toEqual([3, 3, 3, 3, 3])
    expect(cardioApproxSets('swimming', 45).map((x) => x.muscleId)).toEqual([
      'lats',
      'delt_front',
      'delt_side',
      'triceps',
      'core',
    ])
    expect(cardioApproxSets('yoga', 60)).toEqual([
      { muscleId: 'core', sets: 1 },
      { muscleId: 'glutes', sets: 1 },
      { muscleId: 'hamstrings', sets: 1 },
    ])
    expect(cardioApproxSets('spinning', 30).map((x) => x.muscleId)).toEqual([
      'quads',
      'glutes',
      'calves',
    ])
    expect(cardioApproxSets('surf', 30).map((x) => x.muscleId)).toEqual([
      'lats',
      'delt_front',
      'core',
      'triceps',
    ])
    expect(cardioApproxSets('fronton', 30).map((x) => x.muscleId)).toEqual([
      'delt_front',
      'forearms',
      'core',
      'quads',
    ])
  })

  it('actividades nuevas: clases de gimnasio, pádel y tenis (2 series por cada 30 min)', () => {
    const muscles = (type: string) => cardioApproxSets(type, 30).map((x) => x.muscleId)
    const classes = ['quads', 'glutes', 'core', 'chest', 'delt_front', 'lats']
    expect(muscles('functional_class')).toEqual(classes)
    expect(muscles('oxfit')).toEqual(classes)
    expect(muscles('gap')).toEqual(['glutes', 'core', 'quads', 'hamstrings', 'adductors'])
    const racket = ['delt_front', 'delt_side', 'forearms', 'core', 'quads', 'calves']
    expect(muscles('padel')).toEqual(racket)
    expect(muscles('tennis')).toEqual(racket)
    expect(cardioApproxSets('gap', 45).every((x) => x.sets === 3)).toBe(true)
  })

  it('la aproximación sale de los datos: una actividad personalizada trae la suya', () => {
    addActivityTypes([
      {
        ...DEFAULT_ACTIVITY_TYPES.find((a) => a.id === 'other')!,
        id: 'a_climb',
        ownerId: 'u1',
        name: 'Escalada',
        muscles: ['lats', 'forearms'],
        setsPer30Min: 2,
      },
    ])
    const volume = muscleVolume(
      [
        {
          id: 's1',
          sessionType: 'custom',
          activityTypeId: 'a_climb',
          startedAt: '2026-09-28T08:00:00Z',
          endedAt: '2026-09-28T09:00:00Z',
          durationMin: 60,
        },
      ],
      [],
      new Map(),
    )
    expect(volume.get('lats')).toMatchObject({ sets: 4, approxSets: 4 })
    expect(volume.get('forearms')?.contributions[0]).toMatchObject({
      kind: 'cardio',
      activity: 'a_climb',
      sessions: 1,
      minutes: 60,
    })
  })

  it('todas las actividades globales usan músculos existentes', () => {
    for (const a of DEFAULT_ACTIVITY_TYPES) {
      for (const m of a.muscles) expect(MUSCLE_IDS).toContain(m)
    }
  })

  it('fuerza, functional y «otro» no suman aproximación; sin duración tampoco', () => {
    expect(cardioApproxSets('strength', 60)).toEqual([])
    expect(cardioApproxSets('functional', 60)).toEqual([])
    expect(cardioApproxSets('other', 60)).toEqual([])
    expect(cardioApproxSets('running', null)).toEqual([])
    expect(cardioApproxSets('running', 0)).toEqual([])
  })

  it('pierna + carrera de 30 min en la misma semana: se suman y se marca la parte aproximada', () => {
    const sessions = [
      session('leg', 'strength', '2026-09-28T09:00:00', 60),
      session('run', 'running', '2026-09-29T19:00:00', 30),
    ]
    const counts: ExerciseSetCount[] = [
      { sessionId: 'leg', exerciseId: 'back_squat', sets: 4 },
      { sessionId: 'leg', exerciseId: 'romanian_deadlift', sets: 3 },
      // La carrera registra series del ejercicio «run», que no tiene músculos.
      { sessionId: 'run', exerciseId: 'run', sets: 1 },
    ]
    const v = weekVolume(sessions, counts, catalog, '2026-09-28')
    expect(setsOf(v, 'quads')).toBe(4 + 2)
    expect(setsOf(v, 'hamstrings')).toBe(3 + 2)
    expect(setsOf(v, 'calves')).toBe(2)
    expect(v.get('calves')!.approxSets).toBe(2)
    expect(v.get('quads')!.approxSets).toBe(2)
    expect(v.get('quads')!.contributions.at(-1)).toEqual({
      kind: 'cardio',
      activity: 'running',
      sets: 2,
      sessions: 1,
      minutes: 30,
    })
  })

  it('sin duración guardada usa inicio y fin', () => {
    const s = { ...session('r', 'running', '2026-09-28T09:00:00', null) }
    s.endedAt = '2026-09-28T10:00:00'
    expect(setsOf(muscleVolume([s], [], catalog), 'quads')).toBe(4)
  })
})

describe('semanas, escala y comparación', () => {
  it('weekVolume solo cuenta la semana (lunes a domingo, día local)', () => {
    const sessions = [
      session('dom', 'running', '2026-09-27T20:00:00', 30),
      session('lun', 'running', '2026-09-28T08:00:00', 30),
      session('dom2', 'running', '2026-10-04T21:00:00', 30),
      session('lun2', 'running', '2026-10-05T08:00:00', 30),
    ]
    expect(setsOf(weekVolume(sessions, [], catalog, '2026-09-28'), 'calves')).toBe(4)
  })

  it('escala 0 / 1–5 / 6–10 / 11–20 / >20', () => {
    expect([0, 0.5, 5, 5.5, 10, 11, 20, 20.5, 30].map(volumeLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ])
  })

  it('comparación con la semana anterior para los 16 músculos', () => {
    const sessions = [
      session('a', 'strength', '2026-09-21T09:00:00', 60),
      session('b', 'strength', '2026-09-28T09:00:00', 60),
    ]
    const counts: ExerciseSetCount[] = [
      { sessionId: 'a', exerciseId: 'leg_extension', sets: 5 },
      { sessionId: 'b', exerciseId: 'leg_extension', sets: 3 },
      { sessionId: 'b', exerciseId: 'romanian_deadlift', sets: 2 },
    ]
    const cmp = weekComparison(
      weekVolume(sessions, counts, catalog, '2026-09-28'),
      weekVolume(sessions, counts, catalog, '2026-09-21'),
    )
    expect(cmp).toHaveLength(16)
    expect(cmp.find((c) => c.muscleId === 'quads')).toMatchObject({
      sets: 3,
      previous: 5,
      diff: -2,
    })
    expect(cmp.find((c) => c.muscleId === 'hamstrings')).toMatchObject({ diff: 2 })
    expect(cmp.find((c) => c.muscleId === 'chest')).toMatchObject({ diff: 0 })
  })
})

describe('músculos descuidados', () => {
  const sessions = [
    session('w0', 'strength', '2026-09-28T09:00:00', 60),
    session('w1', 'strength', '2026-09-22T09:00:00', 60),
    session('w3', 'strength', '2026-09-08T09:00:00', 60),
  ]
  const counts: ExerciseSetCount[] = [
    { sessionId: 'w0', exerciseId: 'leg_extension', sets: 3 },
    { sessionId: 'w1', exerciseId: 'romanian_deadlift', sets: 3 },
    { sessionId: 'w3', exerciseId: 'back_squat', sets: 3 },
  ]
  const weeks = [0, 1, 2, 3].map((i) =>
    weekVolume(
      sessions,
      counts,
      catalog,
      ['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07'][i]!,
    ),
  )

  it('0 series en 2 semanas o más; cuenta cuántas', () => {
    const result = neglectedMuscles(weeks, '2026-09-28', '2026-09-08')
    const byId = new Map(result.map((r) => [r.muscleId, r]))
    // Cuádriceps esta semana, isquios y glúteo la anterior: no están descuidados.
    expect(byId.has('quads')).toBe(false)
    expect(byId.has('hamstrings')).toBe(false)
    expect(byId.has('glutes')).toBe(false)
    // Aductores y core: solo en la semana 3 (sentadilla) → 3 semanas sin series.
    expect(byId.get('adductors')).toEqual({ muscleId: 'adductors', weeks: 3, orMore: false })
    // Pectoral: nada en las 4 semanas mirada → «4 o más».
    expect(byId.get('chest')).toEqual({ muscleId: 'chest', weeks: 4, orMore: true })
  })

  it('sin historial suficiente no marca nada', () => {
    expect(neglectedMuscles(weeks, '2026-09-28', null)).toEqual([])
    // Empezó la semana pasada: aún no hay 2 semanas completas de datos.
    expect(neglectedMuscles(weeks, '2026-09-28', '2026-09-22')).toEqual([])
    expect(neglectedMuscles(weeks, '2026-09-28', '2026-09-21').length).toBeGreaterThan(0)
  })
})

describe('mapa corporal', () => {
  it('un path por cada uno de los 16 músculos en su vista', () => {
    const seed = musclesSeed as { id: string; view: 'front' | 'back' | 'both' }[]
    expect(new Set(MUSCLE_IDS)).toEqual(new Set(seed.map((x) => x.id)))
    for (const muscle of seed) {
      const views = muscle.view === 'both' ? (['front', 'back'] as const) : [muscle.view]
      for (const view of views) expect(MUSCLE_PATHS[view][muscle.id]).toMatch(/^M[\d.]+ [\d.]+C/)
    }
    const drawn = new Set([...Object.keys(MUSCLE_PATHS.front), ...Object.keys(MUSCLE_PATHS.back)])
    expect(drawn).toEqual(new Set(MUSCLE_IDS))
    expect(BODY_SILHOUETTE.length).toBeGreaterThan(100)
  })
})
