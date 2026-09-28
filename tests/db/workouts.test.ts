import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const S1 = '10000000-0000-4000-8000-000000000001'
const BLK1 = '20000000-0000-4000-8000-000000000001'
const BLK2 = '20000000-0000-4000-8000-000000000002'
const SET = (n: number) => `30000000-0000-4000-8000-00000000000${n}`

function payload(
  rev: number,
  opts: { ended?: boolean; sets?: number; secondBlock?: boolean } = {},
) {
  const sets = Array.from({ length: opts.sets ?? 3 }, (_, i) => ({
    id: SET(i + 1),
    block_id: BLK1,
    exercise_id: 'bench_press',
    set_index: i,
    is_warmup: i === 0,
    weight_kg: 60 + i * 2.5,
    reps: 8,
    completed: true,
    completed_at: '2026-09-28T10:10:00Z',
  }))
  return {
    session: {
      id: S1,
      session_type: 'strength',
      title: 'Torso',
      started_at: '2026-09-28T10:00:00Z',
      ended_at: opts.ended ? '2026-09-28T11:00:00Z' : null,
      rpe: opts.ended ? 8 : null,
      client_rev: rev,
    },
    blocks: [
      { id: BLK1, order: 0, block_type: 'straight', config: {} },
      ...(opts.secondBlock ? [{ id: BLK2, order: 1, block_type: 'straight', config: {} }] : []),
    ],
    sets,
  }
}

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'a@test.dev')
  await createUser(db, B, 'b@test.dev')
})

describe('migraciones', () => {
  it('son idempotentes (se ejecutan dos veces sin error) y cargan la semilla', async () => {
    const [{ muscles }] = (
      await db.query<{ muscles: number }>('select count(*)::int as muscles from public.muscles')
    ).rows as [{ muscles: number }]
    const [{ exercises }] = (
      await db.query<{ exercises: number }>(
        'select count(*)::int as exercises from public.exercises where owner_id is null',
      )
    ).rows as [{ exercises: number }]
    expect(muscles).toBe(16)
    expect(exercises).toBeGreaterThanOrEqual(55)
    const squat = await db.query<{ muscle_id: string; role: string }>(
      "select muscle_id, role from public.exercise_muscles where exercise_id = 'back_squat' order by role, muscle_id",
    )
    expect(squat.rows).toEqual([
      { muscle_id: 'glutes', role: 'primary' },
      { muscle_id: 'quads', role: 'primary' },
      { muscle_id: 'adductors', role: 'secondary' },
      { muscle_id: 'core', role: 'secondary' },
      { muscle_id: 'lower_back', role: 'secondary' },
    ])
  })
})

describe('save_workout_session', () => {
  it('crea la sesión completa y es idempotente', async () => {
    const p = JSON.stringify(payload(1))
    await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [p])
    await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [p])
    const sets = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.exercise_sets',
    )
    expect(sets[0]?.n).toBe(3)
  })

  it('borra las series y bloques que ya no están y aplica cambios', async () => {
    await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [
      JSON.stringify(payload(2, { sets: 2, ended: true, secondBlock: true })),
    ])
    const sets = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.exercise_sets',
    )
    const blocks = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.session_blocks',
    )
    const session = await asUser<{ rpe: number; ended_at: string | null }>(
      db,
      A,
      'select rpe, ended_at from public.workout_sessions',
    )
    expect(sets[0]?.n).toBe(2)
    expect(blocks[0]?.n).toBe(2)
    expect(session[0]?.rpe).toBe(8)
    expect(session[0]?.ended_at).not.toBeNull()
  })

  it('ignora una versión antigua que llega tarde', async () => {
    const applied = await asUser<{ save_workout_session: boolean }>(
      db,
      A,
      'select public.save_workout_session($1::jsonb)',
      [JSON.stringify(payload(1, { sets: 3 }))],
    )
    expect(applied[0]?.save_workout_session).toBe(false)
    const sets = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.exercise_sets',
    )
    expect(sets[0]?.n).toBe(2)
  })

  it('otro usuario no ve ni puede sobrescribir la sesión', async () => {
    const seen = await asUser(db, B, 'select id from public.workout_sessions')
    expect(seen).toEqual([])
    await expect(
      asUser(db, B, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload(99))]),
    ).rejects.toThrow()
    const own = await asUser<{ title: string }>(db, A, 'select title from public.workout_sessions')
    expect(own[0]?.title).toBe('Torso')
  })

  it('last_exercise_sets devuelve la última sesión terminada', async () => {
    const rows = await asUser<{ exercise_id: string; weight_kg: string; set_index: number }>(
      db,
      A,
      "select exercise_id, weight_kg, set_index from public.last_exercise_sets(array['bench_press'])",
    )
    expect(rows.map((r) => [r.set_index, Number(r.weight_kg)])).toEqual([
      [0, 60],
      [1, 62.5],
    ])
    const excluded = await asUser(db, A, 'select * from public.last_exercise_sets($1, $2)', [
      ['bench_press'],
      S1,
    ])
    expect(excluded).toEqual([])
  })

  it('borrar la sesión borra bloques y series en cascada', async () => {
    await asUser(db, A, 'delete from public.workout_sessions where id = $1', [S1])
    const sets = await asUser<{ n: number }>(
      db,
      A,
      'select count(*)::int as n from public.exercise_sets',
    )
    expect(sets[0]?.n).toBe(0)
  })
})

describe('ejercicios propios', () => {
  it('un usuario crea el suyo con prefijo u_ y el otro no lo ve', async () => {
    const [ex] = await asUser<{ id: string }>(
      db,
      A,
      "insert into public.exercises (name, category, tracking_type, owner_id) values ('Mi press', 'strength', 'weight_reps', $1) returning id",
      [A],
    )
    expect(ex?.id).toMatch(/^u_/)
    await asUser(db, A, "insert into public.exercise_muscles values ($1, 'chest', 'primary')", [
      ex?.id,
    ])
    expect(await asUser(db, B, 'select id from public.exercises where id = $1', [ex?.id])).toEqual(
      [],
    )
    expect(
      await asUser(db, B, 'select * from public.exercise_muscles where exercise_id = $1', [ex?.id]),
    ).toEqual([])
  })

  it('no se pueden tocar los ejercicios globales ni usar ids sin prefijo', async () => {
    const updated = await asUser(
      db,
      A,
      "update public.exercises set name = 'x' where id = 'bench_press' returning id",
    )
    expect(updated).toEqual([])
    await expect(
      asUser(
        db,
        A,
        "insert into public.exercises (id, name, category, tracking_type, owner_id) values ('hack', 'x', 'strength', 'reps', $1)",
        [A],
      ),
    ).rejects.toThrow()
    await expect(
      asUser(
        db,
        A,
        "insert into public.exercise_muscles values ('bench_press', 'biceps', 'primary')",
      ),
    ).rejects.toThrow()
  })
})
