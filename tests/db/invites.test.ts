// Invitaciones por enlace (0030): códigos, permisos para invitar, canje atómico con vínculo
// aceptado en los dos sentidos, límite de intentos y contraseña temporal.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const ADMIN = '00000000-0000-4000-8000-00000000aa01'
const ANA = '00000000-0000-4000-8000-00000000aa02'
const BEA = '00000000-0000-4000-8000-00000000aa03'
const NEW1 = '00000000-0000-4000-8000-00000000aa04'
const NEW2 = '00000000-0000-4000-8000-00000000aa05'

let db: PGlite

type Code = { id: string; code: string; expires_at: string; max_uses: number }

async function asService<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role service_role')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function createCode(uid: string, days?: number, uses?: number) {
  const args = days === undefined ? '' : `${days}, ${uses ?? 1}`
  return (await asUser<Code>(db, uid, `select * from public.create_invite_code(${args})`))[0]!
}

async function redeem(code: string, user: string) {
  return (
    await asService<{ r: string }>('select public.redeem_invite_code($1, $2) as r', [code, user])
  )[0]!.r
}

async function lookup(code: string) {
  return (
    await asService<{ state: string; inviter_name: string | null }>(
      'select * from public.lookup_invite_code($1)',
      [code],
    )
  )[0]!
}

async function links(a: string, b: string) {
  return (
    await db.query<{ user_id: string; status: string; can_view_adherence: boolean }>(
      `select user_id, status, can_view_adherence, can_view_sessions from public.partner_links
       where (user_id = $1 and partner_id = $2) or (user_id = $2 and partner_id = $1)`,
      [a, b],
    )
  ).rows
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, ADMIN, 'admin@test.dev')
  await createUser(db, ANA, 'ana@test.dev')
  await createUser(db, BEA, 'bea@test.dev')
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
  await db.query(`update public.profiles set display_name = 'Ana' where id = $1`, [ANA])
})

