// «Escribir entreno»: convierte texto libre en bloques por rondas, sin IA, para los formatos
// habituales. Lógica pura, con tests.
//
//   plancha lateral 45s/lado + hip thrust 20 + dominadas 5 + plancha 45s + flexiones 25, x4
//   press banca 3x10 @60kg
//   4 rondas: remo 500m + burpees 15 + air bike 20 cal; descanso 2 min
//
// - Bloques: una línea o «;» cada uno.
// - Ejercicios de un bloque: «+» (o comas, si cada trozo tiene nombre). Varios = superserie o
//   circuito.
// - Rondas: «x4», «×4», «4 rondas», «4 vueltas» al final, o «4x», «4 rondas:» al principio.
//   «3x10» es 3 series de 10 (en un bloque de varios ejercicios, 3 rondas).
// - Valores: «20» o «20 reps», «45s», «1:30», «2 min», «400m», «5 km», «20 cal», «@20kg»,
//   «20 kg», «135 lb»; «/lado», «cada lado», «por lado» o «c/l» = cada lado.
// - Descanso: «desc 90s», «descanso 1:30», «rest 60s» (entre rondas o entre series).
// Un número suelto se interpreta según el ejercicio: reps si las tiene; si no, tiempo (s en
// isométricos, min en cardio), distancia o calorías.
import { parseDistance, parseDuration, parseWeight } from '@/lib/input/quantity'
import { distanceUnit, durationUnit, setFields } from './fields'
import { normalizeText, searchExercises, stem } from './search'
import type { Exercise } from './types'

export type MatchKind = 'exact' | 'search' | 'ai'

export type ParsedItem = {
  // Lo que escribió el usuario para el ejercicio (para buscarlo o crearlo si no se reconoce).
  name: string
  exerciseId: string | null
  match: MatchKind | null
  sets: number | null
  reps: number | null
  durationS: number | null
  weightKg: number | null
  distanceM: number | null
  calories: number | null
  perSide: boolean
}

export type ParsedBlock = {
  source: string
  rounds: number
  restBetweenRoundsS: number | null
  items: ParsedItem[]
}

export type ParsedWorkout = {
  blocks: ParsedBlock[]
  // Todo reconocido: al menos un bloque y todos los ejercicios encontrados en la biblioteca.
  understood: boolean
}

const DUR = String.raw`(?:\d+:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:h|horas?|min|mins|minutos?|'|s|seg|segs|segundos?|sec|secs|")(?:\s*\d+\s*(?:s|seg|"))?)`
const PER_SIDE =
  /(?:\/\s*|\b(?:cada|por|x)\s+)(?:lado|pierna|brazo)s?\b|\bc\/l\b|\b(?:each|per)\s+side\b|\/\s*side\b/i
const REST = new RegExp(
  String.raw`\b(?:desc(?:anso)?|rest|rec(?:uperaci[oó]n)?)\.?\s*:?\s*(${DUR})`,
  'i',
)
const LEADING_ROUNDS =
  /^\s*(\d{1,2})\s*(?:[x×]|rondas?(?:\s+de)?|vueltas?(?:\s+de)?)\s*[:(-]?\s*(?=[^\d\s])/i
const TRAILING_ROUNDS =
  /(?:^|[,)\s])\s*(?:[x×]\s*(\d{1,2})\s*(?:rondas?|vueltas?)?|(\d{1,2})\s*(?:rondas?|vueltas?))\s*\)?\s*[.,]?\s*$/i
const SETS_BY = new RegExp(
  String.raw`\b(\d{1,2})\s*[x×]\s*(\d+:\d{2}|\d+(?:[.,]\d+)?)(?:\s*(?:-|–|a)\s*\d+)?\s*(s|seg|segs|sec|"|min|mins|'|m|metros?|km|k|cal|kcal|reps?)?(?![a-z])`,
  'i',
)
const WEIGHT =
  /@\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|lbs?)?|(\d+(?:[.,]\d+)?)\s*(kg|kilos?|lbs?)(?![a-z])/i
const CALORIES = /(\d+)\s*(?:kcal|cal|calor[ií]as)(?![a-z])/i
const DURATION = new RegExp(String.raw`(?<![\d:.,])${DUR}(?![a-z])`, 'i')
const DISTANCE = /(?<![\d:.,])(\d+(?:[.,]\d+)?)\s*(km|k|m|metros?)(?![a-z])/i
const REPS = /(?<![\d:.,])(\d+)\s*(?:reps?|repeticiones)?(?![a-z\d])/i

