import { describe, expect, it } from 'vitest'
import * as ops from './session-ops'
import {
  defaultRepRange,
  mergeHistory,
  parseRepRange,
  suggestionFor,
  suggestWeight,
  weightIncrement,
} from './suggestion'
import { makeExercise, sequentialIds } from './test-helpers'
import type { LastPerformance } from './types'

type S = { w: number; r: number; rir?: number | null; warm?: boolean }

function perf(endedAt: string, sets: S[], exerciseId = 'bench_press'): LastPerformance {
  return {
    exerciseId,
    endedAt,
    sets: sets.map((s, i) => ({
      setIndex: i,
      isWarmup: s.warm ?? false,
      weightKg: s.w,
      reps: s.r,
      rir: s.rir ?? null,
      durationS: null,
      distanceM: null,
      calories: null,
    })),
  }
}

const range = { min: 8, max: 10 }
const last = (sets: S[]) => perf('2026-09-20T10:00:00Z', sets)
const prev = (sets: S[]) => perf('2026-09-15T10:00:00Z', sets)

describe('parseRepRange / rango por defecto / incremento', () => {
  it('lee «8-10», «8–10» y «12»', () => {
    expect(parseRepRange('8-10')).toEqual({ min: 8, max: 10 })
    expect(parseRepRange('8–10')).toEqual({ min: 8, max: 10 })
    expect(parseRepRange('12')).toEqual({ min: 12, max: 12 })
    expect(parseRepRange('AMRAP')).toBeNull()
    expect(parseRepRange('10-8')).toBeNull()
    expect(parseRepRange(undefined)).toBeNull()
  })
  it('sin prescripción: 6–10 en compuestos y 8–12 en accesorios', () => {
    expect(defaultRepRange({ isCompound: true })).toEqual({ min: 6, max: 10 })
    expect(defaultRepRange({ isCompound: false })).toEqual({ min: 8, max: 12 })
  })
  it('+5 kg si el músculo principal es del tren inferior; si no, +2,5 kg', () => {
    const squat = makeExercise({
      id: 'back_squat',
      muscles: [
        { muscleId: 'quads', role: 'primary' },
        { muscleId: 'core', role: 'secondary' },
      ],
    })
    const bench = makeExercise({
      id: 'bench_press',
      muscles: [
        { muscleId: 'chest', role: 'primary' },
        { muscleId: 'triceps', role: 'secondary' },
      ],
    })
    // Secundario de pierna no cuenta.
    const row = makeExercise({
      id: 'barbell_row',
      muscles: [
        { muscleId: 'upper_back', role: 'primary' },
        { muscleId: 'hamstrings', role: 'secondary' },
      ],
    })
    expect(weightIncrement(squat)).toBe(5)
    expect(weightIncrement(bench)).toBe(2.5)
    expect(weightIncrement(row)).toBe(2.5)
  })
})

describe('suggestWeight (progresión doble, §10)', () => {
  it('techo del rango en todas las series → sube, con el motivo', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 40, r: 12, warm: true },
          { w: 60, r: 10 },
          { w: 60, r: 10 },
          { w: 60, r: 10 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('increase')
    expect(s.weightKg).toBe(62.5)
    expect(s.previousKg).toBe(60)
    expect(s.reason).toBe('+2,5 kg: completaste 3×10 con 60 kg la última vez')
  })

  it('tren inferior sube 5 kg', () => {
    const s = suggestWeight(
      'back_squat',
      [
        last([
          { w: 100, r: 10 },
          { w: 100, r: 10 },
        ]),
      ],
      range,
      5,
    )!
    expect(s.weightKg).toBe(105)
    expect(s.reason).toContain('+5 kg')
  })

  it('solo cuentan las series con el peso más alto (las de aproximación no)', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 50, r: 6 },
          { w: 60, r: 10 },
          { w: 60, r: 11 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('increase')
    expect(s.reason).toContain('2×10')
  })

  it('dentro del rango sin llegar al techo → mantener', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 60, r: 10 },
          { w: 60, r: 9 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('keep')
    expect(s.weightKg).toBe(60)
    expect(s.reason).toBe('Mantén 60 kg y busca 2×10')
  })

  it('RIR ≥ 3 en todas las series con RIR → sube aunque no llegara al techo', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 60, r: 8, rir: 3 },
          { w: 60, r: 8, rir: 4 },
          { w: 60, r: 8, rir: null },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('increase')
    expect(s.weightKg).toBe(62.5)
    expect(s.reason).toBe('+2,5 kg: la última vez te sobraban reps (RIR 3)')
  })

  it('RIR 2 en alguna serie → no sube', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 60, r: 8, rir: 3 },
          { w: 60, r: 8, rir: 2 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('keep')
  })

  it('reps incompletas → mantener (aunque el RIR fuera alto)', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 60, r: 8 },
          { w: 60, r: 6, rir: 3 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('keep')
    expect(s.weightKg).toBe(60)
    expect(s.reason).toBe('Mantén 60 kg: la última vez no llegaste a 8 reps en todas las series')
  })

  it('dos sesiones seguidas sin completar → −10 % redondeado a 0,5 kg', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([
          { w: 62.5, r: 7 },
          { w: 62.5, r: 6 },
        ]),
        prev([
          { w: 62.5, r: 8 },
          { w: 62.5, r: 7 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('decrease')
    expect(s.weightKg).toBe(56.5) // 62,5 × 0,9 = 56,25 → 56,5
    expect(s.reason).toBe('−10 % (56,5 kg): no llegaste a 8 reps en las dos últimas sesiones')
  })

  it('un fallo tras una sesión buena → mantener', () => {
    const s = suggestWeight(
      'bench_press',
      [
        last([{ w: 62.5, r: 6 }]),
        prev([
          { w: 60, r: 10 },
          { w: 60, r: 10 },
        ]),
      ],
      range,
      2.5,
    )!
    expect(s.action).toBe('keep')
  })

  it('sin series de trabajo con peso → sin sugerencia', () => {
    expect(suggestWeight('x', [], range, 2.5)).toBeNull()
    expect(suggestWeight('x', [last([{ w: 40, r: 10, warm: true }])], range, 2.5)).toBeNull()
  })
})

