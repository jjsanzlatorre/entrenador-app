import { describe, expect, it } from 'vitest'
import { addMonths, formatWeekRange, monthEndOf, weekStartOf } from './dates'
import { exerciseSeries, type ExerciseSetSample } from './exercise-progress'
import { fitWithin } from './image'
import { formatDuration, periodSummary } from './period-summary'
import {
  currentRecords,
  formatPrevious,
  formatRecordValue,
  sessionImprovements,
  type PersonalRecord,
} from './records'
import type { SessionLogEntry } from './types'
import { sessionHeaderStats } from '@/lib/workout/summary'
import type { LocalBlock } from '@/lib/workout/types'

describe('fechas', () => {
  it('semanas de lunes a domingo y meses', () => {
    expect(weekStartOf('2026-09-13')).toBe('2026-09-07')
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07')
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(monthEndOf('2026-02-10')).toBe('2026-02-28')
    expect(formatWeekRange('2026-09-28')).toBe('28 sept – 4 oct')
  })
})

describe('periodSummary', () => {
  const s = (
    id: string,
    sessionType: SessionLogEntry['sessionType'],
    startedAt: string,
    durationMin: number,
    rpe: number | null,
    distanceM: number | null = null,
  ): SessionLogEntry => ({
    id,
    sessionType,
    startedAt,
    endedAt: startedAt,
    durationMin,
    rpe,
    distanceM,
  })

  it('agrupa por deporte con horas, carga y distancia', () => {
    const sum = periodSummary(
      [
        s('1', 'strength', '2026-09-07T10:00:00', 60, 8),
        s('2', 'running', '2026-09-08T10:00:00', 30, 6, 5000),
        s('3', 'running', '2026-09-10T10:00:00', 45, null, 8000),
        s('4', 'running', '2026-09-20T10:00:00', 45, 5, 8000),
      ],
      '2026-09-07',
      '2026-09-13',
    )
    expect(sum.sessions).toBe(3)
    expect(sum.minutes).toBe(135)
    expect(sum.load).toBe(480 + 180)
    expect(sum.distanceM).toBe(13000)
    expect(sum.bySport[0]).toEqual({
      activity: 'running',
      sessionType: 'running',
      sessions: 2,
      minutes: 75,
      load: 180,
      distanceM: 13000,
    })
  })

  it('formatDuration', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(135)).toBe('2 h 15 min')
  })
})

describe('exerciseSeries', () => {
  const set = (p: Partial<ExerciseSetSample>): ExerciseSetSample => ({
    sessionId: 's1',
    endedAt: '2026-09-01T10:00:00Z',
    isWarmup: false,
    completed: true,
    weightKg: null,
    reps: null,
    durationS: null,
    distanceM: null,
    ...p,
  })

  it('fuerza: 1RM estimado, peso máximo y volumen por sesión, sin calentamientos', () => {
    const points = exerciseSeries(
      [
        set({ weightKg: 100, reps: 3, isWarmup: true }),
        set({ weightKg: 60, reps: 8 }),
        set({ weightKg: 62.5, reps: 6 }),
        set({ weightKg: 70, reps: 5, completed: false }),
        set({ sessionId: 's2', endedAt: '2026-09-04T10:00:00Z', weightKg: 65, reps: 5 }),
      ],
      null,
    )
    expect(points.map((p) => [p.sessionId, p.est1rm, p.maxWeight, p.volume])).toEqual([
      ['s1', 76, 62.5, 855],
      ['s2', 75.8, 65, 325],
    ])
  })

  it('cardio: distancia y ritmo sobre el tiempo en movimiento', () => {
    const [p] = exerciseSeries(
      [set({ distanceM: 400, durationS: 100 }), set({ distanceM: 600, durationS: 170 })],
      'run',
    )
    expect(p?.distanceM).toBe(1000)
    expect(p?.pace).toBe(270)
  })
})

