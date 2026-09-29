import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLazyPublicFile } from '../../../scripts/vite-sw-plugin'
import {
  EXERCISE_IMAGE_MAX_BYTES,
  exerciseImageFile,
  exerciseImageMap,
  exerciseImages,
  techniqueVideoUrl,
} from './exercise-images'

const root = join(import.meta.dirname, '../../..')
const seedIds = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8')) as {
    exercises: { id: string }[]
  }
).exercises.map((e) => e.id)
const technique = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/exercise_technique.json'), 'utf8')) as {
    technique: Record<string, { steps: string[]; mistakes: string[] }>
  }
).technique
const imagesDir = join(root, 'public/exercises')

describe('técnica en texto (fase 6C)', () => {
  it('todos los ejercicios globales tienen 3–4 pasos y 2–3 errores típicos', () => {
    expect(Object.keys(technique).sort()).toEqual([...seedIds].sort())
    for (const id of seedIds) {
      const t = technique[id]!
      expect(t.steps.length, id).toBeGreaterThanOrEqual(3)
      expect(t.steps.length, id).toBeLessThanOrEqual(4)
      expect(t.mistakes.length, id).toBeGreaterThanOrEqual(2)
      expect(t.mistakes.length, id).toBeLessThanOrEqual(3)
      for (const line of [...t.steps, ...t.mistakes]) {
        expect(line.trim(), id).toBe(line)
        expect(line.length, id).toBeGreaterThan(10)
        expect(line.length, id).toBeLessThanOrEqual(160)
      }
    }
  })
})

describe('imágenes de técnica', () => {
  it('cada ejercicio global está mapeado o en «unmatched» con su motivo, nunca en los dos', () => {
    const mapped = Object.keys(exerciseImageMap.exercises)
    const unmatched = Object.keys(exerciseImageMap.unmatched)
    expect(mapped.filter((id) => unmatched.includes(id))).toEqual([])
    expect([...mapped, ...unmatched].sort()).toEqual([...seedIds].sort())
    for (const reason of Object.values(exerciseImageMap.unmatched)) expect(reason).not.toBe('')
  })

  it('las imágenes existen, son WebP de ≤ 50 KB y no sobra ninguna', () => {
    const expected = Object.entries(exerciseImageMap.exercises).flatMap(([id, entry]) => {
      expect(exerciseImageMap.sources[entry.source], id).toBeDefined()
      expect(entry.images.length, id).toBeGreaterThan(0)
      return entry.images.map((image) => exerciseImageFile(id, image.role))
    })
    expect(readdirSync(imagesDir).sort()).toEqual([...expected].sort())
    for (const file of expected) {
      const path = join(imagesDir, file)
      expect(statSync(path).size, file).toBeLessThanOrEqual(EXERCISE_IMAGE_MAX_BYTES)
      const header = readFileSync(path).subarray(0, 12).toString('latin1')
      expect(header.slice(0, 4), file).toBe('RIFF')
      expect(header.slice(8, 12), file).toBe('WEBP')
    }
  })

  it('devuelve posición inicial y final con la fuente, y nada para ejercicios sin imagen', () => {
    const bench = exerciseImages('bench_press')!
    expect(bench.images.map((i) => [i.src, i.label])).toEqual([
      ['/exercises/bench_press-start.webp', 'Posición inicial'],
      ['/exercises/bench_press-end.webp', 'Posición final'],
    ])
    expect(bench.source.license).toContain('Unlicense')
    expect(bench.sourceExerciseName).toBe('Barbell Bench Press - Medium Grip')
    expect(bench.sourceExerciseUrl).toContain('github.com/yuhonas/free-exercise-db')
    expect(exerciseImages('wall_ball')).toBeNull()
    expect(exerciseImages('u_1234')).toBeNull()
  })

  it('las imágenes no entran en la precarga del service worker', () => {
    expect(isLazyPublicFile('/exercises/bench_press-start.webp')).toBe(true)
    expect(isLazyPublicFile('/icons/icon-192.png')).toBe(false)
  })
})

describe('vídeo de técnica', () => {
  it('abre una búsqueda de YouTube con «técnica {nombre}»', () => {
    const url = new URL(techniqueVideoUrl(' Press banca '))
    expect(url.origin).toBe('https://www.youtube.com')
    expect(url.pathname).toBe('/results')
    expect(url.searchParams.get('search_query')).toBe('técnica Press banca')
  })
})