describe('suggestionFor', () => {
  const bench = makeExercise({
    id: 'bench_press',
    muscles: [{ muscleId: 'chest', role: 'primary' }],
  })
  it('usa el rango prescrito y, si no hay, el de por defecto', () => {
    const history = [
      last([
        { w: 60, r: 10 },
        { w: 60, r: 10 },
      ]),
    ]
    expect(suggestionFor(bench, 'bench_press', history, '8-10')!.action).toBe('increase')
    // Por defecto (compuesto): 6–10 → 10 es el techo → sube.
    expect(suggestionFor(bench, 'bench_press', history)!.action).toBe('increase')
    // Con 10–12 prescrito, 10 no es el techo.
    expect(suggestionFor(bench, 'bench_press', history, '10-12')!.action).toBe('keep')
  })
  it('solo ejercicios con peso y con historial', () => {
    const plank = makeExercise({ id: 'plank', trackingType: 'time' })
    expect(suggestionFor(plank, 'plank', [last([{ w: 10, r: 10 }])])).toBeNull()
    expect(suggestionFor(bench, 'bench_press', [])).toBeNull()
    expect(suggestionFor(undefined, 'bench_press', [last([{ w: 60, r: 10 }])])).toBeNull()
  })
})

describe('mergeHistory', () => {
  it('ordena de más reciente a más antigua, sin duplicados, como mucho 2', () => {
    const a = perf('2026-09-01T00:00:00Z', [{ w: 1, r: 1 }])
    const b = perf('2026-09-10T00:00:00Z', [{ w: 2, r: 2 }])
    const c = perf('2026-09-20T00:00:00Z', [{ w: 3, r: 3 }])
    expect(mergeHistory([a, b], [b, c]).map((p) => p.endedAt)).toEqual([c.endedAt, b.endedAt])
    expect(mergeHistory(undefined, [a])).toEqual([a])
  })
})

describe('aplicar y deshacer la sugerencia en la sesión', () => {
  it('precarga el peso en las series de trabajo pendientes y «Usar X kg» lo deshace', () => {
    const newId = sequentialIds()
    const bench = makeExercise({ id: 'bench_press' })
    let s = ops.createSession('u', 0, newId)
    s = ops.addExerciseBlock(
      s,
      bench,
      last([
        { w: 40, r: 12, warm: true },
        { w: 60, r: 10 },
      ]),
      1,
      newId,
    )
    const blockId = s.blocks[0]!.id
    const suggestion = suggestWeight('bench_press', [last([{ w: 60, r: 10 }])], range, 2.5)!
    s = ops.applyWeightSuggestion(s, blockId, suggestion, 2)
    const sets = s.blocks[0]!.sets
    expect(sets.map((x) => x.weightKg)).toEqual([40, 62.5])
    expect(s.blocks[0]!.exercises[0]!.suggestion?.weightKg).toBe(62.5)

    s = ops.revertWeightSuggestion(s, blockId, 'bench_press', 3)
    expect(s.blocks[0]!.sets.map((x) => x.weightKg)).toEqual([40, 60])
    expect(s.blocks[0]!.exercises[0]!.suggestion?.reverted).toBe(true)
  })

  it('no toca series ya completadas', () => {
    const newId = sequentialIds()
    const bench = makeExercise({ id: 'bench_press' })
    let s = ops.createSession('u', 0, newId)
    s = ops.addExerciseBlock(
      s,
      bench,
      last([
        { w: 60, r: 10 },
        { w: 60, r: 10 },
      ]),
      1,
      newId,
    )
    const block = s.blocks[0]!
    s = ops.toggleSetComplete(s, block.sets[0]!.id, 2)
    const suggestion = suggestWeight('bench_press', [last([{ w: 60, r: 10 }])], range, 2.5)!
    s = ops.applyWeightSuggestion(s, block.id, suggestion, 3)
    expect(s.blocks[0]!.sets.map((x) => x.weightKg)).toEqual([60, 62.5])
  })
})
