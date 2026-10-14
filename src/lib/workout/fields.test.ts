import { describe, expect, it } from 'vitest'
import { loadAllSeedExercises } from '../../../scripts/seed-exercises'
import {
  distanceUnit,
  durationUnit,
  fieldSpecs,
  formatSetValues,
  setFields,
  type FieldExercise,
} from './fields'
import type { ExerciseCategory, TrackingType } from '@/types/database'

const library = new Map(
  loadAllSeedExercises().exercises.map((e) => [
    e.id,
    {
      id: e.id,
      trackingType: e.tracking_type as TrackingType,
      category: e.category as ExerciseCategory,
      equipment: e.equipment,
    } satisfies FieldExercise,
  ]),
)
const ex = (id: string) => {
  const e = library.get(id)
  if (!e) throw new Error(`no existe ${id}`)
  return e
}

describe('campos de cada serie', () => {
  it('fuerza: peso y reps; peso corporal: reps', () => {
    expect(setFields(ex('bench_press'))).toEqual(['weightKg', 'reps'])
    expect(setFields(ex('pull_up'))).toEqual(['reps'])
  })

  it('isométricos por tiempo (con peso si llevan carga)', () => {
    expect(setFields(ex('plank'))).toEqual(['durationS'])
    expect(setFields(ex('dead_hang'))).toEqual(['durationS'])
    expect(setFields(ex('l_sit'))).toEqual(['durationS'])
    expect(setFields(ex('farmer_hold'))).toEqual(['weightKg', 'durationS'])
  })

  it('máquinas de cardio: distancia, tiempo y/o calorías según la máquina', () => {
    expect(setFields(ex('row_erg'))).toEqual(['distanceM', 'durationS', 'calories'])
    expect(setFields(ex('skierg'))).toEqual(['distanceM', 'durationS', 'calories'])
    expect(setFields(ex('treadmill_run'))).toEqual(['distanceM', 'durationS', 'calories'])
    expect(setFields(ex('air_bike'))).toEqual(['calories', 'durationS', 'distanceM'])
    expect(setFields(ex('echo_bike'))).toEqual(['calories', 'durationS', 'distanceM'])
    expect(setFields(ex('stair_climber'))).toEqual(['durationS', 'calories'])
    expect(setFields(ex('elliptical'))).toEqual(['durationS', 'distanceM', 'calories'])
    expect(setFields(ex('stationary_bike'))).toEqual(['durationS', 'distanceM', 'calories'])
  })

  it('functional por distancia lleva peso (trineo, farmers)', () => {
    expect(setFields(ex('sled_push'))).toEqual(['weightKg', 'distanceM', 'durationS'])
  })

  it('todas las series de la biblioteca tienen al menos un campo', () => {
    for (const e of library.values()) expect(setFields(e).length, e.id).toBeGreaterThan(0)
  })
})

describe('unidades', () => {
  it('distancia: km en carrera, bici y cinta; m en natación, remo y trineo', () => {
    expect(distanceUnit(ex('run'))).toBe('km')
    expect(distanceUnit(ex('bike'))).toBe('km')
    expect(distanceUnit(ex('treadmill_run'))).toBe('km')
    expect(distanceUnit(ex('stationary_bike'))).toBe('km')
    expect(distanceUnit(ex('swim_freestyle'))).toBe('m')
    expect(distanceUnit(ex('row_erg'))).toBe('m')
    expect(distanceUnit(ex('sled_push'))).toBe('m')
  })

  it('número suelto de tiempo: s en isométricos y estaciones; min en cardio', () => {
    expect(durationUnit(ex('plank'))).toBe('s')
    expect(durationUnit(ex('dead_hang'))).toBe('s')
    expect(durationUnit(ex('sled_push'))).toBe('s')
    expect(durationUnit(ex('run'))).toBe('min')
    expect(durationUnit(ex('swim_freestyle'))).toBe('min')
    expect(durationUnit(ex('row_erg'))).toBe('min')
    expect(durationUnit(ex('yoga'))).toBe('min')
  })

  it('las especificaciones llevan la unidad visible y el paso', () => {
    expect(fieldSpecs(ex('run')).map((s) => [s.field, s.unit, s.step])).toEqual([
      ['distanceM', 'km', 0.5],
      ['durationS', 'min', 1],
    ])
    expect(fieldSpecs(ex('plank')).map((s) => [s.field, s.unit, s.step])).toEqual([
      ['durationS', 's', 5],
    ])
  })

  it('texto de una serie con su unidad', () => {
    const base = { weightKg: null, reps: null, durationS: null, distanceM: null, calories: null }
    expect(formatSetValues({ ...base, distanceM: 5200, durationS: 1530 }, ex('run'))).toBe(
      '5,2 km × 25:30',
    )
    expect(formatSetValues({ ...base, distanceM: 400, durationS: 95 }, ex('swim_freestyle'))).toBe(
      '400 m × 1:35',
    )
    expect(formatSetValues({ ...base, weightKg: 62.5, reps: 8 }, ex('bench_press'))).toBe(
      '62,5 kg × 8 reps',
    )
  })
})
