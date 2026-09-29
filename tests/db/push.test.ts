// Fase 7B en la base de datos: suscripciones push, preferencias y registro de envíos.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a8'
const B = '00000000-0000-4000-8000-0000000000b8'
let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana8@test.dev')
  await createUser(db, B, 'bea8@test.dev')
})

const save = (uid: string, endpoint: string) =>
  asUser(db, uid, "select public.save_push_subscription($1, 'p256', 'auth', 'ua') as id", [
    endpoint,
  ])

describe('push_subscriptions', () => {
  it('cada uno ve solo las suyas; un endpoint pasa al último usuario que entra', async () => {
    await save(A, 'https://push.example/1')
    expect(await asUser(db, A, 'select endpoint from public.push_subscriptions')).toHaveLength(1)
    expect(await asUser(db, B, 'select endpoint from public.push_subscriptions')).toHaveLength(0)
    await save(B, 'https://push.example/1')
    expect(await asUser(db, A, 'select endpoint from public.push_subscriptions')).toHaveLength(0)
    expect(await asUser(db, B, 'select endpoint from public.push_subscriptions')).toHaveLength(1)
  })

  it('no se puede insertar ni modificar directamente, ni apuntar a http', async () => {
    await expect(
      asUser(
        db,
        A,
        "insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://x/2','a','b')",
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(save(A, 'http://inseguro/1')).rejects.toThrow()
  })

  it('borrar solo lo propio', async () => {
    await asUser(db, A, 'delete from public.push_subscriptions')
    expect(
      (await db.query('select count(*)::int as n from public.push_subscriptions')).rows[0],
    ).toEqual({ n: 1 })
    await asUser(db, B, 'delete from public.push_subscriptions')
    expect(
      (await db.query('select count(*)::int as n from public.push_subscriptions')).rows[0],
    ).toEqual({ n: 0 })
  })

  it('anon no puede guardar suscripciones', async () => {
    await db.exec('set role anon')
    try {
      await expect(
        db.query("select public.save_push_subscription('https://x/3','a','b')"),
      ).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('notification_settings', () => {
  it('propias, con hora en tramos de 15 min y zona horaria válida', async () => {
    await asUser(
      db,
      A,
      "insert into public.notification_settings (plan_reminder, reminder_time, tz) values (true, '07:45', 'Europe/Madrid')",
    )
    expect(await asUser(db, B, 'select * from public.notification_settings')).toHaveLength(0)
    await expect(
      asUser(db, A, "update public.notification_settings set reminder_time = '07:40'"),
    ).rejects.toThrow()
    await expect(
      asUser(db, A, "update public.notification_settings set tz = 'Marte/Olympus'"),
    ).rejects.toThrow(/zona horaria/)
    await expect(
      asUser(
        db,
        B,
        `insert into public.notification_settings (user_id) values ('${A}') on conflict do nothing`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('push_log', () => {
  it('solo el servidor (service role): los usuarios no lo leen ni escriben', async () => {
    await expect(asUser(db, A, 'select * from public.push_log')).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      asUser(db, A, `insert into public.push_log (user_id, key) values ('${A}', 'daily:x')`),
    ).rejects.toThrow(/permission denied/)
  })
})
