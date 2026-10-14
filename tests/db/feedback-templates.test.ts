// 0044: feedback (cada uno el suyo, el admin todos y solo él cambia el estado), plantillas de
// entreno y consejos cerrados (solo del dueño). Dos pasadas de migraciones.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const ADMIN = '00000000-0000-4000-8000-0000000044a1'
const A = '00000000-0000-4000-8000-0000000044b2'
const B = '00000000-0000-4000-8000-0000000044c3'

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, ADMIN, 'admin44@test.dev')
  await createUser(db, A, 'ana44@test.dev')
  await createUser(db, B, 'bea44@test.dev')
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
})

const sendFeedback = (uid: string, kind = 'bug', message = 'No suena el descanso') =>
  asUser<{ id: string }>(
    db,
    uid,
    `insert into public.feedback (kind, message, route, device)
     values ($1, $2, '/entrenar/sesion', 'iOS 18.2 · Safari') returning id`,
    [kind, message],
  )

describe('feedback', () => {
  it('cada usuario crea y ve solo los suyos; el admin ve todos', async () => {
    const [fa] = await sendFeedback(A)
    await sendFeedback(B, 'idea', 'Repetir entreno')
    const mine = await asUser<{ id: string; status: string; user_id: string }>(
      db,
      A,
      'select id, status, user_id from public.feedback',
    )
    expect(mine).toEqual([{ id: fa!.id, status: 'new', user_id: A }])
    const all = await asUser(db, ADMIN, 'select id from public.feedback')
    expect(all).toHaveLength(2)
  })

  it('no se puede crear a nombre de otro, con estado ni con tipo o texto no válidos', async () => {
    await expect(
      asUser(
        db,
        A,
        `insert into public.feedback (user_id, kind, message) values ($1, 'bug', 'x')`,
        [B],
      ),
    ).rejects.toThrow()
    await expect(
      asUser(
        db,
        A,
        `insert into public.feedback (kind, message, status) values ('bug', 'x', 'done')`,
      ),
    ).rejects.toThrow()
    await expect(sendFeedback(A, 'otro')).rejects.toThrow()
    await expect(sendFeedback(A, 'bug', '   ')).rejects.toThrow()
  })

  it('solo el admin cambia el estado', async () => {
    const [f] = await sendFeedback(A, 'awkward', 'Cuesta encontrar Guardar')
    const updated = await asUser(
      db,
      A,
      `update public.feedback set status = 'done' where id = $1 returning id`,
      [f!.id],
    )
    expect(updated).toHaveLength(0)
    await expect(
      asUser(db, A, `update public.feedback set message = 'otro' where id = $1`, [f!.id]),
    ).rejects.toThrow()
    const byAdmin = await asUser<{ status: string }>(
      db,
      ADMIN,
      `update public.feedback set status = 'done', updated_at = now() where id = $1
       returning status`,
      [f!.id],
    )
    expect(byAdmin).toEqual([{ status: 'done' }])
    await expect(
      asUser(db, ADMIN, `update public.feedback set status = 'raro' where id = $1`, [f!.id]),
    ).rejects.toThrow()
  })

  it('anon no ve nada', async () => {
    await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.feedback')).rejects.toThrow()
    } finally {
      await db.exec('reset role')
    }
  })

  it('un usuario desactivado no puede enviar', async () => {
    await db.query(`update public.profiles set active = false where id = $1`, [B])
    await expect(sendFeedback(B)).rejects.toThrow()
    await db.query(`update public.profiles set active = true where id = $1`, [B])
  })
})

const STRUCTURE = JSON.stringify({
  v: 1,
  location: 'gym',
  blocks: [
    {
      block_type: 'straight',
      settings: null,
      exercises: [{ exercise_id: 'back_squat', rest_s: 150 }],
      sets: [{ exercise_id: 'back_squat', is_warmup: false, reps: 8 }],
    },
  ],
})

