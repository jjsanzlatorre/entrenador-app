import { describe, expect, it } from 'vitest'
import {
  addExerciseBlock,
  addSet,
  addToSuperset,
  adjustRest,
  createSession,
  finishSession,
  moveBlock,
  nextPendingSetId,
  removeExercise,
  removeSet,
  restRemainingMs,
  substituteExercise,
  toggleRestPause,
  toggleSetComplete,
  toggleWarmup,
  updateSetAndFollowing,
} from './session-ops'
import { sequentialIds } from './test-helpers'
import type { LastPerformance } from './types'

const T0 = Date.parse('2026-09-28T10:00:00Z')
const squat = { id: 'back_squat', defaultRestS: 180 }
const bench = { id: 'bench_press', defaultRestS: 150 }
const row = { id: 'db_row', defaultRestS: 90 }

const lastSquat: LastPerformance = {
  exerciseId: 'back_squat',
  endedAt: '2026-09-25T10:00:00Z',
  sets: [
    {
      setIndex: 0,
      isWarmup: true,
      weightKg: 60,
      reps: 8,
      rir: null,
      durationS: null,
      distanceM: null,
      calories: null,
    },
    {
      setIndex: 1,
      isWarmup: false,
      weightKg: 100,
      reps: 5,
      rir: 2,
      durationS: null,
      distanceM: null,
      calories: null,
    },
    {
      setIndex: 2,
      isWarmup: false,
      weightKg: 100,
      reps: 5,
      rir: 1,
      durationS: null,
      distanceM: null,
      calories: null,
    },
  ],
}

function base() {
  const id = sequentialIds()
  const s = createSession('user-1', T0, id)
  return { id, s }
}

describe('añadir ejercicios', () => {
  it('precarga peso y reps de la última vez', () => {
    const { id, s } = base()
    const next = addExerciseBlock(s, squat, lastSquat, T0 + 1, id)
    const sets = next.blocks[0]?.sets ?? []
    expect(sets.map((x) => [x.isWarmup, x.weightKg, x.reps, x.completed])).toEqual([
      [true, 60, 8, false],
      [false, 100, 5, false],
      [false, 100, 5, false],
    ])
    expect(next.rev).toBeGreaterThan(s.rev)
  })

  it('sin historial crea 3 series vacías', () => {
    const { id, s } = base()
    const next = addExerciseBlock(s, bench, null, T0 + 1, id)
    expect(next.blocks[0]?.sets).toHaveLength(3)
    expect(next.blocks[0]?.sets.every((x) => x.weightKg === null)).toBe(true)
  })

  it('superserie: añade al bloque y cambia el tipo', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, bench, null, T0 + 1, id)
    next = addToSuperset(next, next.blocks[0]!.id, row, null, T0 + 2, id)
    expect(next.blocks).toHaveLength(1)
    expect(next.blocks[0]?.blockType).toBe('superset')
    expect(next.blocks[0]?.exercises.map((e) => e.exerciseId)).toEqual(['bench_press', 'db_row'])
    next = removeExercise(next, next.blocks[0]!.id, 'db_row', T0 + 3)
    expect(next.blocks[0]?.blockType).toBe('straight')
  })
})

describe('series', () => {
  it('completar arranca el descanso con el tiempo del ejercicio', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, lastSquat, T0, id)
    const first = next.blocks[0]!.sets[1]!
    next = toggleSetComplete(next, first.id, T0 + 5000)
    const done = next.blocks[0]!.sets[1]!
    expect(done.completed).toBe(true)
    expect(done.completedAt).toBe(new Date(T0 + 5000).toISOString())
    expect(next.rest?.endsAt).toBe(T0 + 5000 + 180_000)
    expect(restRemainingMs(next.rest, T0 + 65_000)).toBe(120_000)
  })

  it('en superserie solo descansa al acabar la ronda', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, bench, null, T0, id)
    next = addToSuperset(next, next.blocks[0]!.id, row, null, T0, id)
    const benchSet = next.blocks[0]!.sets.find((x) => x.exerciseId === 'bench_press')!
    next = toggleSetComplete(next, benchSet.id, T0 + 1000)
    expect(next.rest).toBeNull()
    expect(nextPendingSetId(next)).toBe(
      next.blocks[0]!.sets.find((x) => x.exerciseId === 'db_row')!.id,
    )
    const rowSet = next.blocks[0]!.sets.find((x) => x.exerciseId === 'db_row')!
    next = toggleSetComplete(next, rowSet.id, T0 + 2000)
    expect(next.rest?.endsAt).toBe(T0 + 2000 + 90_000)
  })

  it('cambiar el peso arrastra a las siguientes pendientes iguales', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, lastSquat, T0, id)
    const [, second, third] = next.blocks[0]!.sets
    next = updateSetAndFollowing(next, second!.id, { weightKg: 102.5 }, T0 + 1)
    expect(next.blocks[0]!.sets.map((x) => x.weightKg)).toEqual([60, 102.5, 102.5])
    next = updateSetAndFollowing(next, third!.id, { reps: 4 }, T0 + 2)
    expect(next.blocks[0]!.sets.map((x) => x.reps)).toEqual([8, 5, 4])
  })

  it('añadir serie copia la última; borrar reindexa', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, lastSquat, T0, id)
    next = addSet(next, next.blocks[0]!.id, 'back_squat', T0 + 1, id)
    const sets = next.blocks[0]!.sets
    expect(sets).toHaveLength(4)
    expect(sets[3]).toMatchObject({
      setIndex: 3,
      weightKg: 100,
      reps: 5,
      completed: false,
      isWarmup: false,
    })
    next = removeSet(next, sets[0]!.id, T0 + 2)
    expect(next.blocks[0]!.sets.map((x) => x.setIndex)).toEqual([0, 1, 2])
    next = toggleWarmup(next, next.blocks[0]!.sets[0]!.id, T0 + 3)
    expect(next.blocks[0]!.sets[0]!.isWarmup).toBe(true)
  })
})

