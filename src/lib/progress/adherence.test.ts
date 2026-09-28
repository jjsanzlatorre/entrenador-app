import { describe, expect, it } from 'vitest'
import {
  activityDaysFromSessions,
  adherenceLevel,
  averagePct,
  commitmentForWeek,
  monthAdherence,
  streaks,
  weekAdherence,
  weekHistory,
  weekMessage,
} from './adherence'
import type { ActivityDay, Commitment } from './types'
import type { SessionType } from '@/types/database'

const base: Commitment = {
  validFrom: '2026-08-31',
  validTo: null,
  sessionsPerWeek: 3,
  minutesPerWeek: null,
  byType: null,
  countsFreeActivities: true,
}

const day = (d: string, sessionType: SessionType = 'strength', minutes: number | null = 60) =>
  ({ day: d, sessionType, minutes }) satisfies ActivityDay

// Semana del lunes 7 al domingo 13 de septiembre de 2026.
const W = '2026-09-07'

describe('weekAdherence', () => {
  it('2 de 3 es un 67 %', () => {
    const a = weekAdherence([base], [day('2026-09-07'), day('2026-09-09')], W)
    expect(a.counted).toBe(2)
    expect(a.committed).toBe(3)
    expect(Math.round((a.pct ?? 0) * 100)).toBe(67)
    expect(a.extra).toBe(0)
  })

  it('una sesión por día y tipo; menos de 15 min no cuenta', () => {
    const a = weekAdherence(
      [base],
      [
        day('2026-09-07'),
        day('2026-09-07'),
        day('2026-09-07', 'running'),
        day('2026-09-08', 'strength', 10),
      ],
      W,
    )
    expect(a.counted).toBe(2)
  })

  it('las actividades libres cuentan según el compromiso', () => {
    const days = [day('2026-09-07', 'surf'), day('2026-09-08', 'yoga'), day('2026-09-09')]
    expect(weekAdherence([base], days, W).counted).toBe(3)
    expect(weekAdherence([{ ...base, countsFreeActivities: false }], days, W).counted).toBe(1)
  })

  it('se puede superar el 100 %: la barra se llena y el resto es extra', () => {
    const days = ['07', '08', '09', '10'].map((d) => day(`2026-09-${d}`))
    const a = weekAdherence([base], days, W)
    expect(a.pct).toBe(1)
    expect(a.extra).toBe(1)
  })

  it('reparto por tipo: cada tipo llena sus huecos y el global es la media ponderada', () => {
    const c: Commitment = { ...base, byType: { strength: 2, swimming: 1 } }
    const a = weekAdherence(
      [c],
      [day('2026-09-07'), day('2026-09-08'), day('2026-09-09'), day('2026-09-10', 'running')],
      W,
    )
    expect(a.byType).toEqual([
      { sessionType: 'strength', committed: 2, done: 3 },
      { sessionType: 'swimming', committed: 1, done: 0 },
    ])
    expect(a.counted).toBe(2)
    expect(a.extra).toBe(2)
    expect(a.pct).toBeCloseTo(2 / 3)
  })

  it('reparto por tipo con huecos libres (4 por semana, 2 de fuerza + 1 de natación)', () => {
    const c: Commitment = { ...base, sessionsPerWeek: 4, byType: { strength: 2, swimming: 1 } }
    const a = weekAdherence(
      [c],
      [day('2026-09-07'), day('2026-09-08', 'swimming'), day('2026-09-09', 'running')],
      W,
    )
    expect(a.counted).toBe(3)
    expect(a.committed).toBe(4)
  })

  it('minutos: suma de las sesiones de la semana', () => {
    const c: Commitment = { ...base, minutesPerWeek: 150 }
    const a = weekAdherence(
      [c],
      [day('2026-09-07', 'strength', 60), day('2026-09-08', 'yoga', 10)],
      W,
    )
    expect(a.minutesDone).toBe(70)
    expect(a.minutesTarget).toBe(150)
  })

  it('sin compromiso no hay porcentaje', () => {
    expect(weekAdherence([base], [], '2026-08-24').pct).toBeNull()
  })
})

describe('historial de compromisos', () => {
  it('cada semana se mide con el compromiso vigente entonces', () => {
    const old: Commitment = { ...base, validTo: '2026-09-06' }
    const next: Commitment = { ...base, validFrom: '2026-09-07', sessionsPerWeek: 5 }
    expect(commitmentForWeek([old, next], '2026-08-31')?.sessionsPerWeek).toBe(3)
    expect(commitmentForWeek([old, next], W)?.sessionsPerWeek).toBe(5)
  })
})

