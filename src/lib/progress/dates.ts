// Fechas «de calendario» como texto YYYY-MM-DD (día local del dispositivo).
// La aritmética se hace en UTC para no depender de cambios de hora.

export type DateKey = string

const pad = (n: number) => String(n).padStart(2, '0')

// Día local de un instante (ISO o Date).
export function localDateKey(value: string | Date | number): DateKey {
  const d = value instanceof Date ? value : new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toUtc(key: DateKey) {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): DateKey {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromUtc(toUtc(key) + days * 86_400_000)
}

export function daysBetween(from: DateKey, to: DateKey) {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}

// 1 = lunes … 7 = domingo.
export function isoWeekday(key: DateKey) {
  const day = new Date(toUtc(key)).getUTCDay()
  return day === 0 ? 7 : day
}

export function weekStartOf(key: DateKey): DateKey {
  return addDays(key, 1 - isoWeekday(key))
}

export function monthStartOf(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`
}

export function addMonths(monthStart: DateKey, months: number): DateKey {
  const [y, m] = monthStart.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + months
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`
}

export function monthEndOf(key: DateKey): DateKey {
  return addDays(addMonths(monthStartOf(key), 1), -1)
}

const monthFormat = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const dayMonthFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// «septiembre de 2026»
export function formatMonth(key: DateKey) {
  return monthFormat.format(new Date(toUtc(key)))
}

// «7 sept»
export function formatDayMonth(key: DateKey) {
  return dayMonthFormat.format(new Date(toUtc(key))).replace('.', '')
}

// «7–13 sept» o «28 sept – 4 oct»
export function formatWeekRange(weekStart: DateKey) {
  const end = addDays(weekStart, 6)
  if (weekStart.slice(0, 7) === end.slice(0, 7)) {
    return `${Number(weekStart.slice(8))}–${formatDayMonth(end)}`
  }
  return `${formatDayMonth(weekStart)} – ${formatDayMonth(end)}`
}
