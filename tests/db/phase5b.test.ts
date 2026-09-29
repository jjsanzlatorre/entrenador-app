// Fase 5B en la base de datos: 0022 (HYROX/DEKA verificados) y 0023 (heavy_legs, check-in
// diario y recent_exercise_sets).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000005b1'
const B = '00000000-0000-4000-8000-0000000005b2'

let seq = 0
const uuid = () => `5b000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

let db: PGlite

const migration0023 = readFileSync(
  join(import.meta.dirname, '../../supabase/migrations/0023_phase5b.sql'),
  'utf8',
)

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana5b@test.dev')
  await createUser(db, B, 'bea5b@test.dev')
})

type TemplateSession = { title: string; heavy_legs: boolean; blocks: unknown[] }

async function templateWeek(id: string, week = 1) {
  const rows = await asUser<{ s: TemplateSession[] }>(
    db,
    A,
    `select w -> 'sessions' as s from public.plan_templates t,
       jsonb_array_elements(t.structure -> 'weeks') w
     where t.id = $1 and (w ->> 'week')::int = $2`,
    [id, week],
  )
  return rows[0]!.s
}

async function createHyroxPlan(user: string) {
  const sessions = (await templateWeek('hyrox_beginner')).map((s, i) => ({
    date: `2026-10-0${5 + i}`,
    week: 1,
    session_type: 'functional',
    title: s.title,
    intensity: 'hard',
    heavy_legs: s.heavy_legs,
    duration_min: 60,
    notes: null,
    blocks: s.blocks,
  }))
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.create_user_plan('hyrox_beginner', 'HYROX', '2026-10-05'::date, $1::jsonb) as id`,
    [JSON.stringify(sessions)],
  )
  return rows[0]!.id
}

describe('0022: plantillas de HYROX y DEKA verificadas', () => {
  it('llevan el estándar por sexo aunque 0021 se vuelva a ejecutar antes (dos pasadas)', async () => {
    const rows = await asUser<{ structure: string; description: string }>(
      db,
      A,
      "select structure::text as structure, description from public.plan_templates where family in ('hyrox', 'deka')",
    )
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.structure.toLowerCase()).not.toContain('pendiente de verificar')
      expect(r.description.toLowerCase()).not.toContain('pendiente de verificar')
    }
    expect(rows.some((r) => r.structure.includes('"women": "102 kg (con el trineo)"'))).toBe(true)
  })
})

describe('0023: heavy_legs en sesiones planificadas', () => {
  it('create_user_plan guarda heavy_legs', async () => {
    const plan = await createHyroxPlan(A)
    const rows = await asUser<{ title: string; heavy_legs: boolean }>(
      db,
      A,
      'select title, heavy_legs from public.planned_sessions where user_plan_id = $1 order by date',
      [plan],
    )
    expect(rows.find((r) => r.title === 'Fuerza específica')?.heavy_legs).toBe(true)
    expect(rows.find((r) => r.title === 'Compromised running')?.heavy_legs).toBe(false)
  })

  it('el usuario no puede cambiar heavy_legs', async () => {
    await expect(
      asUser(db, A, 'update public.planned_sessions set heavy_legs = false'),
    ).rejects.toThrow()
  })

  it('rellena heavy_legs y refresca los bloques de HYROX pendientes al aplicar 0023', async () => {
    const plan = await createHyroxPlan(B)
    // Como un plan creado antes de 0023: sin heavy_legs y con la prescripción antigua.
    await db.query(
      `update public.planned_sessions set heavy_legs = false,
         blocks = '[{"block_type":"straight","exercises":[{"exercise_id":"sled_push","note":"Competición (pendiente de verificar)"}]}]'::jsonb
       where user_plan_id = $1`,
      [plan],
    )
    // Una ya hecha no se toca.
    await db.query(
      `update public.planned_sessions set status = 'done' where user_plan_id = $1 and title = 'Compromised running'`,
      [plan],
    )
    await db.exec(migration0023)
    const rows = await asUser<{ title: string; heavy_legs: boolean; blocks: string }>(
      db,
      B,
      'select title, heavy_legs, blocks::text as blocks from public.planned_sessions where user_plan_id = $1',
      [plan],
    )
    const strength = rows.find((r) => r.title === 'Fuerza específica')!
    expect(strength.heavy_legs).toBe(true)
    expect(strength.blocks).toContain('"standard"')
    expect(strength.blocks).not.toContain('pendiente de verificar')
    const done = rows.find((r) => r.title === 'Compromised running')!
    expect(done.blocks).toContain('pendiente de verificar')
  })
})

