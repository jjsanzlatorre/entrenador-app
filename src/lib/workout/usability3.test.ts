// Usabilidad 3/3: series más rápidas (arrastrar valores, superseries, deshacer borrado) y
// «Repetir» / plantillas con los pesos sugeridos.
import { describe, expect, it } from 'vitest'
import {
  addExerciseBlock,
  canMergeWithNext,
  createSession,
  mergeBlocks,
  mergeWithNext,
  removeSet,
  restoreSet,
  splitExercise,
  toggleSetComplete,
  updateSet,
} from './session-ops'
import { sequentialIds } from './test-helpers'
import {
  defaultTemplateName,
  isRepeatable,
  parseStructure,
  sessionFromStructure,
  structureFromSession,
  structureSummary,
} from './templates'
import { addTimedBlock } from './timed-blocks'
import type { Exercise, LastPerformance, LocalSession } from './types'
import { swipeDirection } from '@/lib/ui/use-swipe'

const T0 = Date.parse('2026-10-14T10:00:00Z')
const squat = { id: 'back_squat', defaultRestS: 180 }
const bench = { id: 'bench_press', defaultRestS: 150 }
const row = { id: 'db_row', defaultRestS: 90 }

function base(): LocalSession {
  const ids = sequentialIds('x')
  let s = createSession('ana', T0, ids)
  s = addExerciseBlock(s, squat, null, T0, ids)
  s = addExerciseBlock(s, bench, null, T0, ids)
  s = addExerciseBlock(s, row, null, T0, ids)
  return s
}

describe('completar serie: la siguiente hereda los valores', () => {
  it('rellena los campos vacíos de la siguiente serie pendiente', () => {
    let s = base()
    const [a, b, c] = s.blocks[0]!.sets
    s = updateSet(s, a!.id, { weightKg: 80, reps: 8 }, T0)
    s = toggleSetComplete(s, a!.id, T0 + 1)
    const sets = s.blocks[0]!.sets
    expect(sets.find((x) => x.id === b!.id)).toMatchObject({ weightKg: 80, reps: 8 })
    // Solo la siguiente.
    expect(sets.find((x) => x.id === c!.id)).toMatchObject({ weightKg: null, reps: null })
  })

  it('respeta lo que ya tiene la siguiente (pirámide de la última vez)', () => {
    let s = base()
    const [a, b] = s.blocks[0]!.sets
    s = updateSet(s, a!.id, { weightKg: 60, reps: 10 }, T0)
    s = updateSet(s, b!.id, { weightKg: 70, reps: null }, T0)
    s = toggleSetComplete(s, a!.id, T0 + 1)
    expect(s.blocks[0]!.sets.find((x) => x.id === b!.id)).toMatchObject({
      weightKg: 70,
      reps: 10,
    })
  })

  it('una serie de calentamiento no arrastra nada', () => {
    let s = base()
    const [a, b] = s.blocks[0]!.sets
    s = updateSet(s, a!.id, { weightKg: 40, reps: 10, isWarmup: true }, T0)
    s = toggleSetComplete(s, a!.id, T0 + 1)
    expect(s.blocks[0]!.sets.find((x) => x.id === b!.id)?.weightKg).toBeNull()
  })

  it('desmarcar no cambia nada', () => {
    let s = base()
    const [a, b] = s.blocks[0]!.sets
    s = updateSet(s, a!.id, { weightKg: 80, reps: 8 }, T0)
    s = toggleSetComplete(s, a!.id, T0 + 1)
    s = updateSet(s, b!.id, { weightKg: 85 }, T0 + 2)
    s = toggleSetComplete(s, a!.id, T0 + 3)
    expect(s.blocks[0]!.sets.find((x) => x.id === b!.id)?.weightKg).toBe(85)
  })
})

