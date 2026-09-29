// Al mover una sesión a mano se comprueban las mismas reglas que usa el programador (§9):
// pierna pesada el día antes (o el mismo día) de frontón o surf y dos intensas seguidas.
// Solo avisa: la sesión se mueve igualmente.
import { addDays, formatDayMonth, isoWeekday, type DateKey } from '@/lib/progress/dates'
import type { PlannedSession } from './api'
import { WEEKDAY_LONG, type FixedActivity } from './profile'
import { LEG_LOADING } from './schedule'

const FIXED_NAME: Record<FixedActivity['type'], string> = {
  padel_fronton: 'frontón',
  surf: 'surf',
  yoga: 'yoga',
  other: 'actividad fija',
}

type Moving = Pick<PlannedSession, 'id' | 'intensity' | 'heavyLegs'>
type Other = Pick<PlannedSession, 'id' | 'date' | 'intensity' | 'status' | 'title'>

const day = (d: DateKey) => `el ${WEEKDAY_LONG[isoWeekday(d) - 1]} ${formatDayMonth(d)}`

export function moveWarnings(
  session: Moving,
  date: DateKey,
  others: Other[],
  fixed: Pick<FixedActivity, 'type' | 'days'>[],
): string[] {
  const warnings: string[] = []
  const legActivityOn = (d: DateKey) =>
    fixed.find((f) => LEG_LOADING.has(f.type) && f.days.includes(isoWeekday(d)))

  if (session.heavyLegs) {
    const next = legActivityOn(addDays(date, 1))
    if (next)
      warnings.push(
        `Pierna pesada el día antes de ${FIXED_NAME[next.type]} (${day(addDays(date, 1))}).`,
      )
    const same = legActivityOn(date)
    if (same) warnings.push(`Pierna pesada el mismo día que ${FIXED_NAME[same.type]}.`)
  }

  const active = others.filter((o) => o.id !== session.id && o.status !== 'skipped')
  if (session.intensity === 'hard') {
    for (const d of [addDays(date, -1), addDays(date, 1)]) {
      const hard = active.find((o) => o.date === d && o.intensity === 'hard')
      if (hard) warnings.push(`Dos sesiones intensas seguidas: «${hard.title}» ${day(d)}.`)
    }
  }
  const sameDay = active.find((o) => o.date === date && o.status !== 'done')
  if (sameDay) warnings.push(`Ese día ya tienes «${sameDay.title}».`)
  return warnings
}
