// Tarjetas para compartir (fase 7B) a partir de los datos de la app. Lógica pura, con tests.
// Solo texto que ya se ve en pantalla: logros, cumplimiento de la semana y récords.
import type { WeekAdherence } from '@/lib/progress/adherence'
import { formatWeekRange } from '@/lib/progress/dates'
import {
  formatPrevious,
  formatRecordValue,
  PR_LABELS,
  type PersonalRecord,
} from '@/lib/progress/records'
import type { ShareCard } from './card'

const PERIOD_LABEL = { week: 'esta semana', month: 'este mes', year: 'este año', total: 'en total' }

export function achievementCard(opts: {
  period: keyof typeof PERIOD_LABEL
  title: string
  emoji: string
  value: string
  phrase: string | null
}): ShareCard {
  return {
    kind: 'achievement',
    emoji: opts.emoji,
    eyebrow: `Mis logros · ${PERIOD_LABEL[opts.period]}`,
    headline: opts.phrase ?? opts.title,
    value: opts.value,
  }
}

// Emoji inicial de un título como «🏊 Natación».
export function leadingEmoji(title: string, fallback = '🏅') {
  const first = [...title.trim()][0]
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : fallback
}

export function weekCard(week: WeekAdherence, streakWeeks: number): ShareCard {
  const done = week.counted + week.extra
  return {
    kind: 'week',
    emoji: week.extra > 0 ? '🔥' : '✅',
    eyebrow: `Semana del ${formatWeekRange(week.weekStart)}`,
    headline: '¡Semana completada!',
    value: `${done} de ${week.committed} ${week.committed === 1 ? 'sesión' : 'sesiones'}`,
    detail:
      streakWeeks > 1
        ? `Racha de ${streakWeeks} semanas seguidas`
        : week.extra > 0
          ? `Y ${week.extra} extra`
          : undefined,
  }
}

export function recordCard(record: PersonalRecord, exerciseName: string): ShareCard {
  const previous = formatPrevious(record)
  return {
    kind: 'record',
    emoji: '🏆',
    eyebrow: 'Nuevo récord',
    headline: exerciseName,
    value: formatRecordValue(record),
    detail: previous ? `${PR_LABELS[record.prType]} · ${previous}` : PR_LABELS[record.prType],
  }
}
