// Parser único de tiempos, distancias, pesos y números para toda la app.
//
// Duraciones (devuelven segundos):
// - Número suelto: en la unidad del campo («25» = 25 min en la duración de una sesión;
//   «90» = 90 s en descansos y series isométricas). Admite decimales («2,5» = 2 min 30 s).
// - Con dos puntos: «25:30» = 25 min 30 s, «1:05:00» = 1 h 5 min. «1:30 h» = 1 h 30 min.
// - Con unidades: «1h05», «1h 5min», «1 hora», «90s», «2'30"», «2m30s», «30 seg», «1,5 h».
// Distancias (devuelven metros): número suelto en la unidad del campo («5» = 5 km en carrera,
//   «400» = 400 m en natación); la unidad escrita manda («400 m», «5 km», «5k»).
// Pesos (devuelven kg): «62,5», «62.5 kg», «135 lb».
// Acepta coma o punto decimal y las comillas tipográficas que pone el teclado del iPhone.

export type DurationUnit = 'min' | 's'
export type DistanceUnit = 'km' | 'm'

function normalize(input: string) {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[’‘′´`]/g, "'")
      .replace(/[”“″]/g, '"')
      .replace(/''/g, '"')
      .replace(/\s+/g, ' ')
      // Fuera los espacios entre número y unidad («1 h 5 min»); entre dos números se quedan
      // y el texto no vale («25 30»).
      .replace(/(?<=[\d.,]) (?=[a-záéíóú'"])/g, '')
      .replace(/(?<=[a-záéíóú'"]) (?=\d)/g, '')
  )
}

const NUMBER = /^\d+(?:[.,]\d+)?$|^[.,]\d+$/

function toNumber(text: string) {
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

// Número decimal (coma o punto). Null si está vacío, no es un número o es negativo.
export function parseNumber(input: string): number | null {
  const text = normalize(input)
  if (!NUMBER.test(text)) return null
  return toNumber(text)
}

// Entero (reps, calorías, pulsaciones…). Admite una unidad detrás («12 reps», «150 ppm»).
export function parseCount(input: string): number | null {
  const m = /^(\d+)(?:reps?|r|kcal|cal|ppm|lpm|bpm|cm|x|veces|rondas?|series?)?$/.exec(
    normalize(input),
  )
  return m ? Number(m[1]) : null
}

const UNIT_SECONDS: [RegExp, number][] = [
  [/^(?:h|hr|hrs|hora|horas)$/, 3600],
  [/^(?:m|min|mins|minuto|minutos|')$/, 60],
  [/^(?:s|seg|segs|sec|secs|segundo|segundos|")$/, 1],
]

function unitSeconds(unit: string) {
  for (const [re, seconds] of UNIT_SECONDS) if (re.test(unit)) return seconds
  return null
}

function round(value: number) {
  return Math.round(value)
}

function parseColon(text: string): number | null {
  const m = /^(\d+(?::\d{1,2}){1,2})([a-z'"]*)$/.exec(text)
  if (!m) return null
  const parts = m[1]!.split(':').map(Number)
  const unit = m[2] ? unitSeconds(m[2]) : null
  if (m[2] && unit === null) return null
  if (parts.slice(1).some((p) => p >= 60)) return null
  if (parts.length === 3) {
    if (unit !== null && unit !== 3600) return null
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  }
  // Dos partes: m:ss salvo que diga horas («1:30 h»). «1:30 s» no tiene sentido.
  if (unit === 3600) return parts[0]! * 3600 + parts[1]! * 60
  if (unit === 1) return null
  return parts[0]! * 60 + parts[1]!
}

function parseUnits(text: string): number | null {
  const tokens = [...text.matchAll(/(\d+(?:[.,]\d+)?)([a-z'"]*)/g)]
  if (tokens.length === 0 || tokens.map((t) => t[0]).join('') !== text) return null
  let total = 0
  let previous: number | null = null
  for (const [index, token] of tokens.entries()) {
    const value = toNumber(token[1]!)
    if (value === null) return null
    let unit = token[2] ? unitSeconds(token[2]) : null
    if (token[2] && unit === null) return null
    if (unit === null) {
      // Solo el último número puede ir sin unidad y vale la unidad siguiente («1h05», «2'30»).
      if (index !== tokens.length - 1 || previous === null || previous === 1) return null
      unit = previous / 60
    }
    if (previous !== null) {
      // Unidades en orden (h > min > s), sin decimales y sin pasar de 59.
      if (unit >= previous || !Number.isInteger(value) || value >= 60) return null
    }
    total += value * unit
    previous = unit
  }
  return round(total)
}

// Duración en segundos. `bare`: unidad del número suelto (min en sesiones, s en descansos).
export function parseDuration(input: string, bare: DurationUnit): number | null {
  const text = normalize(input)
  if (text === '') return null
  if (NUMBER.test(text)) {
    const value = toNumber(text)
    return value === null ? null : round(value * (bare === 'min' ? 60 : 1))
  }
  if (text.includes(':')) return parseColon(text)
  return parseUnits(text)
}

const DISTANCE_UNITS: [RegExp, number][] = [
  [/^(?:km|k|kms|kilometro|kilometros|kilómetro|kilómetros)$/, 1000],
  [/^(?:m|mt|mts|metro|metros)$/, 1],
]

// Distancia en metros. `bare`: unidad del número suelto.
export function parseDistance(input: string, bare: DistanceUnit): number | null {
  const text = normalize(input)
  const m = /^(\d+(?:[.,]\d+)*|[.,]\d+)([a-záéíóú]*)$/.exec(text)
  if (!m) return null
  let factor = bare === 'km' ? 1000 : 1
  if (m[2]) {
    const found = DISTANCE_UNITS.find(([re]) => re.test(m[2]!))
    if (!found) return null
    factor = found[1]
  }
  let number = m[1]!
  // «1.500 m»: punto de miles en metros.
  if (factor === 1 && /^\d{1,3}(?:\.\d{3})+$/.test(number)) number = number.replace(/\./g, '')
  if ((number.match(/[.,]/g) ?? []).length > 1) return null
  const value = toNumber(number)
  return value === null ? null : Math.round(value * factor)
}

const LB_TO_KG = 0.45359237

// Peso en kg (redondeado a 0,01). «135 lb» se convierte.
export function parseWeight(input: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?|[.,]\d+)(kg|kgs|kilo|kilos|lb|lbs|libra|libras)?$/.exec(
    normalize(input),
  )
  if (!m) return null
  const value = toNumber(m[1]!)
  if (value === null) return null
  const kg = m[2]?.startsWith('l') ? value * LB_TO_KG : value
  return Math.round(kg * 100) / 100
}

const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
const kmInput = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

// Texto legible de una duración: «25 min», «25 min 30 s», «1 h 5 min», «45 s».
export function describeDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts = [h > 0 && `${h} h`, m > 0 && `${m} min`, sec > 0 && `${sec} s`].filter(Boolean)
  return parts.length === 0 ? '0 s' : parts.join(' ')
}

export function describeDistance(meters: number, unit: DistanceUnit) {
  return unit === 'km' ? `${decimal.format(meters / 1000)} km` : `${decimal.format(meters)} m`
}

export function describeWeight(kg: number) {
  return `${decimal.format(kg)} kg`
}

// Valor para rellenar un campo de duración con el mismo formato que se escribe.
export function formatDurationInput(seconds: number | null, bare: DurationUnit) {
  if (seconds === null) return ''
  const s = Math.max(0, Math.round(seconds))
  if (bare === 'min' && s % 60 === 0) return String(s / 60)
  if (bare === 's' && s < 60) return String(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatDistanceInput(meters: number | null, unit: DistanceUnit) {
  if (meters === null) return ''
  return unit === 'km' ? kmInput.format(meters / 1000).replace(/\./g, '') : String(meters)
}

export function formatWeightInput(kg: number | null) {
  return kg === null ? '' : decimal.format(kg).replace(/\./g, '')
}

export type QuantityKind =
  | { kind: 'duration'; bare: DurationUnit }
  | { kind: 'distance'; bare: DistanceUnit }
  | { kind: 'weight' }
  | { kind: 'count'; unit?: string }
  | { kind: 'number'; unit?: string }

// Interpreta un texto según el tipo de campo (segundos, metros, kg o número).
export function parseQuantity(input: string, spec: QuantityKind): number | null {
  switch (spec.kind) {
    case 'duration':
      return parseDuration(input, spec.bare)
    case 'distance':
      return parseDistance(input, spec.bare)
    case 'weight':
      return parseWeight(input)
    case 'count':
      return parseCount(input)
    case 'number':
      return parseNumber(input)
  }
}

export function formatQuantityInput(value: number | null, spec: QuantityKind) {
  if (value === null) return ''
  switch (spec.kind) {
    case 'duration':
      return formatDurationInput(value, spec.bare)
    case 'distance':
      return formatDistanceInput(value, spec.bare)
    case 'weight':
      return formatWeightInput(value)
    case 'count':
      return String(Math.round(value))
    case 'number':
      return decimal.format(value).replace(/\./g, '')
  }
}

// Vista previa interpretada: «= 25 min», «= 5,2 km».
export function describeQuantity(value: number, spec: QuantityKind) {
  switch (spec.kind) {
    case 'duration':
      return describeDuration(value)
    case 'distance':
      return describeDistance(value, spec.bare)
    case 'weight':
      return describeWeight(value)
    case 'count':
    case 'number':
      return `${decimal.format(value)}${spec.unit ? ` ${spec.unit}` : ''}`
  }
}

// Unidad que se muestra junto al campo.
export function quantityUnit(spec: QuantityKind) {
  switch (spec.kind) {
    case 'duration':
      return spec.bare
    case 'distance':
      return spec.bare
    case 'weight':
      return 'kg'
    default:
      return spec.unit ?? ''
  }
}

// Ejemplos para el mensaje de error.
export function quantityHint(spec: QuantityKind) {
  switch (spec.kind) {
    case 'duration':
      return spec.bare === 'min'
        ? 'Escribe minutos («25»), «25:30» o «1h05»'
        : 'Escribe segundos («90»), «1:30» o «2\'30"»'
    case 'distance':
      return spec.bare === 'km'
        ? 'Escribe km («5», «5,2») o «400 m»'
        : 'Escribe metros («400») o «5 km»'
    case 'weight':
      return 'Escribe kg («62,5») o «135 lb»'
    case 'count':
      return 'Escribe un número entero'
    case 'number':
      return 'Escribe un número («12,5»)'
  }
}

// Paso de los botones ±: en la unidad del campo (min, s, km, m, kg o unidades).
export function stepQuantity(value: number | null, step: number, spec: QuantityKind) {
  const factor =
    spec.kind === 'duration' && spec.bare === 'min'
      ? 60
      : spec.kind === 'distance' && spec.bare === 'km'
        ? 1000
        : 1
  const next = (value ?? 0) + step * factor
  const rounded = spec.kind === 'weight' ? Math.round(next * 100) / 100 : Math.round(next)
  return Math.max(0, rounded)
}
