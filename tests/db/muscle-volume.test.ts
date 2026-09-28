// Fase 4 en la base de datos: session_exercise_sets (series efectivas por sesión y ejercicio).
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a4'
const B = '00000000-0000-4000-8000-0000000000b4'

let seq = 0
const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

function set(block: string, exercise: string, extra = {}) {
  return {
    id: uuid('30000000'),
    block_id: block,
    exercise_id: exercise,
    set_index: seq,
    is_warmup: false,
    weight_kg: 60,
    reps: 8,
    duration_s: null,
    distance_m: null,
    completed: true,
    completed_at: '2026-09-30T09:30:00Z',
    ...extra,
  }
}

async function saveSession(
  user: string,
  startedAt: string,
  sets: (block: string) => unknown[],
  ended = true,
) {
  const id = uuid('10000000')
  const block = uuid('20000000')
  const payload = {
    session: {
      id,
      session_type: 'strength',
      title: 'Test',
      started_at: startedAt,
      ended_at: ended ? startedAt : null,
      duration_min: 60,
      rpe: 7,
      client_rev: 1,
    },
    blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
    sets: sets(block),
  }
  await asUser(db, user, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload)])
  return id
}

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana@test.dev')
  await createUser(db, B, 'bea@test.dev')
})

describe('session_exercise_sets', () => {
  it('cuenta series completadas sin calentamiento, por sesión y ejercicio, dentro del rango', async () => {
    const inRange = await saveSession(A, '2026-09-29T09:00:00Z', (b) => [
      set(b, 'back_squat'),
      set(b, 'back_squat'),
      set(b, 'back_squat', { is_warmup: true }),
      set(b, 'back_squat', { completed: false, completed_at: null }),
      set(b, 'romanian_deadlift'),
    ])
    await saveSession(A, '2026-09-20T09:00:00Z', (b) => [set(b, 'back_squat')])
    await saveSession(A, '2026-09-30T09:00:00Z', (b) => [set(b, 'back_squat')], false)
    await saveSession(B, '2026-09-29T09:00:00Z', (b) => [set(b, 'bench_press')])

    const rows = await asUser<{ session_id: string; exercise_id: string; sets: number }>(
      db,
      A,
      `select * from public.session_exercise_sets('2026-09-28T00:00:00Z', '2026-10-05T00:00:00Z')
       order by exercise_id`,
    )
    expect(rows).toEqual([
      { session_id: inRange, exercise_id: 'back_squat', sets: 2 },
      { session_id: inRange, exercise_id: 'romanian_deadlift', sets: 1 },
    ])

    // B solo ve lo suyo.
    const other = await asUser<{ exercise_id: string }>(
      db,
      B,
      `select * from public.session_exercise_sets('2026-09-28T00:00:00Z', '2026-10-05T00:00:00Z')`,
    )
    expect(other.map((r) => r.exercise_id)).toEqual(['bench_press'])
  })

  it('anon no puede ejecutarla', async () => {
    await db.exec('set role anon')
    try {
      await expect(
        db.query(`select * from public.session_exercise_sets(now(), now())`),
      ).rejects.toThrow()
    } finally {
      await db.exec('reset role')
    }
  })
})
