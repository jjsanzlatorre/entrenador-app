// Imágenes de técnica (posición inicial y final) de bases de datos abiertas, servidas desde
// public/exercises/. El mapeo revisable está en src/data/exercise-images.json y las imágenes
// se generan con scripts/exercise-images.ts. Solo ejercicios globales: los propios no tienen.
import mapJson from '../../data/exercise-images.json'

export type ExerciseImageRole = 'start' | 'end' | 'hold'

export type ImageSource = {
  name: string
  author: string
  url: string
  license: string
  licenseUrl: string
  imageBaseUrl: string
}

type ImageMapEntry = {
  source: string
  sourceId: string
  note?: string
  images: { from: number; role: ExerciseImageRole }[]
}

export type ExerciseImageMap = {
  sources: Record<string, ImageSource>
  exercises: Record<string, ImageMapEntry>
  unmatched: Record<string, string>
}

export const exerciseImageMap = mapJson as unknown as ExerciseImageMap

export const EXERCISE_IMAGE_MAX_BYTES = 50 * 1024

export const IMAGE_ROLE_LABELS: Record<ExerciseImageRole, string> = {
  start: 'Posición inicial',
  end: 'Posición final',
  hold: 'Posición',
}

export function exerciseImageFile(exerciseId: string, role: ExerciseImageRole) {
  return `${exerciseId}-${role}.webp`
}

export type ExerciseImages = {
  images: { src: string; role: ExerciseImageRole; label: string }[]
  note: string | null
  source: ImageSource
  sourceExerciseName: string
  sourceExerciseUrl: string
}

export function exerciseImages(exerciseId: string): ExerciseImages | null {
  const entry = exerciseImageMap.exercises[exerciseId]
  if (!entry) return null
  const source = exerciseImageMap.sources[entry.source]
  if (!source) return null
  return {
    images: entry.images.map((image) => ({
      src: `/exercises/${exerciseImageFile(exerciseId, image.role)}`,
      role: image.role,
      label: IMAGE_ROLE_LABELS[image.role],
    })),
    note: entry.note ?? null,
    source,
    sourceExerciseName: entry.sourceId.replace(/_/g, ' '),
    sourceExerciseUrl: `${source.url}/tree/main/exercises/${encodeURIComponent(entry.sourceId)}`,
  }
}

export function imageSources(): ImageSource[] {
  return Object.values(exerciseImageMap.sources)
}

// Búsqueda de YouTube (sin API ni claves) en una pestaña nueva.
export function techniqueVideoUrl(exerciseName: string) {
  const query = `técnica ${exerciseName.trim()}`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}
