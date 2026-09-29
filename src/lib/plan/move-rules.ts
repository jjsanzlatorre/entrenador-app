// Al mover una sesión a mano se comprueban las mismas reglas que usa el programador (§9):
// pierna pesada el día antes (o el mismo día) de frontón, pádel, tenis o surf y dos intensas
// seguidas (una clase fija de GAP cuenta como intensa de pierna y core).
// Solo avisa: la sesión se mueve igualmente.
import { addDays, formatDayMonth, isoWeekday, type DateKey } from '@/lib/progress/dates'
import type { PlannedSession } from './api'
import { WEEKDAY_LONG, type FixedActivity } from './profile'
import { activityLabel, getActivityType } from '@/lib/activities/catalog'
import { isHardFixed, isLegLoading } from './schedule'

// «frontón», «pádel», «GAP»; las personalizadas, con su nombre tal cual.
function fixedName(type: FixedActivity['type']) {
  if (type === 'other') return 'actividad fija'
  const name = activityLabel(type)
  if (getActivityType(type)?.ownerId || name === name.toUpperCase()) return name
  return name.toLowerCase()
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
    fixed.find((f) => isLegLoading(f.type) && f.days.includes(isoWeekday(d)))
  const hardActivityOn = (d: DateKey) =>
    fixed.find((f) => isHardFixed(f.type) && f.days.includes(isoWeekday(d)))

  if (session.heavyLegs) {
    const next = legActivityOn(addDays(date, 1))
    if (next)
      warnings.push(
        `Pierna pesada el día antes de ${fixedName(next.type)} (${day(addDays(date, 1))}).`,
      )
    const same = legActivityOn(date)
    if (same) warnings.push(`Pierna pesada el mismo día que ${fixedName(same.type)}.`)
  }

  if (session.intensity === 'hard' || session.heavyLegs) {
    for (const d of [addDays(date, -1), addDays(date, 1)]) {
      const hard = hardActivityOn(d)
      if (hard) warnings.push(`Dos sesiones intensas seguidas: ${fixedName(hard.type)} ${day(d)}.`)
    }
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
