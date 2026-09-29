// Recordatorios diarios (fase 7B): cuándo toca avisar y qué decir. Lógica pura, con tests; la usa
// el servidor en /api/push/cron (lo llama pg_cron cada 15 min).
import { weekAdherence } from '@/lib/progress/adherence'
import { addDays, daysBetween, weekStartOf, type DateKey } from '@/lib/progress/dates'
import type { ActivityDay, Commitment } from '@/lib/progress/types'

// Pasada la hora elegida, se sigue intentando durante este margen (por si pg_cron se salta una
// ejecución). Después ya no se avisa ese día.
export const REMINDER_WINDOW_MIN = 120

export type LocalNow = { date: DateKey; minutes: number }

// Fecha y minuto del día en una zona horaria.
export function localNow(now: Date, tz: string): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

// Día (YYYY-MM-DD) de un instante en una zona horaria.
export function dateKeyInTz(value: string | Date, tz: string): DateKey {
  return localNow(typeof value === 'string' ? new Date(value) : value, tz).date
}

export function parseTime(value: string) {
  const [h, m] = value.split(':').map(Number) as [number, number]
  return h * 60 + m
}

export function isReminderDue(reminderTime: string, local: LocalNow) {
  const at = parseTime(reminderTime)
  return local.minutes >= at && local.minutes < at + REMINDER_WINDOW_MIN
}

export type BehindStatus = { remaining: number; daysLeft: number }

// ¿Va la semana por detrás del compromiso? Solo si hoy aún no ha entrenado y:
// - lo que falta ya no cabe con un día de margen (faltan ≥ días que quedan, hoy incluido), o
// - lleva menos de lo que tocaría a estas alturas (prorrateo por días ya pasados, redondeado abajo).
export function behindStatus(
  commitments: Commitment[],
  days: ActivityDay[],
  today: DateKey,
): BehindStatus | null {
  const weekStart = weekStartOf(today)
  const week = weekAdherence(commitments, days, weekStart)
  if (!week.commitment || week.pct === null || week.pct >= 1) return null
  if (days.some((d) => d.day === today)) return null
  const remaining = week.committed - week.counted
  const elapsed = daysBetween(weekStart, today)
  const daysLeft = 7 - elapsed
  const expected = Math.floor((week.committed * elapsed) / 7)
  if (remaining >= daysLeft || week.counted < expected) return { remaining, daysLeft }
  return null
}

export type DailyPush = { title: string; body: string; url: string }

// Un solo aviso al día que junta la sesión planificada y, si procede, el aviso suave.
export function composeDailyPush(opts: {
  planned: { title: string } | null
  behind: BehindStatus | null
}): DailyPush | null {
  const { planned, behind } = opts
  const behindText = behind
    ? `Te ${behind.remaining === 1 ? 'falta 1 sesión' : `faltan ${behind.remaining} sesiones`} esta semana y ${
        behind.daysLeft === 1 ? 'queda hoy' : `quedan ${behind.daysLeft} días`
      }.`
    : null
  if (planned) {
    return {
      title: `Hoy toca: ${planned.title}`,
      body: behindText ? `${behindText} ¡Vamos a por ella!` : 'Toca para empezar cuando quieras.',
      url: '/',
    }
  }
  if (behindText) {
    return {
      title: '¿Un entreno hoy?',
      body: `${behindText} Cualquier sesión de 15 min cuenta.`,
      url: '/',
    }
  }
  return null
}

export function dailyKey(date: DateKey) {
  return `daily:${date}`
}

// Rango de instantes que cubre la semana local (con un día de margen por las zonas horarias).
export function weekQueryRange(today: DateKey) {
  const start = weekStartOf(today)
  return { from: `${addDays(start, -1)}T00:00:00Z`, to: `${addDays(start, 8)}T00:00:00Z` }
}
