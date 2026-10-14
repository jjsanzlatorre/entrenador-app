import { describe, expect, it } from 'vitest'
import type { PlannedStatus } from '@/types/database'
import {
  moveSession,
  moveStrip,
  moveStripStart,
  pauseOn,
  pausePlan,
  planEndAfter,
  planWeekForRange,
  repeatWeek,
  shiftPlan,
  swapSessions,
} from './reschedule'

// Lunes 12 oct 2026 … El plan: L/X/V de 4 semanas desde el lunes 5 oct.
const TODAY = '2026-10-14' // miércoles

function s(id: string, date: string, status: PlannedStatus = 'planned', week = 1) {
  return { id, date, status, title: `S ${id}`, week }
}

const plan = {
  startDate: '2026-10-05',
  sessions: [
    s('a', '2026-10-05', 'done', 1),
    s('b', '2026-10-07', 'skipped', 1),
    s('c', '2026-10-09', 'done', 1),
    s('d', '2026-10-12', 'done', 2),
    s('e', '2026-10-14', 'planned', 2),
    s('f', '2026-10-16', 'moved', 2),
    s('g', '2026-10-19', 'planned', 3),
    s('h', '2026-10-21', 'planned', 3),
    s('i', '2026-10-23', 'planned', 3),
  ],
}

describe('mover e intercambiar', () => {
  it('mueve una pendiente y no una hecha', () => {
    expect(moveSession(plan.sessions[4]!, '2026-10-15').moves).toEqual([
      { id: 'e', title: 'S e', from: '2026-10-14', to: '2026-10-15' },
    ])
    expect(moveSession(plan.sessions[0]!, '2026-10-15').error).toMatch(/pendientes/)
    expect(moveSession(plan.sessions[4]!, '2026-10-14').error).toBeTruthy()
  })

  it('intercambia dos pendientes de días distintos', () => {
    const c = swapSessions(plan.sessions[4]!, plan.sessions[6]!)
    expect(c.error).toBeNull()
    expect(c.moves.map((m) => [m.id, m.to])).toEqual([
      ['e', '2026-10-19'],
      ['g', '2026-10-14'],
    ])
    expect(swapSessions(plan.sessions[4]!, plan.sessions[3]!).error).toBeTruthy()
    expect(
      swapSessions(plan.sessions[4]!, { ...plan.sessions[6]!, date: '2026-10-14' }).error,
    ).toBeTruthy()
  })

  it('tira de 14 días: la semana de la sesión (o la actual si ya pasó) y la siguiente', () => {
    expect(moveStripStart('2026-10-23', TODAY)).toBe('2026-10-19')
    expect(moveStripStart('2026-10-12', TODAY)).toBe('2026-10-12')
    const strip = moveStrip('2026-10-12')
    expect(strip).toHaveLength(14)
    expect(strip[0]).toEqual({ date: '2026-10-12', weekday: 1 })
    expect(strip[13]).toEqual({ date: '2026-10-25', weekday: 7 })
  })
})

describe('desplazar el plan', () => {
  it('mueve solo las pendientes desde la fecha', () => {
    const c = shiftPlan(plan, '2026-10-16', 2, TODAY)
    expect(c.error).toBeNull()
    expect(c.moves.map((m) => `${m.id}:${m.to}`)).toEqual([
      'f:2026-10-18',
      'g:2026-10-21',
      'h:2026-10-23',
      'i:2026-10-25',
    ])
    expect(c.newStart).toBeNull()
    expect(c.params).toEqual({ from: '2026-10-16', days: 2 })
  })

  it('una semana después desde hoy', () => {
    const c = shiftPlan(plan, TODAY, 7, TODAY)
    expect(c.moves.map((m) => m.id)).toEqual(['e', 'f', 'g', 'h', 'i'])
    expect(planEndAfter(plan, c)).toBe('2026-10-30')
  })

  it('no deja nada en el pasado', () => {
    expect(shiftPlan(plan, TODAY, -1, TODAY).error).toMatch(/pasado/)
    expect(shiftPlan(plan, '2026-10-19', -2, TODAY).error).toBeNull()
  })

  it('un plan que aún no ha empezado mueve también su fecha de inicio', () => {
    const future = {
      startDate: '2026-10-19',
      sessions: [s('x', '2026-10-19'), s('y', '2026-10-21')],
    }
    expect(shiftPlan(future, TODAY, 7, TODAY).newStart).toBe('2026-10-26')
  })

  it('sin días o sin sesiones da error', () => {
    expect(shiftPlan(plan, TODAY, 0, TODAY).error).toBeTruthy()
    expect(shiftPlan(plan, '2026-12-01', 7, TODAY).error).toBeTruthy()
  })
})

