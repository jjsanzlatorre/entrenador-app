import { exerciseGroups, type ExerciseGroup } from './exercise-groups'
import { equipmentLabel } from './labels'
import type { Exercise } from './types'

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Raíz común de singular y plural, en español y en inglés: «zancadas» = «zancada»,
// «flexiones» = «flexión», «lunges» = «lunge», «boxes» = «box», «press» se queda igual.
export function stem(word: string) {
  let w = word
  if (w.length <= 3 || w.endsWith('ss')) return w
  if (w.endsWith('es')) w = w.slice(0, -2)
  else if (w.endsWith('s')) w = w.slice(0, -1)
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

// Palabras normalizadas: sin acentos, sin guiones ni signos («pull-up» → «pull up»).
function words(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

type Searchable = { words: string[]; stems: string[]; joined: string; compact: string }

function searchable(text: string): Searchable {
  const w = words(text)
  return { words: w, stems: w.map(stem), joined: w.join(' '), compact: w.join('') }
}

// Un término encaja si una palabra empieza por él (también en singular/plural) o si aparece
// dentro del texto («lift» en «deadlift»).
function termMatches(term: string, target: Searchable) {
  const s = stem(term)
  return (
    target.words.some((w) => w.startsWith(term)) ||
    target.stems.some((w) => w.startsWith(s)) ||
    target.joined.includes(term)
  )
}

function matches(terms: string[], targets: Searchable[]) {
  return terms.every((t) => targets.some((target) => termMatches(t, target)))
}

export type ExerciseFilter = {
  query?: string
  muscleId?: string | null
  equipment?: string | null
  group?: ExerciseGroup | null
}

// Búsqueda por nombre, alias (español e inglés) y material, sin acentos ni mayúsculas, con
// plurales y sin guiones («pullup» = «pull-up»). Filtros por músculo, material y grupo.
// Ordena: empieza por la búsqueda > contiene en el nombre > alias > material.
export function searchExercises(exercises: Exercise[], filter: ExerciseFilter) {
  const terms = words(filter.query ?? '')
  const query = terms.join(' ')
  // Sin espacios y en singular: «push-ups» → «pushup».
  const compactQuery = stem(terms.join(''))

  const scored: { exercise: Exercise; score: number }[] = []
  for (const exercise of exercises) {
    if (filter.muscleId && !exercise.muscles.some((m) => m.muscleId === filter.muscleId)) continue
    if (filter.equipment && !exercise.equipment.includes(filter.equipment)) continue
    if (filter.group && !exerciseGroups(exercise).includes(filter.group)) continue

    if (terms.length === 0) {
      scored.push({ exercise, score: 0 })
      continue
    }
    const name = searchable(exercise.name)
    const aliases = exercise.aliases.map(searchable)
    const equipment = exercise.equipment.flatMap((e) => [
      searchable(equipmentLabel(e)),
      searchable(e),
    ])

    let score = 0
    const startsName = name.joined.startsWith(query) || stem(name.joined).startsWith(stem(query))
    if (startsName) score = 3
    else if (matches(terms, [name]) || name.compact.includes(compactQuery)) score = 2
    else if (aliases.some((a) => a.joined.startsWith(query) || a.compact.startsWith(compactQuery)))
      score = 1.5
    else if (
      aliases.some((a) => matches(terms, [a]) || a.compact.includes(compactQuery)) ||
      matches(terms, [name, ...aliases])
    )
      score = 1
    else if (matches(terms, [name, ...aliases, ...equipment])) score = 0.5
    if (score === 0) continue
    scored.push({ exercise, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name, 'es'))
    .map((s) => s.exercise)
}