describe('récords', () => {
  const pr = (p: Partial<PersonalRecord>): PersonalRecord => ({
    id: Math.random().toString(),
    exerciseId: 'bench_press',
    prType: 'max_weight',
    value: 60,
    unit: 'kg',
    weightKg: null,
    previousValue: null,
    sessionId: 's1',
    achievedAt: '2026-09-01T10:00:00Z',
    ...p,
  })

  it('formatea cada tipo', () => {
    expect(formatRecordValue(pr({ value: 62.5 }))).toBe('62,5 kg')
    expect(formatRecordValue(pr({ prType: 'max_reps_at_weight', value: 10, weightKg: 60 }))).toBe(
      '10 × 60 kg',
    )
    expect(formatRecordValue(pr({ prType: 'max_reps_at_weight', value: 12, weightKg: 0 }))).toBe(
      '12 reps',
    )
    expect(
      formatRecordValue(pr({ exerciseId: 'run', prType: 'best_pace', value: 280, unit: 's/km' })),
    ).toBe('4:40 min/km')
    expect(
      formatRecordValue(pr({ exerciseId: 'bike', prType: 'best_pace', value: 120, unit: 's/km' })),
    ).toBe('30,0 km/h')
    expect(formatPrevious(pr({ value: 65, previousValue: 60 }))).toBe('antes 60 kg')
  })

  it('vigentes: el último de cada tipo y la frontera de reps', () => {
    const { main, reps } = currentRecords([
      pr({ value: 60 }),
      pr({ value: 65, previousValue: 60, achievedAt: '2026-09-05T10:00:00Z' }),
      pr({ prType: 'max_reps_at_weight', value: 8, weightKg: 60 }),
      pr({
        prType: 'max_reps_at_weight',
        value: 10,
        weightKg: 60,
        previousValue: 8,
        achievedAt: '2026-09-05T10:00:00Z',
      }),
      pr({ prType: 'max_reps_at_weight', value: 5, weightKg: 70 }),
    ])
    expect(main.map((r) => r.value)).toEqual([65])
    expect(reps.map((r) => [r.weightKg, r.value])).toEqual([
      [70, 5],
      [60, 10],
    ])
  })

  it('en el resumen de la sesión solo cuentan las mejoras', () => {
    const list = sessionImprovements([
      pr({ value: 60 }),
      pr({ prType: 'est_1rm', value: 80, previousValue: 76 }),
    ])
    expect(list.map((r) => r.prType)).toEqual(['est_1rm'])
  })
})

describe('fotos', () => {
  it('fitWithin reduce al lado máximo sin ampliar', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('cabecera de la sesión', () => {
  const block = (sets: Partial<LocalBlock['sets'][number]>[]): LocalBlock => ({
    id: 'b',
    order: 0,
    blockType: 'free',
    exercises: [{ exerciseId: 'run', restS: 0 }],
    sets: sets.map((s, i) => ({
      id: `s${i}`,
      exerciseId: 'run',
      setIndex: i,
      isWarmup: false,
      weightKg: null,
      reps: null,
      rir: null,
      durationS: null,
      distanceM: null,
      calories: null,
      completed: true,
      completedAt: null,
      ...s,
    })),
  })
  const stats = { completedSets: 0, tonnageKg: 0 }

  it('en carrera muestra distancia y ritmo, nunca series · kg', () => {
    expect(sessionHeaderStats({ sessionType: 'running', blocks: [] }, stats)).toBe('0 km · ritmo —')
    expect(
      sessionHeaderStats(
        { sessionType: 'running', blocks: [block([{ distanceM: 5000, durationS: 1500 }])] },
        stats,
      ),
    ).toBe('5 km · 5:00 min/km')
    expect(
      sessionHeaderStats(
        { sessionType: 'swimming', blocks: [block([{ distanceM: 400, durationS: 480 }])] },
        stats,
      ),
    ).toBe('400 m · 2:00 min/100 m')
    expect(sessionHeaderStats({ sessionType: 'cycling', blocks: [] }, stats)).toBe(
      '0 km · velocidad —',
    )
  })

  it('en fuerza, series y volumen', () => {
    expect(
      sessionHeaderStats(
        { sessionType: 'strength', blocks: [] },
        { completedSets: 3, tonnageKg: 1500 },
      ),
    ).toBe('3 series · 1500 kg')
  })
})
