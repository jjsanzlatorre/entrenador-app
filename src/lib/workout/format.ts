const kgFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
const intFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export function formatKg(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : kgFormat.format(value)
}

export function formatInt(value: number) {
  return intFormat.format(value)
}

// Acepta coma decimal («62,5»). Devuelve null si está vacío o no es un número válido.
export function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (normalized === '') return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function parseInteger(input: string): number | null {
  const value = parseDecimal(input)
  return value === null ? null : Math.round(value)
}

// mm:ss o h:mm:ss
export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

// «1:30» o «90» → segundos.
export function parseClock(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (!trimmed.includes(':')) return parseInteger(trimmed)
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

export function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