describe('monthAdherence', () => {
  it('prorratea las semanas partidas por días', () => {
    // Septiembre 2026: empieza en martes. Compromiso desde el 31 de agosto: 30 días × 3/7.
    const m = monthAdherence([base], [day('2026-09-01'), day('2026-08-31')], '2026-09-01')
    expect(m.committed).toBeCloseTo(12.9, 1)
    expect(m.done).toBe(1)
  })

  it('los días anteriores al primer compromiso no cuentan', () => {
    const c: Commitment = { ...base, validFrom: '2026-09-28' }
    const m = monthAdherence([c], [day('2026-09-02'), day('2026-09-29')], '2026-09-01')
    expect(m.committed).toBeCloseTo(1.3, 1)
    expect(m.done).toBe(1)
  })
})

describe('rachas', () => {
  const full = (weekStart: string) =>
    [0, 1, 2].map((i) => {
      const d = new Date(`${weekStart}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      return day(d.toISOString().slice(0, 10))
    })

  it('cuenta semanas completas seguidas; la semana en curso no rompe la racha', () => {
    const days = [...full('2026-08-31'), ...full('2026-09-07'), ...full('2026-09-14')]
    expect(streaks([base], days, '2026-09-22')).toEqual({ current: 3, best: 3 })
  })

  it('una semana incompleta corta la racha, la mejor se conserva', () => {
    const days = [...full('2026-08-31'), ...full('2026-09-07'), ...full('2026-09-21')]
    expect(streaks([base], days, '2026-09-28')).toEqual({ current: 1, best: 2 })
  })

  it('la semana en curso suma si ya está completa', () => {
    expect(streaks([base], full('2026-08-31'), '2026-09-04')).toEqual({ current: 1, best: 1 })
  })
})

describe('historial y media', () => {
  it('12 semanas, la última es la actual', () => {
    const h = weekHistory([base], [], '2026-09-30')
    expect(h).toHaveLength(12)
    expect(h.at(-1)?.weekStart).toBe('2026-09-28')
    expect(h.filter((w) => w.pct !== null)).toHaveLength(5)
  })

  it('media de las semanas terminadas, cada una hasta 100 %', () => {
    const days = ['01', '02', '03', '04'].map((d) => day(`2026-09-${d}`))
    // Semana 31/08: 4 de 3 (cuenta 100 %). Semana 07/09: 0 %.
    expect(averagePct([base], days, '2026-09-16')).toBeCloseTo(0.5)
  })
})

describe('mensajes y colores', () => {
  const week = (days: ActivityDay[]) => weekAdherence([base], days, W)

  it('da ánimo según lo que falta', () => {
    expect(weekMessage(week([day('2026-09-07'), day('2026-09-08')]), '2026-09-10')).toBe(
      '2 de 3, ¡una más y semana completa!',
    )
    expect(weekMessage(week([day('2026-09-07')]), '2026-09-11')).toBe(
      'Te faltan 2 sesiones, quedan 3 días.',
    )
    expect(weekMessage(week([]), '2026-09-13')).toBe('Te faltan 3 sesiones, queda 1 día.')
    const four = ['07', '08', '09', '10'].map((d) => day(`2026-09-${d}`))
    expect(weekMessage(week(four), '2026-09-10')).toBe('¡Semana completa y +1 extra! 🔥')
  })

  it('niveles: < 50 %, 50–99 %, ≥ 100 %', () => {
    expect(adherenceLevel(0.34)).toBe('low')
    expect(adherenceLevel(0.67)).toBe('mid')
    expect(adherenceLevel(1)).toBe('done')
    expect(adherenceLevel(null)).toBe('low')
  })
})

describe('activityDaysFromSessions', () => {
  it('usa la duración guardada o la calcula con inicio y fin', () => {
    const days = activityDaysFromSessions([
      {
        id: '1',
        sessionType: 'running',
        startedAt: '2026-09-07T10:00:00',
        endedAt: '2026-09-07T10:40:00',
        durationMin: null,
        rpe: null,
        distanceM: null,
      },
    ])
    expect(days).toEqual([{ day: '2026-09-07', sessionType: 'running', minutes: 40 }])
  })
})