describe('superseries', () => {
  it('«Unir con el siguiente» junta ejercicios y series en el bloque de arriba', () => {
    const b0 = base()
    const s = mergeWithNext(b0, b0.blocks[0]!.id, T0 + 1)
    expect(s.blocks).toHaveLength(2)
    const first = s.blocks[0]!
    expect(first.blockType).toBe('superset')
    expect(first.exercises.map((e) => e.exerciseId)).toEqual(['back_squat', 'bench_press'])
    expect(first.sets).toHaveLength(6)
    expect(s.blocks.map((b) => b.order)).toEqual([0, 1])
    expect(s.rev).toBeGreaterThan(base().rev)
  })

  it('arrastrar un ejercicio sobre otro (no contiguo) lo une al destino', () => {
    const before = base()
    const rowBlock = before.blocks[2]!.id
    const squatBlock = before.blocks[0]!.id
    const s = mergeBlocks(before, rowBlock, squatBlock, T0 + 1)
    expect(s.blocks.map((b) => b.exercises.map((e) => e.exerciseId))).toEqual([
      ['back_squat', 'db_row'],
      ['bench_press'],
    ])
  })

  it('no une bloques con temporizador, consigo mismo ni ejercicios repetidos', () => {
    const ids = sequentialIds('t')
    let s = base()
    s = addTimedBlock(
      s,
      { kind: 'emom', minutes: 10, intervalS: 60 },
      [{ exercise: { id: 'burpee', defaultRestS: 60 }, targetReps: 10 }],
      T0,
      ids,
    )
    const emom = s.blocks[3]!.id
    expect(mergeBlocks(s, emom, s.blocks[0]!.id, T0)).toBe(s)
    expect(mergeBlocks(s, s.blocks[0]!.id, s.blocks[0]!.id, T0)).toBe(s)
    expect(canMergeWithNext(s, s.blocks[2]!.id)).toBe(false)
    expect(canMergeWithNext(s, s.blocks[0]!.id)).toBe(true)
    const dup = addExerciseBlock(base(), squat, null, T0, sequentialIds('d'))
    expect(mergeBlocks(dup, dup.blocks[3]!.id, dup.blocks[0]!.id, T0)).toBe(dup)
  })

  it('«Separar» deja el ejercicio en su propio bloque justo después', () => {
    const b0 = base()
    const merged = mergeWithNext(b0, b0.blocks[0]!.id, T0)
    const s = splitExercise(merged, merged.blocks[0]!.id, 'back_squat', T0 + 1, () => 'new')
    expect(s.blocks.map((b) => [b.blockType, b.exercises.map((e) => e.exerciseId)])).toEqual([
      ['straight', ['bench_press']],
      ['straight', ['back_squat']],
      ['straight', ['db_row']],
    ])
    expect(s.blocks[1]!.sets.every((x) => x.exerciseId === 'back_squat')).toBe(true)
  })
})

describe('borrar serie y deshacer', () => {
  it('vuelve a su sitio con su número', () => {
    const s0 = base()
    const block = s0.blocks[0]!
    const second = block.sets[1]!
    const removed = removeSet(s0, second.id, T0 + 1)
    expect(removed.blocks[0]!.sets.map((x) => x.setIndex)).toEqual([0, 1])
    const back = restoreSet(removed, block.id, second, 1, T0 + 2)
    expect(back.blocks[0]!.sets.map((x) => x.id)).toEqual(block.sets.map((x) => x.id))
    expect(back.blocks[0]!.sets.map((x) => x.setIndex)).toEqual([0, 1, 2])
    // Dos veces no la duplica.
    expect(restoreSet(back, block.id, second, 1, T0 + 3)).toBe(back)
  })
})

describe('deslizar', () => {
  it('umbral en los dos sentidos', () => {
    expect(swipeDirection(90)).toBe('right')
    expect(swipeDirection(-81)).toBe('left')
    expect(swipeDirection(40)).toBeNull()
  })
})

// ── Repetir y plantillas ─────────────────────────────────────

const catalog = new Map<string, Exercise>(
  [
    ['back_squat', 'Sentadilla con barra', ['quads', 'glutes']],
    ['bench_press', 'Press banca', ['chest']],
    ['burpee', 'Burpee', ['chest', 'quads']],
  ].map(([id, name, muscles]) => [
    id as string,
    {
      id: id as string,
      name: name as string,
      aliases: [],
      category: 'strength',
      trackingType: 'weight_reps',
      equipment: [],
      isUnilateral: false,
      isCompound: true,
      defaultRestS: 120,
      techniqueNotes: null,
      techniqueSteps: [],
      techniqueMistakes: [],
      ownerId: null,
      muscles: (muscles as string[]).map((m) => ({ muscleId: m, role: 'primary' as const })),
    },
  ]),
)

function lastTime(exerciseId: string, weightKg: number, reps: number[]): LastPerformance {
  return {
    exerciseId,
    endedAt: '2026-10-10T10:00:00Z',
    sets: reps.map((r, i) => ({
      setIndex: i,
      isWarmup: false,
      weightKg,
      reps: r,
      rir: null,
      durationS: null,
      distanceM: null,
      calories: null,
    })),
  }
}