describe('descanso', () => {
  it('+15 s alarga el descanso y guarda el nuevo tiempo del ejercicio', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, bench, null, T0, id)
    next = toggleSetComplete(next, next.blocks[0]!.sets[0]!.id, T0)
    next = adjustRest(next, 15, T0 + 10_000)
    expect(restRemainingMs(next.rest, T0 + 10_000)).toBe(155_000)
    expect(next.blocks[0]!.exercises[0]!.restS).toBe(165)
  })

  it('la pausa congela el tiempo restante (basado en timestamps)', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, bench, null, T0, id)
    next = toggleSetComplete(next, next.blocks[0]!.sets[0]!.id, T0)
    next = toggleRestPause(next, T0 + 50_000)
    expect(restRemainingMs(next.rest, T0 + 500_000)).toBe(100_000)
    next = toggleRestPause(next, T0 + 500_000)
    expect(restRemainingMs(next.rest, T0 + 530_000)).toBe(70_000)
  })
})

describe('reordenar, sustituir y terminar', () => {
  it('mueve bloques', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, null, T0, id)
    next = addExerciseBlock(next, bench, null, T0, id)
    next = moveBlock(next, next.blocks[1]!.id, -1, T0 + 1)
    expect(next.blocks.map((b) => [b.order, b.exercises[0]!.exerciseId])).toEqual([
      [0, 'bench_press'],
      [1, 'back_squat'],
    ])
    expect(moveBlock(next, next.blocks[0]!.id, -1, T0 + 2)).toBe(next)
  })

  it('sustituir conserva las series hechas y pasa las pendientes al nuevo', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, lastSquat, T0, id)
    next = toggleSetComplete(next, next.blocks[0]!.sets[0]!.id, T0 + 1)
    next = substituteExercise(
      next,
      next.blocks[0]!.id,
      'back_squat',
      { id: 'leg_press', defaultRestS: 150 },
      null,
      T0 + 2,
      id,
    )
    const block = next.blocks[0]!
    expect(block.exercises.map((e) => e.exerciseId)).toEqual(['back_squat', 'leg_press'])
    expect(block.sets.filter((x) => x.exerciseId === 'back_squat')).toHaveLength(1)
    expect(block.sets.filter((x) => x.exerciseId === 'leg_press')).toHaveLength(2)
  })

  it('sustituir sin series hechas reemplaza en el sitio', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, squat, lastSquat, T0, id)
    next = substituteExercise(
      next,
      next.blocks[0]!.id,
      'back_squat',
      { id: 'leg_press', defaultRestS: 150 },
      null,
      T0 + 2,
      id,
    )
    expect(next.blocks[0]!.exercises.map((e) => e.exerciseId)).toEqual(['leg_press'])
    expect(next.blocks[0]!.blockType).toBe('straight')
    expect(next.blocks[0]!.sets).toHaveLength(3)
  })

  it('terminar fija ended_at, datos y quita el descanso', () => {
    const { id, s } = base()
    let next = addExerciseBlock(s, bench, null, T0, id)
    next = toggleSetComplete(next, next.blocks[0]!.sets[0]!.id, T0)
    const done = finishSession(next, { rpe: 8, durationMin: 55, avgHr: 130 }, T0 + 3600_000)
    expect(done).toMatchObject({ rpe: 8, durationMin: 55, avgHr: 130, rest: null })
    expect(done.endedAt).toBe(new Date(T0 + 3600_000).toISOString())
  })
})