describe('0023: daily_checkins', () => {
  it('cada uno guarda y lee solo el suyo; upsert por día', async () => {
    await asUser(
      db,
      A,
      `insert into public.daily_checkins (date, sleep, energy, soreness, stress)
       values ('2026-10-05', 4, 3, 2, 1)`,
    )
    await asUser(
      db,
      A,
      `insert into public.daily_checkins (user_id, date, sleep, energy, soreness, stress)
       values ($1, '2026-10-05', 5, 5, 1, 1)
       on conflict (user_id, date) do update set sleep = excluded.sleep, energy = excluded.energy`,
      [A],
    )
    const mine = await asUser<{ sleep: number; energy: number; user_id: string }>(
      db,
      A,
      'select user_id, sleep, energy from public.daily_checkins',
    )
    expect(mine).toEqual([{ user_id: A, sleep: 5, energy: 5 }])
    expect(await asUser(db, B, 'select * from public.daily_checkins')).toEqual([])
    await expect(
      asUser(
        db,
        B,
        `insert into public.daily_checkins (user_id, date, sleep) values ($1, '2026-10-06', 3)`,
        [A],
      ),
    ).rejects.toThrow()
    const updated = await asUser(
      db,
      B,
      `update public.daily_checkins set sleep = 1 where user_id = $1 returning user_id`,
      [A],
    )
    expect(updated).toEqual([])
  })

  it('valores de 1 a 5', async () => {
    await expect(
      asUser(db, A, `insert into public.daily_checkins (date, sleep) values ('2026-10-07', 6)`),
    ).rejects.toThrow()
    await expect(
      asUser(db, A, `insert into public.daily_checkins (date, stress) values ('2026-10-07', 0)`),
    ).rejects.toThrow()
  })

  it('anon no ve nada', async () => {
    await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.daily_checkins')).rejects.toThrow()
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('0023: recent_exercise_sets', () => {
  async function workout(
    user: string,
    day: string,
    weight: number,
    opts: { ended?: boolean } = {},
  ) {
    const id = uuid()
    const block = uuid()
    const payload = {
      session: {
        id,
        session_type: 'strength',
        title: 'Torso',
        started_at: `${day}T10:00:00Z`,
        ended_at: opts.ended === false ? null : `${day}T11:00:00Z`,
        rpe: 8,
        client_rev: 1,
      },
      blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
      sets: [0, 1].map((i) => ({
        id: uuid(),
        block_id: block,
        exercise_id: 'bench_press',
        set_index: i,
        is_warmup: false,
        weight_kg: weight,
        reps: 10,
        rir: 2,
        completed: true,
        completed_at: `${day}T10:10:00Z`,
      })),
    }
    await asUser(db, user, 'select public.save_workout_session($1::jsonb)', [
      JSON.stringify(payload),
    ])
    return id
  }

  it('las 2 últimas sesiones terminadas de cada ejercicio, solo las propias', async () => {
    await workout(A, '2026-09-01', 50)
    const mid = await workout(A, '2026-09-08', 55)
    const latest = await workout(A, '2026-09-15', 60)
    await workout(A, '2026-09-20', 70, { ended: false })
    await workout(B, '2026-09-18', 100)

    type Row = { session_id: string; weight_kg: string; set_index: number }
    const rows = await asUser<Row>(
      db,
      A,
      "select session_id, weight_kg, set_index from public.recent_exercise_sets(array['bench_press'])",
    )
    expect(rows.map((r) => [r.session_id, Number(r.weight_kg)])).toEqual([
      [latest, 60],
      [latest, 60],
      [mid, 55],
      [mid, 55],
    ])

    const excluded = await asUser<Row>(
      db,
      A,
      "select session_id from public.recent_exercise_sets(array['bench_press'], 1, $1)",
      [latest],
    )
    expect([...new Set(excluded.map((r) => r.session_id))]).toEqual([mid])

    const other = await asUser<Row>(
      db,
      B,
      "select session_id, weight_kg from public.recent_exercise_sets(array['bench_press'], 5)",
    )
    expect(other.map((r) => Number(r.weight_kg))).toEqual([100, 100])
  })
})
