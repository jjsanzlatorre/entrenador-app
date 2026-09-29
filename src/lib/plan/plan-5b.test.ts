import { describe, expect, it } from 'vitest'
import { buildPlanTemplates } from '../../../scripts/plan-templates'
import type { SessionLogEntry } from '@/lib/progress/types'
import { makeExercise } from '@/lib/workout/test-helpers'
import type { LastPerformance } from '@/lib/workout/types'
import type { PlannedSession } from './api'
import { overdueThisWeek, planAdherence, planSessionsPerWeek, weekView } from './calendar'
import { competitionText } from './describe'
import { moveWarnings } from './move-rules'
import { schedulePlan } from './schedule'
import { plannedToLocalSession } from './to-session'

function planned(id: string, date: string, patch: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id,
    planId: 'plan',
    date,
    originalDate: null,
    week: 1,
    sessionType: 'strength',
    title: id,
    intensity: 'moderate',
    heavyLegs: false,
    durationMin: 60,
    notes: null,
    blocks: [],
    status: 'planned',
    workoutSessionId: null,
    ...patch,
  }
}

function logEntry(id: string, startedAt: string, plannedSessionId: string | null = null) {
  return {
    id,
    sessionType: 'strength',
    startedAt,
    endedAt: startedAt,
    durationMin: 60,
    rpe: 7,
    distanceM: null,
    plannedSessionId,
  } satisfies SessionLogEntry
}

describe('reglas al mover una sesión (avisan, no bloquean)', () => {
  // Frontón los jueves (4) y surf los domingos (7).
  const fixed = [
    { type: 'padel_fronton' as const, days: [4] },
    { type: 'surf' as const, days: [7] },
    { type: 'yoga' as const, days: [2] },
  ]
  const legs = planned('legs', '2026-10-05', {
    heavyLegs: true,
    intensity: 'hard',
    title: 'Pierna',
  })

  it('pierna pesada el día antes de frontón o surf', () => {
    // Miércoles 7 oct → jueves de frontón.
    expect(moveWarnings(legs, '2026-10-07', [], fixed)).toEqual([
      'Pierna pesada el día antes de frontón (el jueves 8 oct).',
    ])
    // Sábado 10 oct → domingo de surf.
    expect(moveWarnings(legs, '2026-10-10', [], fixed)[0]).toContain('antes de surf')
    // Lunes 5 → martes de yoga: el yoga no carga las piernas.
    expect(moveWarnings(legs, '2026-10-05', [], fixed)).toEqual([])
  })

  it('pierna pesada el mismo día que frontón', () => {
    expect(moveWarnings(legs, '2026-10-08', [], fixed)).toEqual([
      'Pierna pesada el mismo día que frontón.',
    ])
  })

  it('dos intensas seguidas (antes o después), sin contar saltadas ni la propia', () => {
    const others = [
      legs,
      planned('run', '2026-10-06', { intensity: 'hard', title: 'Series' }),
      planned('easy', '2026-10-09', { intensity: 'easy', title: 'Rodaje' }),
      planned('skipped', '2026-10-01', { intensity: 'hard', status: 'skipped' }),
    ]
    expect(moveWarnings(legs, '2026-10-05', others, [])).toEqual([
      'Dos sesiones intensas seguidas: «Series» el martes 6 oct.',
    ])
    expect(moveWarnings(legs, '2026-10-02', others, [])).toEqual([])
    // Una suave no avisa.
    const easy = planned('e2', '2026-10-01', { intensity: 'easy' })
    expect(moveWarnings(easy, '2026-10-07', others, [])).toEqual([])
  })

  it('avisa si ese día ya hay otra sesión', () => {
    const others = [planned('x', '2026-10-09', { title: 'Natación' })]
    expect(moveWarnings(planned('y', '2026-10-05'), '2026-10-09', others, [])).toEqual([
      'Ese día ya tienes «Natación».',
    ])
  })
})

describe('adherencia al plan (aparte del compromiso)', () => {
  const sessions = [
    planned('a', '2026-10-05', { status: 'done' }),
    planned('b', '2026-10-06', { status: 'skipped' }),
    planned('c', '2026-10-07'), // hoy, sin hacer: aún no resta
    planned('d', '2026-10-08'), // pendiente de subir, hecha hoy
    planned('e', '2026-10-09'), // futura
    planned('f', '2026-10-01', { status: 'moved' }), // atrasada
  ]
  it('hechas / las que ya tocaban (incluidas las hechas por adelantado)', () => {
    const a = planAdherence(sessions, [logEntry('w', '2026-10-07T09:00:00', 'd')], '2026-10-07')
    expect(a).toEqual({ done: 2, due: 4, skipped: 1, total: 6, pct: 50 })
  })
  it('sin nada que tocara: sin porcentaje', () => {
    expect(planAdherence([planned('z', '2026-10-09')], [], '2026-10-07').pct).toBeNull()
  })
  it('sesiones por semana del plan', () => {
    expect(
      planSessionsPerWeek([
        planned('1', '2026-10-05'),
        planned('2', '2026-10-06'),
        planned('3', '2026-10-12', { week: 2 }),
      ]),
    ).toBe(2)
    expect(planSessionsPerWeek([])).toBe(0)
  })
})

