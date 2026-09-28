// 0015: el usuario edita sus preferencias del perfil pero nunca role/active; quitar y borrar
// compromisos.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a5'
const B = '00000000-0000-4000-8000-0000000000b5'
const X = '00000000-0000-4000-8000-0000000000e5'

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'a@example.com')
  await createUser(db, B, 'b@example.com')
  await createUser(db, X, 'x@example.com')
  await db.query('update public.profiles set active = false where id = $1', [X])
})

type ProfileRow = {
  display_name: string | null
  role: string
  active: boolean
  home_city: string | null
  home_lat: number | null
  home_lng: number | null
  show_equivalence_popups: boolean
}

async function profile(id: string) {
  const res = await db.query<ProfileRow>('select * from public.profiles where id = $1', [id])
  return res.rows[0]!
}

describe('perfil: preferencias editables', () => {
  it('el usuario guarda su ciudad de referencia', async () => {
    const rows = await asUser<{ id: string }>(
      db,
      A,
      `update public.profiles set home_city = 'Valencia', home_lat = 39.4699, home_lng = -0.3763
       where id = $1 returning id`,
      [A],
    )
    expect(rows).toHaveLength(1)
    const p = await profile(A)
    expect(p.home_city).toBe('Valencia')
    expect(p.home_lat).toBeCloseTo(39.4699)
    expect(p.home_lng).toBeCloseTo(-0.3763)
  })

  it('el usuario puede quitar la ciudad (null)', async () => {
    await asUser(
      db,
      A,
      'update public.profiles set home_city = null, home_lat = null, home_lng = null where id = $1',
      [A],
    )
    expect((await profile(A)).home_city).toBeNull()
  })

  it('el usuario desactiva y vuelve a activar los pop-ups de logros', async () => {
    await asUser(
      db,
      A,
      'update public.profiles set show_equivalence_popups = false where id = $1',
      [A],
    )
    expect((await profile(A)).show_equivalence_popups).toBe(false)
    await asUser(db, A, 'update public.profiles set show_equivalence_popups = true where id = $1', [
      A,
    ])
    expect((await profile(A)).show_equivalence_popups).toBe(true)
  })

  it('el usuario cambia su nombre y datos personales', async () => {
    await asUser(
      db,
      A,
      `update public.profiles set display_name = 'Ana', sex = 'female', birth_year = 1990,
       height_cm = 165 where id = $1`,
      [A],
    )
    expect((await profile(A)).display_name).toBe('Ana')
  })

  it('el usuario no puede cambiarse role ni active', async () => {
    await expect(
      asUser(db, A, "update public.profiles set role = 'admin' where id = $1", [A]),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      asUser(db, A, 'update public.profiles set active = false where id = $1', [A]),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      asUser(
        db,
        A,
        "update public.profiles set home_city = 'Madrid', role = 'admin' where id = $1",
        [A],
      ),
    ).rejects.toThrow(/permission denied/i)
    const p = await profile(A)
    expect(p.role).toBe('member')
    expect(p.active).toBe(true)
    expect(p.home_city).toBeNull()
  })

  it('no puede editar el perfil de otro usuario', async () => {
    const rows = await asUser(
      db,
      A,
      "update public.profiles set home_city = 'Madrid' where id = $1 returning id",
      [B],
    )
    expect(rows).toHaveLength(0)
    expect((await profile(B)).home_city).toBeNull()
  })

  it('un usuario desactivado no puede editar su perfil', async () => {
    const rows = await asUser(
      db,
      X,
      'update public.profiles set show_equivalence_popups = false where id = $1 returning id',
      [X],
    )
    expect(rows).toHaveLength(0)
  })

  it('el servidor (service role / SQL Editor) sí cambia role y active', async () => {
    await db.query("update public.profiles set role = 'admin' where id = $1", [B])
    await db.query('update public.profiles set active = false where id = $1', [B])
    const p = await profile(B)
    expect(p.role).toBe('admin')
    expect(p.active).toBe(false)
    await db.query("update public.profiles set role = 'member', active = true where id = $1", [B])
  })

  it('el trigger bloquea role/active aunque alguien conceda UPDATE en esas columnas', async () => {
    const db2 = await createDb()
    await createUser(db2, A, 'a@example.com')
    await db2.exec('grant update (role, active) on public.profiles to authenticated')
    await expect(
      asUser(db2, A, "update public.profiles set role = 'admin' where id = $1", [A]),
    ).rejects.toThrow(/role, active/)
    await expect(
      asUser(db2, A, 'update public.profiles set active = false where id = $1', [A]),
    ).rejects.toThrow(/role, active/)
    const rows = await asUser<{ id: string }>(
      db2,
      A,
      "update public.profiles set home_city = 'Bilbao', role = role where id = $1 returning id",
      [A],
    )
    expect(rows).toHaveLength(1)
    await db2.close()
  })
})