describe('códigos de invitación', () => {
  it('el admin crea códigos legibles, únicos y con 7 días y 1 uso por defecto', async () => {
    const codes = await Promise.all([1, 2, 3, 4, 5].map(() => createCode(ADMIN)))
    for (const c of codes) {
      expect(c.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
      expect(c.max_uses).toBe(1)
      const days = (new Date(c.expires_at).getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(6.9)
      expect(days).toBeLessThan(7.1)
    }
    expect(new Set(codes.map((c) => c.code)).size).toBe(5)
    // El admin elige caducidad y usos (acotados).
    const custom = await createCode(ADMIN, 99, 3)
    expect(custom.max_uses).toBe(3)
    expect((new Date(custom.expires_at).getTime() - Date.now()) / 86_400_000).toBeLessThan(30.1)
  })

  it('un usuario no puede invitar si el admin no lo permite', async () => {
    await expect(createCode(ANA)).rejects.toThrow(/invite_not_allowed/)
    const [s] = await asUser<{ can_invite: boolean }>(db, ANA, 'select * from my_invite_status()')
    expect(s!.can_invite).toBe(false)
  })

  it('solo el admin cambia los ajustes', async () => {
    await expect(asUser(db, ANA, 'select public.set_invite_settings(true, 3)')).rejects.toThrow(
      /admin/,
    )
    await expect(
      asUser(db, ANA, 'update public.app_settings set members_can_invite = true'),
    ).rejects.toThrow()
    await asUser(db, ADMIN, 'select public.set_invite_settings(true, 2)')
    const [s] = await asUser<{ members_can_invite: boolean; max_active_invites_per_user: number }>(
      db,
      ANA,
      'select * from public.app_settings',
    )
    expect(s).toMatchObject({ members_can_invite: true, max_active_invites_per_user: 2 })
  })

  it('con permiso, cada usuario tiene un máximo de invitaciones activas (sin elegir usos)', async () => {
    const a = await createCode(ANA, 30, 10)
    expect(a.max_uses).toBe(1)
    await createCode(ANA)
    await expect(createCode(ANA)).rejects.toThrow(/invite_limit/)
    const [s] = await asUser<{ can_invite: boolean; active_count: number }>(
      db,
      ANA,
      'select * from my_invite_status()',
    )
    expect(s).toMatchObject({ can_invite: false, active_count: 2 })
    // Anular libera un hueco.
    await asUser(db, ANA, 'select public.revoke_invite_code($1)', [a.id])
    await createCode(ANA)
  })

  it('RLS: cada uno ve y anula los suyos; el admin, todos', async () => {
    const ana = await asUser<{ created_by: string }>(db, ANA, 'select * from public.invite_codes')
    expect(ana.length).toBeGreaterThan(0)
    expect(ana.every((c) => c.created_by === ANA)).toBe(true)
    expect(await asUser(db, BEA, 'select * from public.invite_codes')).toEqual([])
    const all = await asUser<{ created_by: string }>(db, ADMIN, 'select * from public.invite_codes')
    expect(new Set(all.map((c) => c.created_by))).toEqual(new Set([ADMIN, ANA]))

    const adminCode = await createCode(ADMIN)
    await expect(
      asUser(db, BEA, 'select public.revoke_invite_code($1)', [adminCode.id]),
    ).rejects.toThrow(/invite_not_found/)
    // Sin escritura directa.
    await expect(
      asUser(db, ANA, `update public.invite_codes set uses = 0 where created_by = $1`, [ANA]),
    ).rejects.toThrow()
    await expect(
      asUser(
        db,
        ANA,
        `insert into public.invite_codes (code, created_by) values ('AAAA-BBBB-CCCC', $1)`,
        [ANA],
      ),
    ).rejects.toThrow()
    // El admin anula el de otro.
    const [anaCode] = await asUser<{ id: string }>(
      db,
      ANA,
      `select id from public.invite_codes where not revoked limit 1`,
    )
    await asUser(db, ADMIN, 'select public.revoke_invite_code($1)', [anaCode!.id])
    const listed = await asUser<{ id: string; state: string }>(
      db,
      ANA,
      'select * from public.list_invite_codes()',
    )
    expect(listed.find((c) => c.id === anaCode!.id)?.state).toBe('revoked')
  })

  it('anon y authenticated no pueden consultar ni canjear códigos', async () => {
    const c = await createCode(ADMIN)
    await expect(
      asUser(db, BEA, 'select public.redeem_invite_code($1, $2)', [c.code, BEA]),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asUser(db, BEA, 'select * from public.lookup_invite_code($1)', [c.code]),
    ).rejects.toThrow(/permission denied/)
    await db.exec('set role anon')
    try {
      await expect(
        db.query('select * from public.lookup_invite_code($1)', [c.code]),
      ).rejects.toThrow(/permission denied/)
      await expect(db.query('select public.create_invite_code()')).rejects.toThrow(
        /permission denied/,
      )
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('canjear un código', () => {
  it('código válido: se consume y deja el vínculo aceptado en los dos sentidos (solo cumplimiento)', async () => {
    const c = await createCode(ANA)
    // Con minúsculas y sin guiones también vale.
    expect(await lookup(c.code.replace(/-/g, '').toLowerCase())).toMatchObject({
      state: 'active',
      inviter_name: 'Ana',
    })
    await createUser(db, NEW1, 'nuevo1@test.dev')
    expect(await redeem(c.code, NEW1)).toBe('linked')

    const rows = await links(ANA, NEW1)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'accepted' && r.can_view_adherence)).toBe(true)
    expect(
      rows.every((r) => !(r as unknown as { can_view_sessions: boolean }).can_view_sessions),
    ).toBe(true)
    const [code] = (
      await db.query<{ uses: number; used_by: string }>(
        'select uses, used_by from public.invite_codes where id = $1',
        [c.id],
      )
    ).rows
    expect(code).toEqual({ uses: 1, used_by: NEW1 })
    // Ya vinculados: cada uno ve el cumplimiento del otro.
    const [shared] = await asUser<{ ok: boolean }>(
      db,
      NEW1,
      `select public.shares_with_me($1, 'adherence') as ok`,
      [ANA],
    )
    expect(shared!.ok).toBe(true)
    const listed = await asUser<{ used_by_name: string; state: string }>(
      db,
      ANA,
      'select * from public.list_invite_codes() where id = $1',
      [c.id],
    )
    expect(listed[0]).toMatchObject({ state: 'used', used_by_name: 'nuevo1' })
  })

  it('reutilizado: el segundo canje falla y no crea vínculo', async () => {
    const c = await createCode(ADMIN)
    await createUser(db, NEW2, 'nuevo2@test.dev')
    expect(await redeem(c.code, NEW2)).toBe('linked')
    expect((await lookup(c.code)).state).toBe('used')
    await expect(redeem(c.code, BEA)).rejects.toThrow(/invite_used/)
    expect(await links(ADMIN, BEA)).toEqual([])
  })

  it('caducado', async () => {
    const c = await createCode(ADMIN)
    await db.query(
      `update public.invite_codes set expires_at = now() - interval '1 minute' where id = $1`,
      [c.id],
    )
    expect((await lookup(c.code)).state).toBe('expired')
    await expect(redeem(c.code, BEA)).rejects.toThrow(/invite_expired/)
    expect(await links(ADMIN, BEA)).toEqual([])
  })

  it('anulado', async () => {
    const c = await createCode(ADMIN)
    await asUser(db, ADMIN, 'select public.revoke_invite_code($1)', [c.id])
    expect((await lookup(c.code)).state).toBe('revoked')
    await expect(redeem(c.code, BEA)).rejects.toThrow(/invite_revoked/)
  })

  it('inexistente o mal escrito', async () => {
    expect((await lookup('ZZZZ-ZZZZ-ZZZZ')).state).toBe('not_found')
    expect((await lookup('hola')).state).toBe('not_found')
    await expect(redeem('ZZZZ-ZZZZ-ZZZZ', BEA)).rejects.toThrow(/invite_not_found/)
  })

  it('quien invita desactivado: el código deja de valer', async () => {
    await db.query(
      `update public.app_settings set members_can_invite = true, max_active_invites_per_user = 10`,
    )
    const c = await createCode(ANA)
    await db.query('update public.profiles set active = false where id = $1', [ANA])
    expect((await lookup(c.code)).state).toBe('inviter_inactive')
    await expect(redeem(c.code, BEA)).rejects.toThrow(/invite_inviter_inactive/)
    await db.query('update public.profiles set active = true where id = $1', [ANA])
  })

  it('email existente: una cuenta ya creada puede canjear (y no su propio código)', async () => {
    const own = await createCode(BEA).catch(() => null)
    if (own) await expect(redeem(own.code, BEA)).rejects.toThrow(/invite_own/)

    // Bea tenía una invitación pendiente de Ana: canjear la deja aceptada en los dos sentidos.
    await db.query(
      `insert into public.partner_links (user_id, partner_id, status) values ($1, $2, 'pending')
       on conflict do nothing`,
      [BEA, ANA],
    )
    const c = await createCode(ANA)
    expect(await redeem(c.code, BEA)).toBe('linked')
    expect((await links(ANA, BEA)).every((r) => r.status === 'accepted')).toBe(true)

    // Ya vinculados: no se gasta otro código.
    const again = await createCode(ANA)
    expect(await redeem(again.code, BEA)).toBe('already_linked')
    expect((await lookup(again.code)).state).toBe('active')
  })

  it('un vínculo ya aceptado conserva sus permisos', async () => {
    await db.query(
      `update public.partner_links set can_view_sessions = true where user_id = $1 and partner_id = $2`,
      [ANA, NEW1],
    )
    await db.query(
      `update public.partner_links set status = 'revoked' where user_id = $1 and partner_id = $2`,
      [NEW1, ANA],
    )
    const c = await createCode(ANA)
    expect(await redeem(c.code, NEW1)).toBe('linked')
    const rows = await db.query<{ user_id: string; can_view_sessions: boolean; status: string }>(
      `select user_id, can_view_sessions, status from public.partner_links
       where (user_id = $1 and partner_id = $2) or (user_id = $2 and partner_id = $1)`,
      [ANA, NEW1],
    )
    expect(rows.rows.find((r) => r.user_id === ANA)).toMatchObject({
      status: 'accepted',
      can_view_sessions: true,
    })
    expect(rows.rows.find((r) => r.user_id === NEW1)).toMatchObject({
      status: 'accepted',
      can_view_sessions: false,
    })
  })

  it('atómico: si el usuario no existe no se gasta el código ni se crea nada', async () => {
    const c = await createCode(ADMIN)
    const ghost = '00000000-0000-4000-8000-00000000aa99'
    await expect(redeem(c.code, ghost)).rejects.toThrow(/user_not_found/)
    expect((await lookup(c.code)).state).toBe('active')
    expect(await links(ADMIN, ghost)).toEqual([])
  })

  it('sin código no hay forma de crear cuenta ni vínculo desde el cliente', async () => {
    // authenticated/anon no pueden insertar vínculos aceptados ni tocar auth.users.
    await expect(
      asUser(
        db,
        BEA,
        `insert into public.partner_links (user_id, partner_id, status) values ($1, $2, 'accepted')`,
        [BEA, ADMIN],
      ),
    ).rejects.toThrow()
    await db.exec('set role anon')
    try {
      await expect(
        db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'x@test.dev')`),
      ).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from public.invite_codes')).rejects.toThrow(
        /permission denied/,
      )
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('límite de intentos', () => {
  it('cuenta por clave dentro de la ventana y solo con service role', async () => {
    for (let i = 0; i < 3; i++) await asService('select public.record_invite_attempt($1)', ['ip-a'])
    await asService('select public.record_invite_attempt($1)', ['ip-b'])
    await db.query(
      `insert into public.invite_attempts (key, created_at) values ('ip-a', now() - interval '2 hours')`,
    )
    const [n] = await asService<{ n: number }>(
      'select public.invite_attempts_count($1, 3600) as n',
      ['ip-a'],
    )
    expect(n!.n).toBe(3)
    await expect(
      asUser(db, BEA, 'select public.record_invite_attempt($1)', ['ip-a']),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(db, BEA, 'select * from public.invite_attempts')).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('contraseña temporal', () => {
  it('must_change_password solo lo cambia el servidor', async () => {
    await db.query('update public.profiles set must_change_password = true where id = $1', [BEA])
    await expect(
      asUser(db, BEA, 'update public.profiles set must_change_password = false where id = $1', [
        BEA,
      ]),
    ).rejects.toThrow()
    await asService('update public.profiles set must_change_password = false where id = $1', [BEA])
    const [p] = (
      await db.query<{ must_change_password: boolean }>(
        'select must_change_password from public.profiles where id = $1',
        [BEA],
      )
    ).rows
    expect(p!.must_change_password).toBe(false)
  })
})