describe('«Hoy»: pendientes de días anteriores de esta semana', () => {
  it('solo pendientes o movidas de antes de hoy', () => {
    const days = weekView(
      [
        planned('mon', '2026-10-05'),
        planned('tue', '2026-10-06', { status: 'skipped' }),
        planned('wed', '2026-10-07', { status: 'moved', originalDate: '2026-10-06' }),
        planned('thu', '2026-10-08'),
        planned('fri', '2026-10-09'),
        planned('logged', '2026-10-05'),
      ],
      [logEntry('w', '2026-10-05T10:00:00', 'logged')],
      '2026-10-05',
    )
    expect(overdueThisWeek(days, '2026-10-08').map((p) => p.id)).toEqual(['mon', 'wed'])
    expect(overdueThisWeek(days, '2026-10-05')).toEqual([])
  })
})

describe('sugerencia de peso al empezar una sesión del plan', () => {
  const squat = makeExercise({
    id: 'back_squat',
    muscles: [{ muscleId: 'quads', role: 'primary' }],
  })
  const bench = makeExercise({
    id: 'bench_press',
    muscles: [{ muscleId: 'chest', role: 'primary' }],
  })
  const catalog = new Map([
    ['back_squat', squat],
    ['bench_press', bench],
  ])
  const perf = (exerciseId: string, w: number, reps: number[]): LastPerformance => ({
    exerciseId,
    endedAt: '2026-10-01T10:00:00Z',
    sets: reps.map((r, i) => ({
      setIndex: i,
      isWarmup: false,
      weightKg: w,
      reps: r,
      rir: null,
      durationS: null,
      distanceM: null,
      calories: null,
    })),
  })

  it('precarga el peso sugerido con el rango prescrito y guarda el motivo', () => {
    const history = new Map([
      ['back_squat', [perf('back_squat', 100, [10, 10, 10])]],
      ['bench_press', [perf('bench_press', 60, [9, 8, 8])]],
    ])
    const last = new Map([...history].map(([id, h]) => [id, h[0]!]))
    let n = 0
    const s = plannedToLocalSession(
      {
        id: 'p',
        session_type: 'strength',
        title: 'Full body',
        blocks: [
          {
            block_type: 'straight',
            exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8-10', rest_s: 150 }],
          },
          {
            block_type: 'straight',
            exercises: [{ exercise_id: 'bench_press', sets: 3, reps: '8-10', rest_s: 120 }],
          },
        ],
      },
      'u',
      catalog,
      last,
      0,
      () => `id-${++n}`,
      history,
    )
    const [sq, bp] = s.blocks
    expect(sq!.sets.map((x) => x.weightKg)).toEqual([105, 105, 105])
    expect(sq!.exercises[0]!.suggestion?.reason).toBe(
      '+5 kg: completaste 3×10 con 100 kg la última vez',
    )
    expect(bp!.sets.map((x) => x.weightKg)).toEqual([60, 60, 60])
    expect(bp!.exercises[0]!.suggestion?.action).toBe('keep')
  })

  it('sin historial: peso de la última vez (o vacío)', () => {
    let n = 0
    const s = plannedToLocalSession(
      {
        id: 'p',
        session_type: 'strength',
        title: 'x',
        blocks: [
          { block_type: 'straight', exercises: [{ exercise_id: 'bench_press', reps: '8-10' }] },
        ],
      },
      'u',
      catalog,
      new Map(),
      0,
      () => `id-${++n}`,
    )
    expect(s.blocks[0]!.sets[0]!.weightKg).toBeNull()
    expect(s.blocks[0]!.exercises[0]!.suggestion).toBeUndefined()
  })
})

describe('competición por sexo', () => {
  const standard = { men: '152 kg (con el trineo)', women: '102 kg (con el trineo)' }
  it('hombre, mujer o los dos si no está definido', () => {
    expect(competitionText(standard, 'male')).toBe('Competición (hombre): 152 kg (con el trineo)')
    expect(competitionText(standard, 'female')).toBe('Competición (mujer): 102 kg (con el trineo)')
    expect(competitionText(standard, null)).toBe(
      'Competición: hombre 152 kg (con el trineo) · mujer 102 kg (con el trineo)',
    )
    expect(competitionText(standard, 'other')).toContain('hombre')
  })
})

describe('programador: heavy_legs viaja a las sesiones planificadas', () => {
  it('las sesiones de pierna pesada llevan heavy_legs', () => {
    const t = buildPlanTemplates().find((x) => x.id === 'hyrox_beginner')!
    const { sessions } = schedulePlan({
      structure: t.structure,
      startDate: '2026-10-05',
      preferredDays: [1, 3, 5, 6],
      fixedActivities: [],
    })
    expect(sessions.some((s) => s.heavy_legs)).toBe(true)
    // Semanas 1–3 (la de descarga no lleva pierna pesada).
    expect(
      sessions
        .filter((s) => s.title === 'Fuerza específica' && s.week < 4)
        .every((s) => s.heavy_legs),
    ).toBe(true)
  })
})