// Palabras que sobran para encontrar el ejercicio («plancha isométrica» → «plancha»).
const FILLER = new Set([
  'isometrica',
  'isometrico',
  'isometricas',
  'isometricos',
  'estatica',
  'estatico',
  'normal',
  'normales',
  'de',
  'del',
  'con',
  'el',
  'la',
  'los',
  'las',
  'en',
  'al',
  'a',
  'y',
])

function cut(text: string, m: RegExpExecArray) {
  return `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
}

function emptyItem(name: string): ParsedItem {
  return {
    name,
    exerciseId: null,
    match: null,
    sets: null,
    reps: null,
    durationS: null,
    weightKg: null,
    distanceM: null,
    calories: null,
    perSide: false,
  }
}

function cleanName(text: string) {
  return text
    .replace(/[()[\]{}:;,.*·•\-–_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Valores de un ejercicio («hip thrust 20 @40kg», «plancha lateral 45s/lado»).
export function parseItem(raw: string): ParsedItem {
  let text = raw.replace(/[’‘′´`]/g, "'").replace(/[”“″]/g, '"')
  const item = emptyItem('')

  let m = PER_SIDE.exec(text)
  if (m) {
    item.perSide = true
    text = cut(text, m)
  }
  m = WEIGHT.exec(text)
  if (m) {
    const value = m[1] ?? m[3] ?? ''
    const unit = (m[2] ?? m[4] ?? 'kg').toLowerCase()
    item.weightKg = parseWeight(`${value} ${unit.startsWith('lb') ? 'lb' : 'kg'}`)
    text = cut(text, m)
  }
  m = SETS_BY.exec(text)
  if (m) {
    item.sets = Number(m[1])
    const value = m[2] ?? ''
    const unit = (m[3] ?? '').toLowerCase()
    if (value.includes(':') || /^(s|seg|segs|sec|"|min|mins|')$/.test(unit)) {
      item.durationS = parseDuration(`${value}${unit}`, 's')
    } else if (/^(m|metros?|km|k)$/.test(unit)) {
      item.distanceM = parseDistance(`${value}${unit.startsWith('metro') ? 'm' : unit}`, 'm')
    } else if (/^(cal|kcal)$/.test(unit)) {
      item.calories = Math.round(Number(value.replace(',', '.')))
    } else {
      item.reps = Math.round(Number(value.replace(',', '.')))
    }
    text = cut(text, m)
  }
  m = CALORIES.exec(text)
  if (m && item.calories === null) {
    item.calories = Number(m[1])
    text = cut(text, m)
  }
  m = DURATION.exec(text)
  if (m && item.durationS === null) {
    item.durationS = parseDuration(m[0].replace(/\s+/g, ''), 's')
    text = cut(text, m)
  }
  m = DISTANCE.exec(text)
  if (m && item.distanceM === null) {
    const unit = (m[2] ?? 'm').toLowerCase()
    item.distanceM = parseDistance(`${m[1]}${unit.startsWith('metro') ? 'm' : unit}`, 'm')
    text = cut(text, m)
  }
  m = REPS.exec(text)
  if (m && item.reps === null) {
    item.reps = Number(m[1])
    text = cut(text, m)
  }
  item.name = cleanName(text)
  return item
}