function doneSession(): LocalSession {
  const ids = sequentialIds('s')
  let s = createSession('ana', T0, ids, 'Pierna A')
  s = addExerciseBlock(s, squat, null, T0, ids)
  s = addExerciseBlock(s, bench, null, T0, ids)
  s = mergeWithNext(s, s.blocks[0]!.id, T0)
  // Sentadilla: 2 series hechas de 3 (la tercera no se hizo); press: ninguna completada.
  const [q1, q2] = s.blocks[0]!.sets.filter((x) => x.exerciseId === 'back_squat')
  for (const q of [q1!, q2!]) {
    s = updateSet(s, q.id, { weightKg: 100, reps: 10 }, T0)
    s = toggleSetComplete(s, q.id, T0)
  }
  s = addTimedBlock(
    s,
    { kind: 'emom', minutes: 6, intervalS: 60 },
    [{ exercise: { id: 'burpee', defaultRestS: 60 }, targetReps: 12 }],
    T0,
    ids,
  )
  return { ...s, endedAt: '2026-10-14T11:00:00Z' }
}

describe('estructura de una sesión', () => {
  it('repite lo hecho, sin pesos, y conserva superseries y temporizadores', () => {
    const structure = structureFromSession(doneSession())!
    expect(parseStructure(JSON.parse(JSON.stringify(structure)))).not.toBeNull()
    const [superset, emom] = structure.blocks
    expect(superset!.block_type).toBe('superset')
    const squatSets = superset!.sets.filter((x) => x.exercise_id === 'back_squat')
    expect(squatSets).toHaveLength(2)
    expect(squatSets[0]).toEqual({
      exercise_id: 'back_squat',
      is_warmup: false,
      reps: 10,
      duration_s: null,
      distance_m: null,
    })
    expect(JSON.stringify(structure)).not.toContain('weight')
    // Sin completadas: se copian todas.
    expect(superset!.sets.filter((x) => x.exercise_id === 'bench_press')).toHaveLength(3)
    expect(emom!.settings).toMatchObject({ kind: 'emom', minutes: 6, interval_s: 60 })
    expect(structureSummary(structure, (id) => catalog.get(id)?.name ?? id)).toBe(
      'Sentadilla con barra, Press banca, Burpee',
    )
  })

  it('una actividad sin bloques no se puede repetir', () => {
    expect(isRepeatable(createSession('ana', T0))).toBe(false)
    expect(structureFromSession(createSession('ana', T0))).toBeNull()
  })

  it('nombre por defecto', () => {
    expect(defaultTemplateName('Pierna A', new Date(T0))).toBe('Pierna A')
    expect(defaultTemplateName('Entreno libre', new Date(T0))).toMatch(/^Entreno del 14/)
  })
})

describe('sesión desde una estructura (Repetir / plantilla)', () => {
  it('pesos sugeridos por la progresión doble y la última vez', () => {
    const structure = structureFromSession(doneSession())!
    const session = sessionFromStructure(structure, {
      userId: 'ana',
      title: 'Pierna A',
      sessionType: 'strength',
      catalog,
      // Sentadilla: 3×10 con 100 → techo del rango por defecto (6–10) → +5 kg (tren inferior).
      history: new Map([['back_squat', [lastTime('back_squat', 100, [10, 10])]]]),
      last: new Map([['bench_press', lastTime('bench_press', 60, [8, 8, 8])]]),
      now: T0 + 86_400_000,
      newId: sequentialIds('n'),
    })
    expect(session.mode).toBe('live')
    expect(session.endedAt).toBeNull()
    const [ss, emom] = session.blocks
    expect(ss!.blockType).toBe('superset')
    const squatSets = ss!.sets.filter((x) => x.exerciseId === 'back_squat')
    expect(squatSets.map((x) => [x.weightKg, x.reps, x.completed])).toEqual([
      [105, 10, false],
      [105, 10, false],
    ])
    expect(ss!.exercises[0]!.suggestion?.action).toBe('increase')
    // Press: sin historial para sugerir → peso de la última vez.
    expect(ss!.sets.filter((x) => x.exerciseId === 'bench_press').map((x) => x.weightKg)).toEqual([
      60, 60, 60,
    ])
    expect(emom!.settings).toMatchObject({ kind: 'emom', minutes: 6 })
    expect(emom!.sets).toHaveLength(6)
    expect(emom!.timer).toBeTruthy()
  })

  it('quita los ejercicios que ya no existen', () => {
    const structure = structureFromSession(doneSession())!
    const session = sessionFromStructure(structure, {
      userId: 'ana',
      title: 'X',
      sessionType: 'strength',
      catalog: new Map([['bench_press', catalog.get('bench_press')!]]),
      newId: sequentialIds('m'),
    })
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]!.blockType).toBe('straight')
    expect(session.blocks[0]!.exercises.map((e) => e.exerciseId)).toEqual(['bench_press'])
  })

  it('actividad personalizada', () => {
    const structure = structureFromSession(doneSession())!
    const session = sessionFromStructure(structure, {
      userId: 'ana',
      title: 'Escalada',
      sessionType: 'custom',
      activityTypeId: 'a_1',
      catalog,
    })
    expect(session.activityTypeId).toBe('a_1')
  })
})
