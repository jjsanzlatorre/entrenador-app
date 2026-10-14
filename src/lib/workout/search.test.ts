import { describe, expect, it } from 'vitest'
import { exerciseGroups } from './exercise-groups'
import { searchExercises, stem } from './search'
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

const extra = [
  makeExercise({
    id: 'lunge',
    name: 'Zancadas',
    aliases: ['lunges', 'zancada'],
    equipment: ['dumbbell', 'bodyweight'],
    muscles: [{ muscleId: 'quads', role: 'primary' }],
  }),
  makeExercise({
    id: 'push_up',
    name: 'Flexiones',
    aliases: ['push-up', 'push up'],
    equipment: ['bodyweight'],
    muscles: [{ muscleId: 'chest', role: 'primary' }],
  }),
  makeExercise({
    id: 'pull_up',
    name: 'Dominadas',
    aliases: ['pull-up', 'pullups'],
    equipment: ['pullup_bar', 'bodyweight'],
    muscles: [{ muscleId: 'lats', role: 'primary' }],
  }),
  makeExercise({
    id: 'stair_climber',
    name: 'Escaladora / StairMaster',
    aliases: ['stair climber', 'stairmaster', 'escaleras'],
    category: 'cardio',
    trackingType: 'duration_only',
    equipment: ['stair_climber'],
    muscles: [{ muscleId: 'quads', role: 'primary' }],
  }),
  makeExercise({
    id: 'side_plank',
    name: 'Plancha lateral',
    aliases: ['side plank'],
    trackingType: 'time',
    equipment: ['bodyweight', 'mat'],
    muscles: [{ muscleId: 'core', role: 'primary' }],
  }),
  makeExercise({
    id: 'cat_cow',
    name: 'Gato-camello',
    aliases: ['cat-cow', 'cat cow'],
    category: 'mobility',
    trackingType: 'reps',
    equipment: ['mat'],
    muscles: [{ muscleId: 'lower_back', role: 'primary' }],
  }),
  makeExercise({
    id: 'cable_crunch',
    name: 'Crunch en polea',
    aliases: ['cable crunch'],
    equipment: ['cable'],
    muscles: [{ muscleId: 'core', role: 'primary' }],
  }),
]
const all = [...catalog, ...extra]
const ids = (query: string) => searchExercises(all, { query }).map((e) => e.id)

describe('búsqueda tolerante', () => {
  it('stem: singular y plural en español e inglés', () => {
    expect(stem('zancadas')).toBe(stem('zancada'))
    expect(stem('flexiones')).toBe(stem('flexion'))
    expect(stem('lunges')).toBe(stem('lunge'))
    expect(stem('boxes')).toBe(stem('box'))
    expect(stem('sentadillas')).toBe(stem('sentadilla'))
    expect(stem('press')).toBe('press')
    expect(stem('abs')).toBe('abs')
  })

  it('plurales y singulares', () => {
    expect(ids('zancada')).toEqual(['lunge'])
    expect(ids('zancadas')).toEqual(['lunge'])
    expect(ids('flexion')).toEqual(['push_up'])
    expect(ids('dominada')).toEqual(['pull_up'])
    expect(ids('sentadillas')).toEqual(['back_squat', 'goblet_squat'])
    expect(ids('planchas laterales')).toEqual(['side_plank'])
  })

  it('tildes y mayúsculas', () => {
    expect(ids('FLEXIÓN')).toEqual(['push_up'])
    expect(ids('Extensión de cuadríceps')).toEqual(['leg_extension'])
    expect(ids('CUÁDRICEPS')).toEqual(['leg_extension'])
  })

  it('español e inglés, con o sin guiones', () => {
    expect(ids('push up')).toEqual(['push_up'])
    expect(ids('pushup')).toEqual(['push_up'])
    expect(ids('push-ups')).toEqual(['push_up'])
    expect(ids('pullup')).toEqual(['pull_up'])
    expect(ids('pull ups')).toEqual(['pull_up'])
    expect(ids('stairmaster')).toEqual(['stair_climber'])
    expect(ids('escalera')).toEqual(['stair_climber'])
    expect(ids('cat cow')).toEqual(['cat_cow'])
    expect(ids('gato camello')).toEqual(['cat_cow'])
    expect(ids('side plank')).toEqual(['side_plank'])
  })

  it('por material, después de los nombres', () => {
    expect(ids('polea')).toEqual(['cable_crunch'])
    expect(ids('mancuernas')).toEqual(['goblet_squat', 'lunge'])
    expect(ids('crunch')).toEqual(['cable_crunch'])
  })

  it('sin resultados devuelve una lista vacía', () => {
    expect(ids('patada voladora')).toEqual([])
  })
})

describe('grupos', () => {
  it('derivados de categoría, material y músculos', () => {
    const groups = (id: string) => exerciseGroups(all.find((e) => e.id === id)!)
    expect(groups('stair_climber')).toEqual(['cardio_machine'])
    expect(groups('side_plank')).toEqual(['strength', 'core', 'bodyweight'])
    expect(groups('cable_crunch')).toEqual(['strength', 'gym_machine', 'core'])
    expect(groups('cat_cow')).toEqual(['mobility'])
    expect(groups('run')).toEqual(['cardio_sport'])
    expect(groups('pull_up')).toEqual(['strength', 'bodyweight'])
  })

  it('filtra por grupo junto a la búsqueda', () => {
    expect(searchExercises(all, { group: 'core' }).map((e) => e.id)).toEqual([
      'cable_crunch',
      'side_plank',
    ])
    expect(searchExercises(all, { group: 'cardio_machine' }).map((e) => e.id)).toEqual([
      'stair_climber',
    ])
    expect(searchExercises(all, { group: 'core', query: 'plancha' }).map((e) => e.id)).toEqual([
      'side_plank',
    ])
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