describe('workout_templates', () => {
  it('crear, leer, renombrar y borrar solo lo propio', async () => {
    const [t] = await asUser<{ id: string; user_id: string }>(
      db,
      A,
      `insert into public.workout_templates (name, session_type, structure)
       values ('Pierna A', 'strength', $1::jsonb) returning id, user_id`,
      [STRUCTURE],
    )
    expect(t!.user_id).toBe(A)
    expect(await asUser(db, B, 'select id from public.workout_templates')).toHaveLength(0)
    expect(
      await asUser(
        db,
        B,
        `update public.workout_templates set name = 'mía' where id = $1 returning id`,
        [t!.id],
      ),
    ).toHaveLength(0)
    expect(
      await asUser(db, B, `delete from public.workout_templates where id = $1 returning id`, [
        t!.id,
      ]),
    ).toHaveLength(0)
    const renamed = await asUser<{ name: string }>(
      db,
      A,
      `update public.workout_templates set name = 'Pierna B', last_used_at = now()
       where id = $1 returning name`,
      [t!.id],
    )
    expect(renamed).toEqual([{ name: 'Pierna B' }])
    expect(
      await asUser(db, A, `delete from public.workout_templates where id = $1 returning id`, [
        t!.id,
      ]),
    ).toHaveLength(1)
  })

  it('valida la estructura, el tipo y el nombre; no se crean para otro', async () => {
    const insert = (name: string, type: string, structure: string) =>
      asUser(
        db,
        A,
        `insert into public.workout_templates (name, session_type, structure)
         values ($1, $2, $3::jsonb)`,
        [name, type, structure],
      )
    await expect(insert('X', 'strength', '{"v":1,"blocks":[]}')).rejects.toThrow()
    await expect(insert('X', 'strength', '[]')).rejects.toThrow()
    await expect(insert('X', 'karate', STRUCTURE)).rejects.toThrow()
    await expect(insert('  ', 'strength', STRUCTURE)).rejects.toThrow()
    await expect(
      asUser(
        db,
        A,
        `insert into public.workout_templates (user_id, name, session_type, structure)
         values ($1, 'X', 'strength', $2::jsonb)`,
        [B, STRUCTURE],
      ),
    ).rejects.toThrow()
  })

  it('como mucho 50 por usuario', async () => {
    for (let i = 0; i < 50; i++) {
      await asUser(
        db,
        B,
        `insert into public.workout_templates (name, session_type, structure)
         values ($1, 'strength', $2::jsonb)`,
        [`T${i}`, STRUCTURE],
      )
    }
    await expect(
      asUser(
        db,
        B,
        `insert into public.workout_templates (name, session_type, structure)
         values ('T51', 'strength', $1::jsonb)`,
        [STRUCTURE],
      ),
    ).rejects.toThrow(/50/)
  })
})

describe('dismissed_tips', () => {
  it('se guardan sin duplicar, solo los propios, y se pueden borrar', async () => {
    const upsert = (uid: string, tip: string) =>
      asUser(
        db,
        uid,
        `insert into public.dismissed_tips (tip_id) values ($1) on conflict do nothing`,
        [tip],
      )
    await upsert(A, 'today')
    await upsert(A, 'today')
    await upsert(A, 'plan')
    expect(await asUser(db, A, 'select tip_id from public.dismissed_tips')).toHaveLength(2)
    expect(await asUser(db, B, 'select tip_id from public.dismissed_tips')).toHaveLength(0)
    await expect(upsert(A, 'No Vale!')).rejects.toThrow()
    await expect(
      asUser(db, A, `insert into public.dismissed_tips (user_id, tip_id) values ($1, 'x')`, [B]),
    ).rejects.toThrow()
    await asUser(db, A, 'delete from public.dismissed_tips where user_id = $1', [A])
    expect(await asUser(db, A, 'select tip_id from public.dismissed_tips')).toHaveLength(0)
  })
})
