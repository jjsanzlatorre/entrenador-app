import { describe, expect, it } from 'vitest'
import { buildPlanTemplates } from '../../../scripts/plan-templates'
import type { SessionLogEntry } from '@/lib/progress/types'
import type { Exercise, LastPerformance } from '@/lib/workout/types'
import type { PlannedSession } from './api'
import { planWeekNumber, weekSummary, weekView } from './calendar'
import { describeBlock } from './describe'
import { emptyTrainingProfile, fromRow, parseMinSec, type TrainingProfileData } from './profile'
import { recommendTemplate } from './recommend'
import { assignmentCost, schedulePlan, startOptions } from './schedule'
import { lowerReps, plannedToLocalSession } from './to-session'
import type { PlanTemplate } from './types'

const templates = buildPlanTemplates()
const byId = (id: string) => templates.find((t) => t.id === id)!
const weekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
const START = '2026-10-05' // lunes

function profile(patch: Partial<TrainingProfileData> = {}): TrainingProfileData {
  return { ...emptyTrainingProfile(), ...patch }
}

describe('programador', () => {
  it('Híbrido en los días preferidos: 4 semanas, 16 sesiones', () => {
    const { sessions, warnings } = schedulePlan({
      structure: byId('hybrid_beginner').structure,
      startDate: START,
      preferredDays: [1, 3, 5, 6],
      fixedActivities: [],
    })
    expect(sessions).toHaveLength(16)
    expect(new Set(sessions.map((s) => weekday(s.date)))).toEqual(new Set([1, 3, 5, 6]))
    expect(sessions[0]!.date >= START).toBe(true)
    expect(sessions.at(-1)!.date <= '2026-11-01').toBe(true)
    expect([1, 2, 3, 4].map((w) => sessions.filter((s) => s.week === w).length)).toEqual([
      4, 4, 4, 4,
    ])
    // El orden de la plantilla se respeta dentro de la semana.
    expect(sessions.slice(0, 4).map((s) => s.title)).toEqual([
      'Full body A',
      'Rodaje suave',
      'EMOM 12 min',
      'Full body B',
    ])
    expect(warnings).toEqual([])
  })

  it('no pone pierna pesada el día antes de frontón o surf', () => {
    // Frontón el jueves: con días preferidos L, X, V, S la pierna pesada no puede ir el miércoles.
    const { sessions } = schedulePlan({
      structure: byId('strength_intermediate').structure,
      startDate: START,
      preferredDays: [1, 3, 5, 6],
      fixedActivities: [{ type: 'padel_fronton', days: [4] }],
    })
    const heavy = byId('strength_intermediate').structure.weeks[0]!.sessions.filter(
      (s) => s.heavy_legs,
    )
    for (const s of sessions.filter((x) => x.week < 4)) {
      if (heavy.some((h) => h.title === s.title)) {
        expect(weekday(s.date), s.title).not.toBe(3)
        expect(weekday(s.date), s.title).not.toBe(4)
      }
    }
    // Y no ocupa el día del frontón.
    expect(sessions.some((s) => weekday(s.date) === 4)).toBe(false)
  })

  it('surf el sábado: la pierna pesada no va el viernes', () => {
    const { sessions } = schedulePlan({
      structure: byId('hybrid_intermediate').structure,
      startDate: START,
      preferredDays: [1, 2, 3, 4, 5],
      fixedActivities: [{ type: 'surf', days: [6] }],
    })
    const week1 = sessions.filter((s) => s.week === 1)
    const friday = week1.find((s) => weekday(s.date) === 5)
    expect(friday && ['Fuerza A', 'Fuerza B'].includes(friday.title)).toBeFalsy()
  })

  it('evita dos sesiones intensas seguidas cuando hay hueco', () => {
    // Carrera intermedio: series y tempo son intensas.
    const { sessions } = schedulePlan({
      structure: byId('running_intermediate').structure,
      startDate: START,
      preferredDays: [1, 2, 4, 6],
      fixedActivities: [],
    })
    const week1 = sessions.filter((s) => s.week === 1)
    const hardDays = week1.filter((s) => s.intensity === 'hard').map((s) => weekday(s.date))
    expect(hardDays).toHaveLength(2)
    const [a, b] = hardDays as [number, number]
    expect(Math.abs(a - b)).not.toBe(1)
    expect(Math.abs(a - b)).not.toBe(6) // domingo → lunes
  })

  it('si no hay más remedio, avisa', () => {
    const { warnings } = schedulePlan({
      structure: byId('running_intermediate').structure,
      startDate: START,
      preferredDays: [1, 2],
      fixedActivities: [],
    })
    expect(warnings.some((w) => w.kind === 'more_sessions_than_days')).toBe(true)
  })

  it('coste: intensas seguidas y pierna antes de frontón penalizan', () => {
    const ctx = { preferred: new Set<number>(), fixed: new Set([4]), legFixed: new Set([4]) }
    const hard = { intensity: 'hard' as const, heavy_legs: false }
    const legs = { intensity: 'moderate' as const, heavy_legs: true }
    expect(assignmentCost([hard, hard], [1, 2], ctx)).toBeGreaterThan(
      assignmentCost([hard, hard], [1, 3], ctx),
    )
    expect(assignmentCost([legs], [3], ctx)).toBeGreaterThan(assignmentCost([legs], [5], ctx))
  })

  it('lunes para empezar', () => {
    expect(startOptions('2026-09-29')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
    expect(startOptions('2026-10-05', 2)).toEqual(['2026-10-05', '2026-10-12'])
    expect(startOptions('2026-10-04', 1)).toEqual(['2026-10-05'])
  })
})

describe('recomendación', () => {
  const summaries = templates.map((t: PlanTemplate) => t)

  it('familia por objetivo y nivel por experiencia', () => {
    const rec = (p: TrainingProfileData) => recommendTemplate(p, summaries)!.template.id
    expect(rec(profile())).toBe('hybrid_beginner')
    expect(rec(profile({ goals: { selected: ['strength'], main: 'strength' } }))).toBe(
      'strength_beginner',
    )
    expect(
      rec(
        profile({
          goals: { selected: ['running_event', 'strength'], main: 'running_event' },
          level: 'advanced',
        }),
      ),
    ).toBe('running_intermediate')
    expect(rec(profile({ goals: { selected: ['hyrox_deka'], main: 'hyrox_deka' } }))).toBe(
      'hyrox_beginner',
    )
    expect(rec(profile({ goals: { selected: ['fat_loss'], main: 'fat_loss' } }))).toBe(
      'hybrid_beginner',
    )
  })

  it('si no tiene días para el nivel, la variante con menos días', () => {
    const p = profile({
      goals: { selected: ['health'], main: 'health' },
      level: 'intermediate',
      availability: { ...emptyTrainingProfile().availability, days_per_week: 4 },
    })
    const r = recommendTemplate(p, summaries)!
    expect(r.template.id).toBe('hybrid_beginner')
    expect(r.reason).toContain('4 días')
  })
})

const catalog = new Map<string, Pick<Exercise, 'id' | 'defaultRestS' | 'trackingType'>>([
  ['back_squat', { id: 'back_squat', defaultRestS: 180, trackingType: 'weight_reps' }],
  ['bench_press', { id: 'bench_press', defaultRestS: 180, trackingType: 'weight_reps' }],
  ['barbell_row', { id: 'barbell_row', defaultRestS: 150, trackingType: 'weight_reps' }],
  ['plank', { id: 'plank', defaultRestS: 60, trackingType: 'time' }],
  ['run', { id: 'run', defaultRestS: 0, trackingType: 'distance_time' }],
  ['kettlebell_swing', { id: 'kettlebell_swing', defaultRestS: 90, trackingType: 'weight_reps' }],
])

let n = 0
const newId = () => `id-${++n}`

describe('sesión planificada → sesión local', () => {
  it('fuerza: series y reps del suelo del rango, peso de la última vez, enlazada', () => {
    const planned = byId('hybrid_beginner').structure.weeks[0]!.sessions[0]!
    const last = new Map<string, LastPerformance>([
      [
        'back_squat',
        {
          exerciseId: 'back_squat',
          endedAt: '2026-09-20T10:00:00Z',
          sets: [
            {
              setIndex: 0,
              isWarmup: true,
              weightKg: 40,
              reps: 10,
              rir: null,
              durationS: null,
              distanceM: null,
              calories: null,
            },
            {
              setIndex: 1,
              isWarmup: false,
              weightKg: 80,
              reps: 8,
              rir: 2,
              durationS: null,
              distanceM: null,
              calories: null,
            },
          ],
        },
      ],
    ])
    const s = plannedToLocalSession(
      { id: 'p1', session_type: 'strength', title: planned.title, blocks: planned.blocks },
      'u1',
      catalog,
      last,
      Date.parse('2026-10-05T10:00:00Z'),
      newId,
    )
    expect(s.plannedSessionId).toBe('p1')
    expect(s.title).toBe('Full body A')
    expect(s.sessionType).toBe('strength')
    expect(s.endedAt).toBeNull()
    const squat = s.blocks[0]!
    expect(squat.blockType).toBe('straight')
    expect(squat.exercises[0]).toEqual({ exerciseId: 'back_squat', restS: 150 })
    expect(squat.sets).toHaveLength(3)
    expect(squat.sets.every((x) => x.reps === 8 && x.weightKg === 80 && !x.completed)).toBe(true)
    // Sin «última vez», sin peso.
    expect(s.blocks[1]!.sets[0]!.weightKg).toBeNull()
    // Plancha: por tiempo.
    const plank = s.blocks.find((b) => b.exercises[0]!.exerciseId === 'plank')!
    expect(plank.sets[0]!.durationS).toBe(30)
  })

  it('series de carrera → bloque de intervalos; EMOM → bloque con temporizador', () => {
    const run = byId('running_beginner').structure.weeks[0]!.sessions[1]!
    const s = plannedToLocalSession(
      { id: 'p2', session_type: 'running', title: run.title, blocks: run.blocks },
      'u1',
      catalog,
      new Map(),
      0,
      newId,
    )
    expect(s.location).toBe('outdoor')
    expect(s.blocks[0]!.settings).toEqual({
      kind: 'intervals',
      reps: 6,
      workDistanceM: 400,
      workS: null,
      recoveryS: 90,
    })
    expect(s.blocks[0]!.sets).toHaveLength(6)

    const emom = byId('hybrid_beginner').structure.weeks[0]!.sessions[2]!
    const e = plannedToLocalSession(
      { id: 'p3', session_type: 'functional', title: emom.title, blocks: emom.blocks },
      'u1',
      catalog,
      new Map(),
      0,
      newId,
    )
    expect(e.blocks[0]!.settings).toEqual({ kind: 'emom', minutes: 12, intervalS: 60 })
    expect(e.blocks[0]!.sets).toHaveLength(12)
    expect(e.blocks[0]!.sets[0]!.reps).toBe(12)
  })

  it('circuito: rondas × ejercicios con la prescripción', () => {
    const c = byId('hyrox_beginner').structure.weeks[0]!.sessions[2]!
    const s = plannedToLocalSession(
      { id: 'p4', session_type: 'functional', title: c.title, blocks: c.blocks },
      'u1',
      catalog,
      new Map(),
      0,
      newId,
    )
    const block = s.blocks[0]!
    expect(block.blockType).toBe('circuit')
    expect(block.exercises.map((x) => x.exerciseId)).toEqual(['run', 'skierg', 'sled_push'])
    expect(block.sets).toHaveLength(3 * 3)
    expect(block.sets.filter((x) => x.exerciseId === 'run').every((x) => x.distanceM === 500)).toBe(
      true,
    )
  })

  it('lowerReps', () => {
    expect(lowerReps('8-10')).toBe(8)
    expect(lowerReps('12')).toBe(12)
    expect(lowerReps(undefined)).toBeNull()
  })
})

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

describe('calendario', () => {
  it('planificado frente a hecho, incluidas sesiones pendientes de subir y fuera del plan', () => {
    const days = weekView(
      [
        planned('a', '2026-10-05', { status: 'done', workoutSessionId: 'w1' }),
        planned('b', '2026-10-07'),
        planned('c', '2026-10-09', { status: 'skipped' }),
      ],
      [
        logEntry('w1', '2026-10-05T18:00:00'),
        // Hecha desde el plan pero aún sin subir: el servidor no la ha marcado.
        logEntry('w2', '2026-10-07T18:00:00', 'b'),
        logEntry('w3', '2026-10-10T10:00:00'),
      ],
      '2026-10-05',
      [{ type: 'padel_fronton', days: [4], minutes: 90 }],
    )
    expect(days).toHaveLength(7)
    expect(days[0]!.planned[0]!.effectiveStatus).toBe('done')
    expect(days[0]!.extra).toEqual([])
    expect(days[2]!.planned[0]).toMatchObject({ effectiveStatus: 'done', linkedSessionId: 'w2' })
    expect(days[2]!.extra).toEqual([])
    expect(days[3]!.fixed).toEqual([{ type: 'padel_fronton', minutes: 90 }])
    expect(days[5]!.extra.map((s) => s.id)).toEqual(['w3'])
    expect(weekSummary(days)).toEqual({ planned: 3, done: 2, skipped: 1, extra: 1 })
  })

  it('semana del plan', () => {
    expect(planWeekNumber('2026-10-05', '2026-10-05')).toBe(1)
    expect(planWeekNumber('2026-10-05', '2026-10-26')).toBe(4)
    expect(planWeekNumber('2026-10-05', '2026-11-02')).toBeNull()
    expect(planWeekNumber('2026-10-05', '2026-09-28')).toBeNull()
  })
})

describe('perfil de entrenamiento', () => {
  it('lee lo válido y descarta lo que no valida', () => {
    const p = fromRow({
      goals: { selected: ['strength', 'nope'], main: 'strength' },
      level: 'beginner',
      availability: { days_per_week: 4, preferred_days: [1, 3], places: ['gym'] },
      equipment: ['barbell'],
      limitations: null,
      fixed_activities: [
        { type: 'surf', days: [6] },
        { type: 'x', days: [] },
      ],
      benchmarks: 'basura',
    })
    // goals con un valor inválido: se usan los valores por defecto.
    expect(p.goals).toEqual({ selected: [], main: null })
    expect(p.availability).toEqual({
      days_per_week: 4,
      minutes_per_session: null,
      preferred_days: [1, 3],
      places: ['gym'],
    })
    expect(p.fixedActivities).toEqual([{ type: 'surf', days: [6], minutes: null, label: null }])
    expect(p.benchmarks.squat_1rm_kg).toBeNull()
  })

  it('tiempos de marcas en minutos', () => {
    expect(parseMinSec('25:30')).toBe(1530)
    expect(parseMinSec('28')).toBe(1680)
    expect(parseMinSec('2:75')).toBeNull()
    expect(parseMinSec('abc')).toBeNull()
  })
})

describe('textos', () => {
  it('describe bloques', () => {
    const name = (id: string) => ({ run: 'Carrera', back_squat: 'Sentadilla' })[id] ?? id
    expect(
      describeBlock(
        {
          block_type: 'intervals',
          exercises: [{ exercise_id: 'run', sets: 6, distance_m: 400, rest_s: 90 }],
        },
        name,
      ),
    ).toEqual({ title: 'Series', lines: ['Carrera · 6 × 400 m · rec. 1,5 min'] })
    expect(
      describeBlock(
        {
          block_type: 'straight',
          exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8-10', rir: 2, rest_s: 150 }],
        },
        name,
      ).lines,
    ).toEqual(['Sentadilla · 3 × 8-10 reps · RIR 2 · desc. 2,5 min'])
  })
})