describe('pausar el plan', () => {
  it('una semana: todo lo pendiente 7 días después, mismos días de la semana y orden', () => {
    const c = pausePlan(plan, TODAY, '2026-10-20', TODAY)
    expect(c.error).toBeNull()
    expect(c.params.days).toBe(7)
    expect(c.moves.map((m) => `${m.id}:${m.from}→${m.to}`)).toEqual([
      'e:2026-10-14→2026-10-21',
      'f:2026-10-16→2026-10-23',
      'g:2026-10-19→2026-10-26',
      'h:2026-10-21→2026-10-28',
      'i:2026-10-23→2026-10-30',
    ])
    for (const m of c.moves) expect(new Date(m.to).getUTCDay()).toBe(new Date(m.from).getUTCDay())
    // Ninguna sesión cae dentro de la pausa.
    expect(c.moves.every((m) => m.to > '2026-10-20')).toBe(true)
  })

  it('pausa de 10 días: semanas enteras (14 días)', () => {
    const c = pausePlan(plan, TODAY, '2026-10-23', TODAY)
    expect(c.params.days).toBe(14)
    expect(c.moves[0]).toMatchObject({ id: 'e', to: '2026-10-28' })
  })

  it('pausa que empieza más adelante: la primera sesión de la pausa marca el desplazamiento', () => {
    const c = pausePlan(plan, '2026-10-19', '2026-10-21', TODAY)
    expect(c.params.days).toBe(7)
    expect(c.moves.map((m) => m.id)).toEqual(['g', 'h', 'i'])
  })

  it('errores: antes de hoy, al revés o sin sesiones en la pausa', () => {
    expect(pausePlan(plan, '2026-10-13', '2026-10-20', TODAY).error).toBeTruthy()
    expect(pausePlan(plan, TODAY, '2026-10-13', TODAY).error).toBeTruthy()
    expect(pausePlan(plan, '2026-10-24', '2026-10-25', TODAY).error).toMatch(/no hace falta/)
  })

  it('días en pausa', () => {
    const pauses = [{ from: '2026-10-14', until: '2026-10-20' }]
    expect(pauseOn(pauses, '2026-10-14')).toBeTruthy()
    expect(pauseOn(pauses, '2026-10-20')).toBeTruthy()
    expect(pauseOn(pauses, '2026-10-21')).toBeNull()
  })
})

describe('repetir semana', () => {
  it('copia la semana (también lo hecho) y desplaza 7 días lo de después', () => {
    const c = repeatWeek(plan, TODAY, TODAY)
    expect(c.error).toBeNull()
    expect(c.copies.map((x) => `${x.sourceId}:${x.date}`)).toEqual([
      'd:2026-10-19',
      'e:2026-10-21',
      'f:2026-10-23',
    ])
    expect(c.moves.map((m) => `${m.id}:${m.to}`)).toEqual([
      'g:2026-10-26',
      'h:2026-10-28',
      'i:2026-10-30',
    ])
  })

  it('semana sin sesiones o ya pasada', () => {
    expect(repeatWeek(plan, '2026-11-02', TODAY).error).toBeTruthy()
    expect(repeatWeek(plan, '2026-09-28', TODAY).error).toBeTruthy()
  })
})

describe('semana del plan en el calendario', () => {
  it('sale de las sesiones de esa semana (con pausas el plan dura más de 4)', () => {
    expect(planWeekForRange(plan.sessions, '2026-10-12')).toBe(2)
    const moved = plan.sessions.map((x) => (x.week === 3 ? { ...x, date: '2026-11-04' } : x))
    expect(planWeekForRange(moved, '2026-11-02')).toBe(3)
    expect(planWeekForRange(plan.sessions, '2026-11-30')).toBeNull()
  })
})
