import { describe, expect, it } from 'vitest'
import { searchExercises } from './search'
import { suggestAlternatives } from './substitution'
import { makeExercise } from './test-helpers'

const catalog = [
  makeExercise({
    id: 'back_squat',
    name: 'Sentadilla con barra',
    aliases: ['back squat'],
    equipment: ['barbell'],
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'glutes', role: 'primary' },
      { muscleId: 'core', role: 'secondary' },
    ],
  }),
  makeExercise({
    id: 'goblet_squat',
    name: 'Sentadilla goblet',
    equipment: ['dumbbell', 'kettlebell'],
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'glutes', role: 'primary' },
      { muscleId: 'core', role: 'secondary' },
    ],
  }),
  makeExercise({
    id: 'leg_press',
    name: 'Prensa',
    aliases: ['leg press'],
    equipment: ['machine'],
    muscles: [
      { muscleId: 'quads', role: 'primary' },
      { muscleId: 'glutes', role: 'primary' },
    ],
  }),
  makeExercise({
    id: 'leg_extension',
    name: 'Extensión de cuádriceps',
    isCompound: false,
    equipment: ['machine'],
    muscles: [{ muscleId: 'quads', role: 'primary' }],
  }),
  makeExercise({
    id: 'bench_press',
    name: 'Press banca',
    aliases: ['bench press'],
    equipment: ['barbell'],
    muscles: [{ muscleId: 'chest', role: 'primary' }],
  }),
  makeExercise({ id: 'run', name: 'Carrera', category: 'cardio', muscles: [] }),
]

describe('searchExercises', () => {
  it('busca sin acentos por nombre y alias', () => {
    expect(searchExercises(catalog, { query: 'cuadriceps' }).map((e) => e.id)).toEqual([
      'leg_extension',
    ])
    expect(searchExercises(catalog, { query: 'squat' }).map((e) => e.id)).toEqual(['back_squat'])
    expect(searchExercises(catalog, { query: 'sentadilla' }).map((e) => e.id)).toEqual([
      'back_squat',
      'goblet_squat',
    ])
  })

  it('prioriza los nombres que empiezan por la búsqueda', () => {
    expect(searchExercises(catalog, { query: 'press' }).map((e) => e.id)).toEqual([
      'bench_press',
      'leg_press',
    ])
  })

  it('filtra por músculo y material', () => {
    expect(
      searchExercises(catalog, { muscleId: 'quads', equipment: 'machine' }).map((e) => e.id),
    ).toEqual(['leg_extension', 'leg_press'])
  })
})

describe('suggestAlternatives', () => {
  it('propone ejercicios con los mismos primarios, primero los más parecidos', () => {
    const target = catalog[0]!
    expect(suggestAlternatives(target, catalog).map((e) => e.id)).toEqual([
      'goblet_squat',
      'leg_press',
      'leg_extension',
    ])
  })

  it('respeta el material disponible', () => {
    expect(suggestAlternatives(catalog[0]!, catalog, ['machine']).map((e) => e.id)).toEqual([
      'leg_press',
      'leg_extension',
    ])
  })
})
