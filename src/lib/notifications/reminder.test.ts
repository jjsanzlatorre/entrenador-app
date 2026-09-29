import { describe, expect, it } from 'vitest'
import type { ActivityDay, Commitment } from '@/lib/progress/types'
import { behindStatus, composeDailyPush, dateKeyInTz, isReminderDue, localNow } from './reminder'

const c3: Commitment = {
  validFrom: '2026-01-05',
  validTo: null,
  sessionsPerWeek: 3,
  minutesPerWeek: null,
  byType: null,
  countsFreeActivities: true,
}
const day = (d: string): ActivityDay => ({ day: d, sessionType: 'strength', minutes: 60 })

describe('hora local', () => {
  it('convierte a la zona horaria del usuario (verano en Madrid = UTC+2)', () => {
    expect(localNow(new Date('2026-09-29T06:00:00Z'), 'Europe/Madrid')).toEqual({
      date: '2026-09-29',
      minutes: 8 * 60,
    })
    expect(dateKeyInTz('2026-09-28T23:30:00Z', 'Europe/Madrid')).toBe('2026-09-29')
    expect(dateKeyInTz('2026-09-28T23:30:00Z', 'UTC')).toBe('2026-09-28')
  })

  it('avisa desde la hora elegida y durante 2 h', () => {
    expect(isReminderDue('08:00', { date: 'x', minutes: 7 * 60 + 59 })).toBe(false)
    expect(isReminderDue('08:00', { date: 'x', minutes: 8 * 60 })).toBe(true)
    expect(isReminderDue('08:00', { date: 'x', minutes: 9 * 60 + 59 })).toBe(true)
    expect(isReminderDue('08:00', { date: 'x', minutes: 10 * 60 })).toBe(false)
    expect(isReminderDue('08:15:00', { date: 'x', minutes: 8 * 60 + 15 })).toBe(true)
  })
})

describe('semana por detrás del compromiso', () => {
  // 2026-09-28 es lunes.
  it('lunes y martes sin entrenar: aún no', () => {
    expect(behindStatus([c3], [], '2026-09-28')).toBeNull()
    expect(behindStatus([c3], [], '2026-09-29')).toBeNull()
  })
  it('jueves sin entrenar: sí (prorrateo)', () => {
    expect(behindStatus([c3], [], '2026-10-01')).toEqual({ remaining: 3, daysLeft: 4 })
  })
  it('domingo con 2 de 3: sí (solo queda hoy)', () => {
    const days = [day('2026-09-28'), day('2026-09-30')]
    expect(behindStatus([c3], days, '2026-10-04')).toEqual({ remaining: 1, daysLeft: 1 })
  })
  it('si ya ha entrenado hoy o ha cumplido, no', () => {
    expect(behindStatus([c3], [day('2026-10-01')], '2026-10-01')).toBeNull()
    const done = [day('2026-09-28'), day('2026-09-29'), day('2026-09-30')]
    expect(behindStatus([c3], done, '2026-10-02')).toBeNull()
  })
  it('sin compromiso, no', () => {
    expect(behindStatus([], [], '2026-10-03')).toBeNull()
  })
})

describe('mensaje diario', () => {
  it('junta la sesión de hoy y el aviso', () => {
    const msg = composeDailyPush({
      planned: { title: 'Full body A' },
      behind: { remaining: 2, daysLeft: 3 },
    })
    expect(msg?.title).toBe('Hoy toca: Full body A')
    expect(msg?.body).toContain('Te faltan 2 sesiones esta semana y quedan 3 días.')
  })
  it('solo aviso', () => {
    const msg = composeDailyPush({ planned: null, behind: { remaining: 1, daysLeft: 1 } })
    expect(msg?.body).toContain('Te falta 1 sesión esta semana y queda hoy.')
  })
  it('nada que decir = sin notificación', () => {
    expect(composeDailyPush({ planned: null, behind: null })).toBeNull()
  })
})
