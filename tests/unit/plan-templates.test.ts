import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlanTemplates } from '../../scripts/plan-templates'
import { PLAN_TEMPLATES_JSON, planTemplatesJson } from '../../scripts/seed-sql'
import { DEKA_ZONES, HYROX_STATIONS } from '../../src/lib/plan/competition'
import { planStructureSchema } from '../../src/lib/plan/schema'
import type { PlanSession } from '../../src/lib/plan/types'

const root = join(import.meta.dirname, '../..')
const exercises = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/exercises.json'), 'utf8')) as {
    exercises: { id: string; primary: string[] }[]
  }
).exercises
const exerciseIds = new Set(exercises.map((e) => e.id))
const templates = buildPlanTemplates()

// Volumen aproximado de una sesión: series de fuerza + metros o minutos de cardio.
function volume(s: PlanSession) {
  return s.blocks
    .flatMap((b) =>
      b.exercises.map((e) => {
        const reps = b.block_type === 'circuit' ? (b.rounds ?? 1) : (e.sets ?? 1)
        const unit = e.distance_m ?? (e.duration_s ? e.duration_s / 6 : 100)
        return b.block_type === 'emom' || b.block_type === 'amrap'
          ? (b.minutes ?? 1) * 100
          : reps * unit
      }),
    )
    .reduce((a, b) => a + b, 0)
}