function wordsOf(text: string) {
  return normalizeText(text)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

const key = (text: string) => wordsOf(text).map(stem).join(' ')

function findExercise(query: string, exercises: Exercise[]) {
  const k = key(query)
  if (!k) return null
  const exact = exercises.find((e) => key(e.name) === k || e.aliases.some((a) => key(a) === k))
  if (exact) return { exercise: exact, match: 'exact' as const }
  const found = searchExercises(exercises, { query })[0]
  return found ? { exercise: found, match: 'search' as const } : null
}

// Ejercicio de la biblioteca para lo escrito: nombre o alias exacto (con plurales y sin tildes);
// si no, la mejor búsqueda; si no, sin las palabras que sobran («isométrica», «de»…).
export function matchExercise(
  name: string,
  exercises: Exercise[],
): { exercise: Exercise; match: 'exact' | 'search' } | null {
  const first = findExercise(name, exercises)
  if (first) return first
  const trimmed = wordsOf(name)
    .filter((w) => !FILLER.has(w))
    .join(' ')
  return trimmed && trimmed !== wordsOf(name).join(' ') ? findExercise(trimmed, exercises) : null
}

// Un número suelto va al campo que tenga el ejercicio: reps si las registra; si no, tiempo,
// distancia o calorías en su unidad («plancha 45» = 45 s, «remo 500» = 500 m, «carrera 5» = 5 km).
export function fitToExercise(item: ParsedItem, exercise: Exercise): ParsedItem {
  const fields = setFields(exercise)
  if (item.reps === null || fields.includes('reps')) return item
  const bare = item.reps
  const next: ParsedItem = { ...item, reps: null }
  for (const field of fields) {
    if (field === 'durationS' && next.durationS === null) {
      next.durationS = durationUnit(exercise) === 'min' ? bare * 60 : bare
      return next
    }
    if (field === 'distanceM' && next.distanceM === null) {
      next.distanceM = distanceUnit(exercise) === 'km' ? bare * 1000 : bare
      return next
    }
    if (field === 'calories' && next.calories === null) {
      next.calories = bare
      return next
    }
  }
  return item
}

function splitItems(body: string): string[] {
  if (body.includes('+')) return body.split('+')
  const parts = body.split(',')
  // Comas como separador solo si cada trozo nombra un ejercicio («press 3x10, 60 kg» no).
  if (parts.length > 1 && parts.every((p) => parseItem(p).name.length > 0)) return parts
  return [body]
}

export function parseBlock(source: string, exercises: Exercise[]): ParsedBlock | null {
  let text = source.trim()
  if (!text) return null
  let rounds: number | null = null
  let rest: number | null = null

  const restMatch = REST.exec(text)
  if (restMatch) {
    rest = parseDuration((restMatch[1] ?? '').replace(/\s+/g, ''), 's')
    text = cut(text, restMatch).trim()
  }
  const lead = LEADING_ROUNDS.exec(text)
  if (lead) {
    rounds = Number(lead[1])
    text = text.slice(lead[0].length)
  }
  const trail = TRAILING_ROUNDS.exec(text)
  if (trail) {
    rounds ??= Number(trail[1] ?? trail[2])
    text = text.slice(0, trail.index)
  }
  text = text.replace(/^[\s(:]+|[\s),.:]+$/g, '')

  const items = splitItems(text)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const item = parseItem(raw)
      const found = item.name ? matchExercise(item.name, exercises) : null
      return found
        ? fitToExercise(
            { ...item, exerciseId: found.exercise.id, match: found.match },
            found.exercise,
          )
        : item
    })
    .filter((item) => item.name || item.exerciseId)
  if (items.length === 0) return null

  const maxSets = Math.max(0, ...items.map((i) => i.sets ?? 0))
  const resolved = rounds ?? (maxSets > 0 ? maxSets : items.length > 1 ? 3 : 1)
  return {
    source,
    rounds: Math.min(20, Math.max(1, resolved)),
    restBetweenRoundsS: rest,
    items,
  }
}

export function parseWorkoutText(text: string, exercises: Exercise[]): ParsedWorkout {
  const blocks = text
    .split(/[\n;]+/)
    .map((line) => parseBlock(line, exercises))
    .filter((b): b is ParsedBlock => b !== null)
  return {
    blocks,
    understood: blocks.length > 0 && blocks.every((b) => b.items.every((i) => i.exerciseId)),
  }
}

// Respuesta de la IA (workoutParseSchema) → los mismos bloques que el parser, marcados «ai».
// Los ids que no estén en la biblioteca se quedan sin ejercicio (para elegirlo o crearlo).
export type AiParsedBlock = {
  rounds: number
  rest_s?: number
  exercises: {
    exercise_id?: string
    name: string
    reps?: number
    duration_s?: number
    weight_kg?: number
    distance_m?: number
    calories?: number
    per_side?: boolean
  }[]
}

export function parsedFromAi(blocks: AiParsedBlock[], exercises: Exercise[]): ParsedWorkout {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const parsed: ParsedBlock[] = blocks.map((b) => ({
    source: '',
    rounds: Math.min(20, Math.max(1, b.rounds)),
    restBetweenRoundsS: b.rest_s ?? null,
    items: b.exercises.map((e) => {
      const exercise = e.exercise_id ? byId.get(e.exercise_id) : undefined
      const item: ParsedItem = {
        name: e.name,
        exerciseId: exercise?.id ?? null,
        match: exercise ? 'ai' : null,
        sets: null,
        reps: e.reps ?? null,
        durationS: e.duration_s ?? null,
        weightKg: e.weight_kg ?? null,
        distanceM: e.distance_m ?? null,
        calories: e.calories ?? null,
        perSide: e.per_side ?? false,
      }
      return exercise ? fitToExercise(item, exercise) : item
    }),
  }))
  return {
    blocks: parsed,
    understood: parsed.length > 0 && parsed.every((b) => b.items.every((i) => i.exerciseId)),
  }
}
