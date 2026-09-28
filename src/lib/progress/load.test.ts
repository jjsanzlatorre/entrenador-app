import { describe, expect, it } from 'vitest'
import { acuteChronicRatio, loadBetween, sessionLoad, weeklyLoads } from './load'

const s = (day: string, rpe: number | null, durationMin: number) => ({
  startedAt: `${day}T10:00:00`,
  endedAt: `${day}T11:00:00`,
  rpe,
  durationMin,
})

// Cuatro semanas con la misma carga (300 por semana) hasta el domingo 2026-09-27.
const steady = [
  s('2026-08-31', 5, 60),
  s('2026-09-07', 5, 60),
  s('2026-09-14', 5, 60),
  s('2026-09-21', 5, 60),
]

describe('sRPE', () => {
  it('RPE × minutos; sin RPE no hay carga', () => {
    expect(sessionLoad(s('2026-09-28', 7, 50))).toBe(350)
    expect(sessionLoad(s('2026-09-28', null, 50))).toBeNull()
  })

  it('carga de un rango y sesiones sin RPE', () => {
    const r = loadBetween(
      [s('2026-09-28', 7, 50), s('2026-09-29', null, 40), s('2026-10-06', 5, 10)],
      '2026-09-28',
      '2026-10-04',
    )
    expect(r).toEqual({ load: 350, sessions: 2, missingRpe: 1 })
  })

  it('carga por semana (lunes a domingo)', () => {
    const weeks = weeklyLoads(steady, '2026-09-21', 4)
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ])
    expect(weeks.map((w) => w.load)).toEqual([300, 300, 300, 300])
  })
})

describe('ratio agudo:crónico', () => {
  it('carga estable → 1,0 y sin aviso', () => {
    const r = acuteChronicRatio(steady, '2026-09-27')
    expect(r.acute).toBe(300)
    expect(r.chronicWeekly).toBe(300)
    expect(r.ratio).toBe(1)
    expect(r.status).toBe('ok')
  })

  it('> 1,5 → aviso de sobrecarga', () => {
    const sessions = [...steady, s('2026-09-24', 8, 90), s('2026-09-26', 8, 90)]
    const r = acuteChronicRatio(sessions, '2026-09-27')
    // agudo = 300 + 1440 = 1740; crónico = (900 + 1740) / 4 = 660 → 2,64
    expect(r.acute).toBe(1740)
    expect(r.chronicWeekly).toBe(660)
    expect(r.ratio).toBeCloseTo(2.636, 2)
    expect(r.status).toBe('high')
  })

  it('justo 1,5 no avisa', () => {
    // agudo 600, crónico (300×3 + 600)/4 = 375 → 1,6; ajustamos para 1,5 exacto:
    // agudo a, crónico (900 + a)/4 → a / ((900 + a)/4) = 1,5 → a = 540.
    const sessions = [...steady.slice(0, 3), s('2026-09-21', 6, 90)]
    const r = acuteChronicRatio(sessions, '2026-09-27')
    expect(r.ratio).toBeCloseTo(1.5, 5)
    expect(r.status).toBe('ok')
  })

  it('< 0,8 solo avisa si hay plan activo', () => {
    const sessions = [...steady.slice(0, 3), s('2026-09-21', 2, 30)]
    const noPlan = acuteChronicRatio(sessions, '2026-09-27')
    expect(noPlan.ratio!).toBeLessThan(0.8)
    expect(noPlan.status).toBe('ok')
    expect(acuteChronicRatio(sessions, '2026-09-27', { hasActivePlan: true }).status).toBe('low')
  })

  it('con menos de 4 semanas de datos: datos insuficientes', () => {
    const recent = [s('2026-09-10', 5, 60), s('2026-09-21', 9, 120)]
    const r = acuteChronicRatio(recent, '2026-09-27')
    expect(r.ratio).toBeNull()
    expect(r.status).toBe('insufficient')
    expect(acuteChronicRatio([], '2026-09-27').status).toBe('insufficient')
  })

  it('la primera sesión hace exactamente 28 días ya cuenta como 4 semanas', () => {
    expect(acuteChronicRatio(steady, '2026-09-27').status).toBe('ok')
    expect(acuteChronicRatio(steady.slice(1), '2026-09-27').status).toBe('insufficient')
  })

  it('sin carga crónica (todo sin RPE) → datos insuficientes y cuenta las sesiones sin RPE', () => {
    const sessions = [s('2026-08-20', 5, 60), s('2026-09-21', null, 60)]
    const r = acuteChronicRatio(sessions, '2026-09-27')
    expect(r.status).toBe('insufficient')
    expect(r.missingRpe).toBe(1)
  })
})