describe('plantillas de planes', () => {
  it('6 familias × 2 niveles', () => {
    expect(templates).toHaveLength(12)
    const keys = new Set(templates.map((t) => `${t.family}/${t.level}`))
    for (const family of ['running', 'swimming', 'strength', 'hyrox', 'deka', 'hybrid']) {
      expect(keys.has(`${family}/beginner`), family).toBe(true)
      expect(keys.has(`${family}/intermediate`), family).toBe(true)
    }
    expect(new Set(templates.map((t) => t.id)).size).toBe(12)
  })

  it('formato válido, 4 semanas y la 4.ª de descarga', () => {
    for (const t of templates) {
      expect(planStructureSchema.safeParse(t.structure).success, t.id).toBe(true)
      expect(
        t.structure.weeks.map((w) => w.week),
        t.id,
      ).toEqual([1, 2, 3, 4])
      expect(
        t.structure.weeks.map((w) => w.deload),
        t.id,
      ).toEqual([false, false, false, true])
      for (const w of t.structure.weeks) {
        expect(w.sessions, `${t.id} semana ${w.week}`).toHaveLength(t.days_per_week)
        expect(w.sessions.map((s) => s.day_hint)).toEqual(
          Array.from({ length: t.days_per_week }, (_, i) => i + 1),
        )
      }
      // Descarga: menos volumen que la semana 3 (≈ −40 %) y sin sesiones «duras».
      const [, , w3, w4] = t.structure.weeks
      const v3 = w3!.sessions.reduce((a, s) => a + volume(s), 0)
      const v4 = w4!.sessions.reduce((a, s) => a + volume(s), 0)
      expect(v4 / v3, t.id).toBeLessThan(0.75)
      expect(v4 / v3, t.id).toBeGreaterThan(0.4)
      expect(
        w4!.sessions.every((s) => s.intensity !== 'hard' && !s.heavy_legs),
        t.id,
      ).toBe(true)
    }
  })

  it('días por semana según §9', () => {
    const days = Object.fromEntries(templates.map((t) => [t.id, t.days_per_week]))
    expect(days).toMatchObject({
      running_beginner: 3,
      running_intermediate: 4,
      swimming_beginner: 3,
      swimming_intermediate: 3,
      strength_beginner: 3,
      strength_intermediate: 4,
      hyrox_beginner: 4,
      hyrox_intermediate: 4,
      deka_beginner: 4,
      deka_intermediate: 4,
      hybrid_beginner: 4,
      hybrid_intermediate: 5,
    })
  })

  it('solo usa exercise_id de la biblioteca semilla', () => {
    for (const t of templates) {
      for (const w of t.structure.weeks) {
        for (const s of w.sessions) {
          for (const b of s.blocks) {
            for (const e of b.exercises) {
              expect(exerciseIds.has(e.exercise_id), `${t.id}: ${e.exercise_id}`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('las estaciones de HYROX y las zonas de DEKA existen en la biblioteca y tienen músculos', () => {
    for (const id of [...HYROX_STATIONS, ...DEKA_ZONES].map((s) => s.exercise_id)) {
      const exercise = exercises.find((e) => e.id === id)
      expect(exercise, id).toBeDefined()
      expect(exercise!.primary.length, id).toBeGreaterThan(0)
    }
    expect(HYROX_STATIONS).toHaveLength(8)
    expect(DEKA_ZONES).toHaveLength(10)
  })

  it('carrera: la tirada larga sube ≈10 % por semana', () => {
    const t = templates.find((x) => x.id === 'running_intermediate')!
    const long = t.structure.weeks.map(
      (w) => w.sessions.find((s) => s.title === 'Tirada larga')!.duration_min,
    )
    expect(long[1]! / long[0]!).toBeCloseTo(1.1, 1)
    expect(long[2]! / long[1]!).toBeCloseTo(1.1, 1)
  })

  it('el JSON de semilla está sincronizado (npm run seed:sql)', () => {
    expect(readFileSync(join(root, PLAN_TEMPLATES_JSON), 'utf8')).toBe(planTemplatesJson())
  })
})

describe('plantillas: bloques', () => {
  it('ningún bloque repite ejercicio (la sesión en curso no lo admite)', () => {
    for (const t of buildPlanTemplates()) {
      for (const w of t.structure.weeks) {
        for (const s of w.sessions) {
          for (const b of s.blocks) {
            const ids = b.exercises.map((e) => e.exercise_id)
            expect(new Set(ids).size, `${t.id} ${s.title}`).toBe(ids.length)
          }
        }
      }
    }
  })
})

describe('HYROX y DEKA: datos de competición verificados', () => {
  const station = (id: string) => HYROX_STATIONS.find((s) => s.exercise_id === id)!
  const zone = (id: string) => DEKA_ZONES.find((z) => z.exercise_id === id)!

  it('HYROX Open: distancias y pesos por sexo', () => {
    expect(HYROX_STATIONS.map((s) => [s.exercise_id, s.distance_m ?? s.reps])).toEqual([
      ['skierg', 1000],
      ['sled_push', 50],
      ['sled_pull', 50],
      ['burpee_broad_jump', 80],
      ['row_erg', 1000],
      ['farmers_carry', 200],
      ['sandbag_lunge', 100],
      ['wall_ball', 100],
    ])
    expect(station('sled_push').standard).toEqual({
      men: '152 kg (con el trineo)',
      women: '102 kg (con el trineo)',
    })
    expect(station('sled_pull').standard!.women).toBe('78 kg (con el trineo)')
    expect(station('farmers_carry').standard).toEqual({ men: '2 × 24 kg', women: '2 × 16 kg' })
    expect(station('wall_ball').standard).toEqual({
      men: '100 × 6 kg a 3,0 m',
      women: '75 × 4 kg a 2,7 m',
    })
  })

  it('DEKA FIT: 10 zonas con sus pesos por sexo', () => {
    expect(zone('ram_reverse_lunge').standard).toEqual({ men: '25 kg', women: '15 kg' })
    expect(zone('box_jump_over').note).toContain('61 cm')
    expect(zone('med_ball_situp_throw').standard).toEqual({ men: '9 kg', women: '6,5 kg' })
    expect(zone('farmers_carry').standard!.women).toBe('18 kg por mano')
    expect(zone('air_bike').calories).toBe(25)
    expect(zone('dead_ball_over').standard).toEqual({ men: '27,5 kg', women: '17,5 kg' })
    expect(zone('tank_push_pull').standard!.men).toContain('8')
    expect(zone('ram_burpee').standard).toEqual({ men: '20 kg', women: '10 kg' })
  })

  it('las plantillas llevan el estándar por sexo y ya no dicen «pendiente de verificar»', () => {
    const json = JSON.stringify(
      buildPlanTemplates().filter((t) => t.family === 'hyrox' || t.family === 'deka'),
    )
    expect(json.toLowerCase()).not.toContain('pendiente de verificar')
    expect(json).toContain('"standard":{"men":"152 kg (con el trineo)"')
    expect(json).toContain('"women":"17,5 kg"')
  })
})
