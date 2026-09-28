import { describe, expect, it } from 'vitest'
import { effectiveSetsByMuscle, estimateOneRepMax, sessionStats, tonnage } from './calc'
import { makeExercise } from './test-helpers'

const set = (
  p: Partial<{
    weightKg: number | null
    reps: number | null
    completed: boolean
    isWarmup: boolean
    exerciseId: string
  }>,
) => ({
  weightKg: 100,
  reps: 5,
  completed: true,
  isWarmup: false,
  exerciseId: 'back_squat',
  ...p,
})

describe('estimateOneRepMax (Epley)', () => {
  it('aplica peso × (1 + reps/30)', () => {
    expect(estimateOneRepMax(set({ weightKg: 100, reps: 5 }))).toBe(116.7)
    expect(estimateOneRepMax(set({ weightKg: 60, reps: 10 }))).toBe(80)
  })
  it('no calcula con más de 10 reps ni en calentamiento', () => {
    expect(estimateOneRepMax(set({ reps: 11 }))).toBeNull()
    expect(estimateOneRepMax(set({ isWarmup: true }))).toBeNull()
  })
})

describe('tonnage', () => {
  it('suma peso × reps de series completadas sin calentamiento', () => {
    expect(
      tonnage([
        set({ weightKg: 100, reps: 5 }),
        set({ weightKg: 60, reps: 10, isWarmup: true }),
        set({ weightKg: 100, reps: 5, completed: false }),
        set({ weightKg: null, reps: 12 }),
        set({ weightKg: 82.5, reps: 4 }),
      ]),
    ).toBe(830)
  })
})

describe('effectiveSetsByMuscle', () => {
  it('cuenta 1 por primario y 0,5 por secundario', () => {
    const exercises = new Map([
      [
        'back_squat',
        makeExercise({
          id: 'back_squat',
          muscles: [
            { muscleId: 'quads', role: 'primary' },
            { muscleId: 'glutes', role: 'primary' },
            { muscleId: 'core', role: 'secondary' },
          ],
        }),
      ],
    ])
    const result = effectiveSetsByMuscle(
      [set({}), set({}), set({}), set({ isWarmup: true }), set({ completed: false })],
      exercises,
    )
    expect(result).toEqual([
      { muscleId: 'glutes', sets: 3 },
      { muscleId: 'quads', sets: 3 },
      { muscleId: 'core', sets: 1.5 },
    ])
  })
})

describe('sessionStats', () => {
  it('resume ejercicios, series, reps y tonelaje', () => {
    const blocks = [
      {
        sets: [
          {
            ...set({ weightKg: 50, reps: 10 }),
            id: '1',
            setIndex: 0,
            rir: null,
            durationS: null,
            distanceM: null,
            calories: null,
            completedAt: null,
          },
          {
            ...set({ weightKg: 50, reps: 8, exerciseId: 'bench_press' }),
            id: '2',
            setIndex: 0,
            rir: null,
            durationS: null,
            distanceM: null,
            calories: null,
            completedAt: null,
          },
        ],
      },
    ]
    expect(sessionStats({ blocks } as never)).toEqual({
      exercises: 2,
      completedSets: 2,
      totalReps: 18,
      tonnageKg: 900,
    })
  })
})
