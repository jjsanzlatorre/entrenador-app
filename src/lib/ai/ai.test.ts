// Esquemas, validación de exercise_id y context builder del entrenador IA.
import { describe, expect, it } from 'vitest'
import { toProviderJsonSchema } from '@/server/ai/json-schema'
import { buildAiContext, summarizeContext } from './context'
import { aiPlanSchema, dailyAdjustSchema, toPlanStructure, type AiPlan } from './schemas'
import { sampleContextInput, samplePlan, sampleReduce } from './test-fixtures'
import {
  adjustIssues,
  attachStandards,
  dropUnknownFromAdjust,
  dropUnknownFromPlan,
  planIssues,
} from './validate'

const KNOWN = new Set(['back_squat', 'bench_press', 'goblet_squat'])

describe('aiPlanSchema', () => {
  it('acepta un plan de 4 semanas con la 4.ª de descarga', () => {
    expect(aiPlanSchema.safeParse(samplePlan()).success).toBe(true)
  })

  it('rechaza que la semana 4 no sea de descarga', () => {
    const plan = samplePlan()
    plan.weeks[3]!.deload = false
    const r = aiPlanSchema.safeParse(plan)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('descarga')
  })

  it('rechaza un número de semanas distinto de 4 o desordenadas', () => {
    expect(
      aiPlanSchema.safeParse({ ...samplePlan(), weeks: samplePlan().weeks.slice(0, 3) }).success,
    ).toBe(false)
    const plan = samplePlan()
    plan.weeks[0]!.week = 2
    expect(aiPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('valida el formato de las reps y los tipos', () => {
    const plan = samplePlan() as unknown as {
      weeks: { sessions: { blocks: { exercises: { reps: string }[] }[] }[] }[]
    }
    plan.weeks[0]!.sessions[0]!.blocks[0]!.exercises[0]!.reps = 'muchas'
    expect(aiPlanSchema.safeParse(plan).success).toBe(false)
    expect(aiPlanSchema.safeParse({ ...samplePlan(), name: 3 }).success).toBe(false)
  })

  it('se convierte al formato de las plantillas', () => {
    const structure = toPlanStructure(samplePlan())
    expect(structure.weeks).toHaveLength(4)
    expect(structure.weeks[0]!.sessions[0]!.blocks[0]!.exercises[0]!.exercise_id).toBe('back_squat')
  })
})

describe('dailyAdjustSchema', () => {
  it('acepta keep y rest sin sesión y reduce con sesión', () => {
    expect(dailyAdjustSchema.safeParse({ decision: 'keep', reason: 'Todo bien.' }).success).toBe(
      true,
    )
    expect(dailyAdjustSchema.safeParse({ decision: 'rest', reason: 'Descansa.' }).success).toBe(
      true,
    )
    expect(dailyAdjustSchema.safeParse(sampleReduce()).success).toBe(true)
  })

  it('exige la sesión con reduce o change', () => {
    expect(dailyAdjustSchema.safeParse({ decision: 'reduce', reason: 'x' }).success).toBe(false)
    expect(dailyAdjustSchema.safeParse({ decision: 'change', reason: 'x' }).success).toBe(false)
  })

  it('rechaza decisiones desconocidas y motivos vacíos o muy largos', () => {
    expect(dailyAdjustSchema.safeParse({ decision: 'maybe', reason: 'x' }).success).toBe(false)
    expect(dailyAdjustSchema.safeParse({ decision: 'keep', reason: '' }).success).toBe(false)
    expect(dailyAdjustSchema.safeParse({ decision: 'keep', reason: 'x'.repeat(301) }).success).toBe(
      false,
    )
  })
})

describe('JSON Schema para el proveedor', () => {
  it('solo usa el subconjunto común y cierra los objetos', () => {
    const schema = toProviderJsonSchema(aiPlanSchema)
    const text = JSON.stringify(schema)
    for (const banned of [
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'pattern',
      '$schema',
      'anyOf',
      'default',
    ]) {
      expect(text).not.toContain(`"${banned}"`)
    }
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'summary', 'weeks']))
    const props = schema.properties as Record<string, { items?: Record<string, unknown> }>
    expect(props.weeks!.items!.additionalProperties).toBe(false)
  })

  it('los campos opcionales no son obligatorios', () => {
    const schema = toProviderJsonSchema(dailyAdjustSchema)
    expect(schema.required).toEqual(['decision', 'reason'])
    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(props.decision!.enum).toEqual(['keep', 'reduce', 'change', 'rest'])
  })
})