type CommitmentRow = { id: string; valid_from: string; valid_to: string | null }

async function commitments(uid: string) {
  return asUser<CommitmentRow>(
    db,
    uid,
    'select id, valid_from::text, valid_to::text from public.commitments where user_id = $1 order by valid_from',
    [uid],
  )
}

describe('compromiso: quitar y borrar', () => {
  it('end_commitment cierra el vigente hoy y conserva el historial', async () => {
    await asUser(db, A, "select public.set_commitment('2026-08-03', 3)")
    await asUser(db, A, "select public.set_commitment('2026-09-07', 4)")
    const [res] = await asUser<{ n: number }>(
      db,
      A,
      "select public.end_commitment('2026-09-30') as n",
    )
    expect(res!.n).toBe(1)
    expect(await commitments(A)).toEqual([
      expect.objectContaining({ valid_from: '2026-08-03', valid_to: '2026-09-06' }),
      expect.objectContaining({ valid_from: '2026-09-07', valid_to: '2026-09-30' }),
    ])
  })

  it('quitarlo otra vez no cambia nada (0)', async () => {
    const [res] = await asUser<{ n: number }>(
      db,
      A,
      "select public.end_commitment('2026-09-30') as n",
    )
    expect(res!.n).toBe(0)
    expect(await commitments(A)).toHaveLength(2)
  })

  it('quitarlo el mismo lunes en que empezó es válido', async () => {
    await asUser(db, B, "select public.set_commitment('2026-09-28', 2)")
    await asUser(db, B, "select public.end_commitment('2026-09-28')")
    expect(await commitments(B)).toEqual([
      expect.objectContaining({ valid_from: '2026-09-28', valid_to: '2026-09-28' }),
    ])
  })

  it('tras quitarlo se puede crear uno nuevo', async () => {
    await asUser(db, A, "select public.set_commitment('2026-10-05', 2)")
    const rows = await commitments(A)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(expect.objectContaining({ valid_to: '2026-09-30' }))
    expect(rows[2]).toEqual(expect.objectContaining({ valid_from: '2026-10-05', valid_to: null }))
  })

  it('no toca los compromisos de otros usuarios', async () => {
    await asUser(db, A, "select public.end_commitment('2026-10-10')")
    expect(await commitments(B)).toHaveLength(1)
  })

  it('el usuario borra una entrada de su historial', async () => {
    const before = await commitments(A)
    const target = before[2]!
    const deleted = await asUser<{ id: string }>(
      db,
      A,
      'delete from public.commitments where id = $1 returning id',
      [target.id],
    )
    expect(deleted).toHaveLength(1)
    expect((await commitments(A)).map((c) => c.id)).toEqual([before[0]!.id, before[1]!.id])
  })

  it('no puede borrar compromisos de otro usuario', async () => {
    const [b] = await commitments(B)
    const deleted = await asUser<{ id: string }>(
      db,
      A,
      'delete from public.commitments where id = $1 returning id',
      [b!.id],
    )
    expect(deleted).toHaveLength(0)
    expect(await commitments(B)).toHaveLength(1)
  })

  it('sin sesión no se puede quitar', async () => {
    await expect(db.query("select public.end_commitment('2026-09-30')")).rejects.toThrow(
      /not authenticated/,
    )
  })
})
