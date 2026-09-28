// Fase 3B en la base de datos: catálogos de equivalencias, hitos mostrados y session_totals.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a3'
const B = '00000000-0000-4000-8000-0000000000b3'
const S1 = '10000000-0000-4000-8000-000000000301'
const BLOCK = '20000000-0000-4000-8000-000000000301'

let seq = 0
const setId = () => `30000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

function set(exercise: string, weight: number | null, reps: number | null, extra = {}) {
  return {
    id: setId(),
    block_id: BLOCK,
    exercise_id: exercise,
    set_index: seq,
    is_warmup: false,
    weight_kg: weight,
    reps,
    duration_s: null,
    distance_m: null,
    completed: true,
    completed_at: '2026-09-30T09:30:00Z',
    ...extra,
  }
}

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana@test.dev')
  await createUser(db, B, 'bea@test.dev')
})

describe('catálogos de equivalencias', () => {
  it('se siembran y los usuarios solo los pueden leer', async () => {
    const objects = await asUser<{ n: number }>(
      db,
      A,
      "select count(*)::int as n from public.equivalence_objects where kind = 'weight'",
    )
    expect(objects[0]!.n).toBeGreaterThanOrEqual(20)
    const places = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.destinations',
    )
    expect(places[0]!.n).toBeGreaterThanOrEqual(40)
    await expect(
      asUser(db, A, "update public.destinations set name = 'x' where id = 'madrid'"),
    ).rejects.toThrow()
    await expect(
      asUser(db, A, "delete from public.equivalence_objects where id = 'tractor'"),
    ).rejects.toThrow()
  })
})

describe('milestones_shown', () => {
  it('cada usuario ve y crea solo sus hitos; repetir la clave no duplica', async () => {
    await asUser(
      db,
      A,
      "insert into public.milestones_shown (milestone_key) values ('tonnage_total_tractor')",
    )
    await asUser(
      db,
      A,
      "insert into public.milestones_shown (milestone_key) values ('tonnage_total_tractor') on conflict do nothing",
    )
    const mine = await asUser(db, A, 'select milestone_key from public.milestones_shown')
    expect(mine).toHaveLength(1)
    expect(await asUser(db, B, 'select * from public.milestones_shown')).toHaveLength(0)
    await expect(
      asUser(
        db,
        B,
        `insert into public.milestones_shown (user_id, milestone_key) values ('${A}', 'x')`,
      ),
    ).rejects.toThrow()
  })
})

describe('session_totals', () => {
  it('tonelaje sin calentamiento, sin series sin completar y sin peso corporal', async () => {
    const payload = {
      session: {
        id: S1,
        session_type: 'strength',
        title: 'Test',
        started_at: '2026-09-30T09:00:00Z',
        ended_at: '2026-09-30T10:00:00Z',
        duration_min: 60,
        rpe: 7,
        client_rev: 1,
      },
      blocks: [{ id: BLOCK, order: 0, block_type: 'straight', config: {} }],
      sets: [
        set('bench_press', 60, 10),
        set('bench_press', 60, 8),
        set('bench_press', 40, 10, { is_warmup: true }),
        set('bench_press', 70, 5, { completed: false, completed_at: null }),
        // Peso corporal: suma reps pero no tonelaje (aunque llegue un peso).
        set('pull_up', 20, 6),
        set('push_up', null, 15),
      ],
    }
    await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload)])
    const rows = await asUser<{ session_id: string; tonnage_kg: string; total_reps: number }>(
      db,
      A,
      'select * from public.session_totals()',
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.tonnage_kg)).toBe(60 * 10 + 60 * 8)
    expect(rows[0]!.total_reps).toBe(10 + 8 + 6 + 15)
    // Otro usuario no ve los totales de A.
    expect(await asUser(db, B, 'select * from public.session_totals()')).toHaveLength(0)
  })
})