describe('validación de exercise_id', () => {
  it('detecta ids inventados en el plan y en el ajuste', () => {
    expect(planIssues(samplePlan(), KNOWN)).toEqual([])
    const issues = planIssues(samplePlan('sentadilla_magica'), KNOWN)
    expect(issues[0]).toContain('sentadilla_magica')
    expect(adjustIssues(sampleReduce('inventado'), KNOWN)[0]).toContain('inventado')
    expect(adjustIssues({ decision: 'keep', reason: 'ok' }, KNOWN)).toEqual([])
  })

  it('limita las sesiones por semana', () => {
    expect(planIssues(samplePlan(), KNOWN, 2)[0]).toContain('máximo son 2')
  })

  it('descarta los ejercicios inventados y los bloques vacíos', () => {
    const fixed = dropUnknownFromPlan(samplePlan('inventado'), KNOWN)!
    expect(fixed.dropped).toEqual(['inventado'])
    const blocks = fixed.plan.weeks[0]!.sessions[0]!.blocks
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.exercises[0]!.exercise_id).toBe('bench_press')
    expect(planIssues(fixed.plan, KNOWN)).toEqual([])
  })

  it('no repara si una semana se queda sin sesiones', () => {
    const plan: AiPlan = samplePlan('x')
    for (const w of plan.weeks) for (const s of w.sessions) s.blocks = s.blocks.slice(0, 1)
    expect(dropUnknownFromPlan(plan, KNOWN)).toBeNull()
    expect(dropUnknownFromAdjust(sampleReduce('x'), KNOWN)).toBeNull()
  })

  it('recupera los estándares de competición de la plantilla base', () => {
    const structure = toPlanStructure(samplePlan())
    const base = toPlanStructure(samplePlan())
    base.weeks[0]!.sessions[0]!.blocks[0]!.exercises[0]!.standard = {
      men: '100 kg',
      women: '70 kg',
    }
    const out = attachStandards(structure, base)
    expect(out.weeks[2]!.sessions[1]!.blocks[0]!.exercises[0]!.standard).toEqual({
      men: '100 kg',
      women: '70 kg',
    })
  })
})

