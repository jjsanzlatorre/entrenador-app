// Fecha y hora de una sesión: selector «Hoy / Ayer / Anteayer / calendario» + hora, sin fechas
// futuras, y el cambio de fecha de una sesión (re-fechado) con todo lo que cuelga de ella.
import { addDays, localDateKey, type DateKey } from '@/lib/progress/dates'
import type { LocalSession } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

// Valor del selector: día local (YYYY-MM-DD) + hora local (HH:MM).
export type WhenValue = { date: DateKey; time: string }

export function whenFromInstant(value: string | number | Date): WhenValue {
  const d = value instanceof Date ? value : new Date(value)
  return { date: localDateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

// Instante (ms) de un día y una hora locales; null si la hora no es válida.
export function whenToMs(value: WhenValue): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.time.trim())
  const [y, mo, d] = value.date.split('-').map(Number)
  if (!m || !y || !mo || !d) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const date = new Date(y, mo - 1, d, h, min, 0, 0)
  // Fechas imposibles (31 de febrero) o la hora que no existe al cambiar al horario de verano.
  if (date.getDate() !== d || date.getHours() !== h) return null
  return date.getTime()
}

export const QUICK_DAYS = [
  { offset: 0, label: 'Hoy' },
  { offset: -1, label: 'Ayer' },
  { offset: -2, label: 'Anteayer' },
] as const

export function quickDay(today: DateKey, offset: number): DateKey {
  return addDays(today, offset)
}

// Problema del valor elegido (o null si vale). Margen de 1 min para el reloj del móvil.
export function whenProblem(value: WhenValue, now: number): string | null {
  const ms = whenToMs(value)
  if (ms === null) return 'Fecha u hora no válida'
  if (ms > now + 60_000) return 'No se pueden registrar entrenos en el futuro'
  return null
}

// Hora por defecto: la del momento actual, redondeada a 5 min hacia abajo.
export function defaultTime(now: number) {
  const d = new Date(now)
  return `${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 5) * 5)}`
}

// Al empezar un entreno con una fecha y hora: si es ahora (o hace poco, hoy) se registra en
// directo con esa hora de inicio; si es de antes, se abre el modo «entreno pasado» (sin
// temporizadores ni cuenta en vivo).
export const LIVE_BACKDATE_MS = 3 * 3600_000

export type StartKind = { kind: 'now' } | { kind: 'live' | 'past'; startedAt: number }

export function startKind(start: number, now: number): StartKind {
  const ago = now - start
  if (ago < 2 * 60_000) return { kind: 'now' }
  if (ago <= LIVE_BACKDATE_MS && localDateKey(start) === localDateKey(now))
    return { kind: 'live', startedAt: start }
  return { kind: 'past', startedAt: start }
}

// Texto bajo el selector al empezar: qué se va a abrir.
export function startHint(kind: StartKind, now: number) {
  if (kind.kind === 'now') return null
  if (kind.kind === 'live') {
    const min = Math.round((now - kind.startedAt) / 60_000)
    return `Empezó hace ${min} min: el tiempo cuenta desde entonces.`
  }
  return 'Se abre como «entreno pasado»: apuntas series, pesos y duración, sin temporizadores.'
}

// Fin de una sesión registrada a posteriori: inicio + duración, sin pasar de ahora.
export function endFor(startMs: number, durationMin: number | null, now: number) {
  const end = startMs + Math.max(0, durationMin ?? 0) * 60_000
  return Math.max(startMs, Math.min(end, now))
}

// Cambia la fecha y hora de inicio de una sesión. Se desplaza todo lo que lleva hora (fin y
// series completadas) la misma diferencia; en el modo «entreno pasado» el fin es inicio +
// duración y las series completadas quedan dentro de la sesión (para los récords y su fecha).
export function retimeSession(
  session: LocalSession,
  startedAt: string,
  durationMin: number | null,
  now: number,
): LocalSession {
  const oldStart = new Date(session.startedAt).getTime()
  const newStart = new Date(startedAt).getTime()
  const delta = newStart - oldStart
  const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + delta) : null)
  let endMs: number | null
  if (session.mode === 'past') endMs = endFor(newStart, durationMin, now)
  else if (session.endedAt)
    endMs = Math.min(shift(session.endedAt)!.getTime(), Math.max(now, newStart))
  else endMs = null
  const clamp = (ms: number) =>
    endMs === null ? ms : Math.min(Math.max(ms, newStart), Math.max(endMs, newStart))
  const blocks = session.blocks.map((b) => ({
    ...b,
    sets: b.sets.map((s) => {
      if (!s.completedAt) return s
      const moved =
        session.mode === 'past' && endMs !== null ? endMs : clamp(shift(s.completedAt)!.getTime())
      return { ...s, completedAt: new Date(moved).toISOString() }
    }),
  }))
  return {
    ...session,
    startedAt: new Date(newStart).toISOString(),
    endedAt: endMs === null ? null : new Date(endMs).toISOString(),
    blocks,
    rest: null,
    rev: Math.max(session.rev + 1, now),
  }
}

// «lunes 12 oct, 18:30» / «hoy, 18:30» / «ayer, 18:30».
export function formatWhen(ms: number, now: number) {
  const day = localDateKey(ms)
  const today = localDateKey(now)
  const time = new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (day === today) return `hoy, ${time}`
  if (day === addDays(today, -1)) return `ayer, ${time}`
  if (day === addDays(today, -2)) return `anteayer, ${time}`
  const date = new Date(ms).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
  return `${date.replace('.', '').replace(',', '')}, ${time}`
}
