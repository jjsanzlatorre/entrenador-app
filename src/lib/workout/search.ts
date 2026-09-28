import type { Exercise } from './types'

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export type ExerciseFilter = { query?: string; muscleId?: string | null; equipment?: string | null }

// Búsqueda por nombre y alias (sin acentos), con filtro por músculo y material.
// Ordena: empieza por la búsqueda > contiene en el nombre > contiene en un alias.
export function searchExercises(exercises: Exercise[], filter: ExerciseFilter) {
  const terms = normalizeText(filter.query ?? '')
    .split(/\s+/)
    .filter(Boolean)

  const scored: { exercise: Exercise; score: number }[] = []
  for (const exercise of exercises) {
    if (filter.muscleId && !exercise.muscles.some((m) => m.muscleId === filter.muscleId)) continue
    if (filter.equipment && !exercise.equipment.includes(filter.equipment)) continue

    if (terms.length === 0) {
      scored.push({ exercise, score: 0 })
      continue
    }
    const name = normalizeText(exercise.name)
    const aliases = exercise.aliases.map(normalizeText)
    const haystack = [name, ...aliases].join(' | ')
    if (!terms.every((t) => haystack.includes(t))) continue

    const query = terms.join(' ')
    const score = name.startsWith(query)
      ? 3
      : name.includes(query)
        ? 2
        : aliases.some((a) => a.startsWith(query))
          ? 1.5
          : 1
    scored.push({ exercise, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name, 'es'))
    .map((s) => s.exercise)
}