describe('context builder', () => {
  const input = sampleContextInput()

  it('no incluye datos personales ni medidas', () => {
    const text = JSON.stringify(buildAiContext(input, { includeExercises: true }))
    for (const banned of ['email', 'display_name', 'weight_kg', 'waist', 'photo', 'height']) {
      expect(text).not.toContain(banned)
    }
    const ctx = buildAiContext(input)
    expect(ctx.athlete).toMatchObject({ sex: 'female', age: 36, level: 'intermediate' })
    expect(ctx.athlete).toMatchObject({ limitations: 'Molestia leve en la rodilla derecha' })
  })

  it('resume perfil, compromiso, carga, ACWR, volumen, PRs y check-ins', () => {
    const ctx = buildAiContext(input) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ctx.weekday).toBe('martes')
    expect(ctx.athlete.preferred_days).toBe('LXV')
    expect(ctx.athlete.fixed_activities).toEqual([{ type: 'fronton', days: 'S', minutes: 60 }])
    expect(ctx.athlete.benchmarks).toEqual({ squat_1rm_kg: 80 })
    expect(ctx.commitment).toEqual({ sessions_per_week: 3 })
    // Carga aguda: 60×8 + 30×5 = 630; crónica (28 días) = 630 / 4.
    expect(ctx.recent.acwr).toMatchObject({ acute_7d: 630, chronic_weekly: 158, status: 'high' })
    expect(ctx.recent.acwr.ratio).toBe(4)
    expect(ctx.recent.weeks).toHaveLength(4)
    expect(ctx.recent.weeks.at(-1)).toMatchObject({
      week_start: '2026-09-28',
      sessions: 1,
      load: 480,
    })
    // 4 series de sentadilla (1 quads, 1 glúteo, 0,5 core) + carrera 30 min (aprox.).
    expect(ctx.recent.muscle_sets_7d.quads).toBe(6)
    expect(ctx.recent.muscle_sets_7d.core).toBe(2)
    expect(ctx.recent.neglected_muscles_14d).toContain('chest')
    expect(ctx.recent.sessions_last_14d).toEqual([
      { date: '2026-09-27', type: 'running', title: 'Rodaje', min: 30, rpe: 5, km: 5 },
      { date: '2026-09-28', type: 'strength', title: 'Pierna', min: 60, rpe: 8 },
    ])
    expect(ctx.recent_prs).toEqual([
      {
        exercise: 'Sentadilla con barra',
        type: 'est_1rm',
        value: 85.3,
        unit: 'kg',
        date: '2026-09-28',
      },
    ])
    expect(ctx.today_checkin).toMatchObject({ energy: 1, soreness: 5 })
  })

  it('con poco historial el ACWR es «insuficiente» y no hay descuidados', () => {
    const ctx = buildAiContext(
      sampleContextInput({ sessions: input.sessions.filter((s) => s.id !== 's1') }),
    ) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ctx.recent.acwr.status).toBe('insufficient')
    expect(ctx.recent.acwr.ratio).toBeNull()
    expect(ctx.recent.neglected_muscles_14d).toEqual([])
  })

  it('la lista de ejercicios y la plantilla solo van cuando se piden', () => {
    expect(buildAiContext(input)).not.toHaveProperty('exercises')
    const ctx = buildAiContext(input, {
      includeExercises: true,
      baseTemplate: {
        id: 'strength_beginner',
        name: 'Fuerza',
        structure: toPlanStructure(samplePlan()),
      },
    })
    expect(ctx.exercises).toMatchObject({
      list: expect.arrayContaining([
        'back_squat | Sentadilla con barra | strength | barbell | quads,glutes',
      ]),
    })
    const summary = summarizeContext(ctx)
    expect(summary).not.toHaveProperty('exercises')
    expect(summary.base_template).toBe('strength_beginner')
  })

  it('resume el plan activo con la semana y la adherencia', () => {
    const planned = (date: string, status: 'planned' | 'done' | 'skipped') => ({
      id: date,
      date,
      week: 1,
      sessionType: 'strength' as const,
      title: 'Full body',
      intensity: 'moderate' as const,
      heavyLegs: false,
      durationMin: 60,
      notes: null,
      status,
      blocks: [],
    })
    const ctx = buildAiContext(
      sampleContextInput({
        plan: {
          name: 'Fuerza',
          startDate: '2026-09-21',
          sessions: [
            planned('2026-09-22', 'done'),
            planned('2026-09-24', 'skipped'),
            planned('2026-09-29', 'planned'),
            planned('2026-10-01', 'planned'),
          ],
        },
      }),
      { todaySession: planned('2026-09-29', 'planned') },
    ) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ctx.plan.week_of_plan).toBe(2)
    expect(ctx.plan.this_week.map((s: { date: string }) => s.date)).toEqual([
      '2026-09-29',
      '2026-10-01',
    ])
    expect(ctx.plan.adherence).toEqual({ done: 1, due: 2 })
    expect(ctx.today_session).toMatchObject({ date: '2026-09-29', title: 'Full body' })
  })
})
