// Datos de prueba del entrenador IA (solo tests).
import type { AiContextInput } from './context'
import type { AiPlan, DailyAdjust } from './schemas'

export function samplePlan(exerciseId = 'back_squat', overrides: Partial<AiPlan> = {}): AiPlan {
  const session = (n: number) => ({
    day_hint: n,
    session_type: 'strength' as const,
    title: `Full body ${n}`,
    intensity: 'moderate' as const,
    heavy_legs: n === 1,
    duration_min: 60,
    blocks: [
      {
        block_type: 'straight' as const,
        exercises: [{ exercise_id: exerciseId, sets: 3, reps: '8-10', rir: 2, rest_s: 150 }],
      },
      {
        block_type: 'straight' as const,
        exercises: [{ exercise_id: 'bench_press', sets: 3, reps: '8-10', rir: 2, rest_s: 120 }],
      },
    ],
  })
  return {
    name: 'Fuerza adaptada',
    summary: 'Tres días de full body con progresión suave.',
    progression_rules: 'Sube peso al completar el techo del rango.',
    weeks: [1, 2, 3, 4].map((week) => ({
      week,
      deload: week === 4,
      sessions: [session(1), session(2), session(3)],
    })),
    ...overrides,
  }
}

export function sampleReduce(exerciseId = 'goblet_squat'): DailyAdjust {
  return {
    decision: 'reduce',
    reason: 'Energía baja y muchas agujetas: hoy menos volumen.',
    session: {
      title: 'Full body suave',
      intensity: 'easy',
      heavy_legs: false,
      duration_min: 40,
      blocks: [
        {
          block_type: 'straight',
          exercises: [{ exercise_id: exerciseId, sets: 2, reps: '10', rir: 4, rest_s: 90 }],
        },
      ],
    },
  }
}

export function sampleContextInput(overrides: Partial<AiContextInput> = {}): AiContextInput {
  return {
    today: '2026-09-29',
    sex: 'female',
    birthYear: 1990,
    training: {
      goals: { selected: ['strength', 'health'], main: 'strength' },
      level: 'intermediate',
      availability: {
        days_per_week: 3,
        minutes_per_session: 60,
        preferred_days: [1, 3, 5],
        places: ['gym'],
      },
      equipment: ['barbell', 'dumbbell'],
      limitations: 'Molestia leve en la rodilla derecha',
      fixedActivities: [{ type: 'padel_fronton', days: [6], minutes: 60, label: null }],
      benchmarks: {
        squat_1rm_kg: 80,
        bench_1rm_kg: null,
        deadlift_1rm_kg: null,
        run_5k_s: null,
        swim_100m_s: null,
      },
    },
    commitment: {
      validFrom: '2026-09-01',
      validTo: null,
      sessionsPerWeek: 3,
      minutesPerWeek: null,
      byType: null,
      countsFreeActivities: true,
    },
    plan: null,
    sessions: [
      {
        id: 's1',
        date: '2026-08-20',
        sessionType: 'strength',
        title: 'Pierna',
        durationMin: 60,
        rpe: 7,
        distanceM: null,
      },
      {
        id: 's2',
        date: '2026-09-28',
        sessionType: 'strength',
        title: 'Pierna',
        durationMin: 60,
        rpe: 8,
        distanceM: null,
      },
      {
        id: 's3',
        date: '2026-09-27',
        sessionType: 'running',
        title: 'Rodaje',
        durationMin: 30,
        rpe: 5,
        distanceM: 5000,
      },
    ],
    setCounts: [{ sessionId: 's2', exerciseId: 'back_squat', sets: 4 }],
    exercises: [
      {
        id: 'back_squat',
        name: 'Sentadilla con barra',
        category: 'strength',
        equipment: ['barbell'],
        muscles: [
          { muscleId: 'quads', role: 'primary' },
          { muscleId: 'glutes', role: 'primary' },
          { muscleId: 'core', role: 'secondary' },
        ],
      },
      {
        id: 'bench_press',
        name: 'Press banca',
        category: 'strength',
        equipment: ['barbell', 'bench'],
        muscles: [{ muscleId: 'chest', role: 'primary' }],
      },
      {
        id: 'goblet_squat',
        name: 'Sentadilla goblet',
        category: 'strength',
        equipment: ['dumbbell'],
        muscles: [{ muscleId: 'quads', role: 'primary' }],
      },
    ],
    prs: [
      { exerciseId: 'back_squat', prType: 'est_1rm', value: 85.33, unit: 'kg', date: '2026-09-28' },
    ],
    checkins: [{ date: '2026-09-29', sleep: 3, energy: 1, soreness: 5, stress: 3 }],
    ...overrides,
  }
}
