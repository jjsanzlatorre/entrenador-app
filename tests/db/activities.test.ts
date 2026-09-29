// 0031/0032: actividades nuevas (frontón, pádel, tenis, clases de gimnasio), migración de
// padel_fronton a frontón y actividades personalizadas por usuario.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { applyMigrations, asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a9'
const B = '00000000-0000-4000-8000-0000000000b9'
const C = '00000000-0000-4000-8000-0000000000c9'

let db: PGlite

let seq = 0
function payload(sessionType: string, activityTypeId: string | null = null) {
  seq++
  return {
    session: {
      id: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      session_type: sessionType,
      activity_type_id: activityTypeId,
      title: sessionType,
      started_at: '2026-09-28T08:00:00Z',
      ended_at: '2026-09-28T09:00:00Z',
      duration_min: 60,
      rpe: 6,
      client_rev: 1,
    },
    blocks: [],
    sets: [],
  }
}

const save = (uid: string, p: ReturnType<typeof payload>) =>
  asUser(db, uid, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(p)])

async function sessionRow(id: string) {
  const res = await db.query<{ session_type: string; activity_type_id: string | null }>(
    'select session_type, activity_type_id from public.workout_sessions where id = $1',
    [id],
  )
  return res.rows[0]
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana9@test.dev')
  await createUser(db, B, 'bea9@test.dev')
  await createUser(db, C, 'carlos9@test.dev')
})

describe('migración de padel_fronton (datos anteriores a 0031)', () => {
  it('sesiones, planificadas, actividades fijas, compromisos e invitaciones pasan a frontón', async () => {
    // Base con las migraciones hasta 0030 y datos con el tipo antiguo; después 0031 y 0032 (×2).
    const old = await createDb({ only: (f) => f < '0031' })
    await old.query('insert into auth.users (id, email) values ($1, $2)', [A, 'a@test.dev'])
    await old.query(
      `insert into public.workout_sessions (id, user_id, session_type, started_at, ended_at)
       values ('40000000-0000-4000-8000-000000000001', $1, 'padel_fronton', now(), now())`,
      [A],
    )
    await old.query(
      `insert into public.training_profiles (user_id, fixed_activities)
       values ($1, '[{"type":"surf","days":[6]},{"type":"padel_fronton","days":[4],"minutes":90}]')`,
      [A],
    )
    await old.query(
      `insert into public.commitments (user_id, valid_from, sessions_per_week, by_type)
       values ($1, '2026-08-31', 3, '{"strength":2,"padel_fronton":1}')`,
      [A],
    )

    for (let i = 0; i < 2; i++) await applyMigrations(old, (f) => f >= '0031')

    const s = await old.query<{ session_type: string }>(
      'select session_type from public.workout_sessions',
    )
    expect(s.rows.map((r) => r.session_type)).toEqual(['fronton'])
    const tp = await old.query<{ fixed_activities: unknown }>(
      'select fixed_activities from public.training_profiles',
    )
    expect(tp.rows[0]!.fixed_activities).toEqual([
      { type: 'surf', days: [6] },
      { type: 'fronton', days: [4], minutes: 90 },
    ])
    const c = await old.query<{ by_type: Record<string, number> }>(
      'select by_type from public.commitments',
    )
    expect(c.rows[0]!.by_type).toEqual({ strength: 2, fronton: 1 })
    await old.close()
  })
})

describe('tipos de actividad globales', () => {
  it('semilla con las actividades nuevas y su aproximación muscular', async () => {
    const rows = await asUser<{ id: string; muscles: string[]; sets_per_30min: string }>(
      db,
      A,
      'select id, muscles, sets_per_30min from public.activity_types where owner_id is null',
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const id of ['fronton', 'padel', 'tennis', 'functional_class', 'gap', 'oxfit'])
      expect(byId.has(id), id).toBe(true)
    expect(byId.get('gap')!.muscles).toEqual(['glutes', 'core', 'quads', 'hamstrings', 'adductors'])
    expect(Number(byId.get('oxfit')!.sets_per_30min)).toBe(2)
    // Los ejercicios de las actividades nuevas existen y tienen técnica.
    const ex = await db.query<{ id: string; steps: number }>(
      `select id, cardinality(technique_steps) as steps from public.exercises
       where id in ('padel', 'tennis', 'functional_class', 'gap_class', 'oxfit_class')`,
    )
    expect(ex.rows).toHaveLength(5)
    for (const r of ex.rows) expect(r.steps).toBeGreaterThanOrEqual(3)
  })

  it('son de solo lectura para los usuarios', async () => {
    const rows = await asUser(
      db,
      A,
      "update public.activity_types set name = 'X' where id = 'gap' returning id",
    ).catch(() => [])
    expect(rows).toHaveLength(0)
    await expect(
      asUser(db, A, "insert into public.activity_types (id, name) values ('gap2', 'GAP 2')"),
    ).rejects.toThrow()
  })
})

describe('sesiones con los tipos nuevos', () => {
  it('se guardan pádel, tenis, GAP, Oxfit y Functional Training', async () => {
    for (const t of ['padel', 'tennis', 'gap', 'oxfit', 'functional_class', 'fronton']) {
      const p = payload(t)
      await save(A, p)
      expect((await sessionRow(p.session.id))!.session_type).toBe(t)
    }
  })

  it('un móvil con la versión anterior que manda padel_fronton guarda frontón', async () => {
    const p = payload('padel_fronton')
    await save(A, p)
    expect((await sessionRow(p.session.id))!.session_type).toBe('fronton')
  })

  it('el reparto del compromiso acepta los tipos nuevos y rechaza padel_fronton', async () => {
    await asUser(
      db,
      A,
      `select public.set_commitment('2026-09-28', 3, null, '{"gap":1,"padel":1,"strength":1}', true)`,
    )
    await expect(
      asUser(
        db,
        A,
        `select public.set_commitment('2026-10-05', 3, null, '{"padel_fronton":1}', true)`,
      ),
    ).rejects.toThrow(/by_type/)
  })
})

describe('actividades personalizadas', () => {
  let pump = ''

  it('cada usuario crea las suyas (id a_…) y solo las ve él', async () => {
    const [row] = await asUser<{ id: string; owner_id: string }>(
      db,
      A,
      `insert into public.activity_types (name, emoji, muscles)
       values ('Body pump', '🏋️', array['quads', 'chest']) returning id, owner_id`,
    )
    pump = row!.id
    expect(pump).toMatch(/^a_/)
    expect(row!.owner_id).toBe(A)
    expect(
      await asUser(db, B, 'select id from public.activity_types where id = $1', [pump]),
    ).toHaveLength(0)
  })

  it('no se pueden crear para otro usuario, con músculos inventados ni cambiar las ajenas', async () => {
    await expect(
      asUser(db, A, `insert into public.activity_types (name, owner_id) values ('X', $1)`, [B]),
    ).rejects.toThrow()
    await expect(
      asUser(
        db,
        A,
        `insert into public.activity_types (name, muscles) values ('X', array['alas'])`,
      ),
    ).rejects.toThrow()
    const rows = await asUser(
      db,
      B,
      `update public.activity_types set name = 'Mío' where id = $1 returning id`,
      [pump],
    )
    expect(rows).toHaveLength(0)
  })

  it('el dueño la edita y la archiva', async () => {
    const rows = await asUser<{ archived: boolean }>(
      db,
      A,
      `update public.activity_types set name = 'Pump', archived = true where id = $1
       returning archived`,
      [pump],
    )
    expect(rows).toEqual([{ archived: true }])
    await asUser(db, A, 'update public.activity_types set archived = false where id = $1', [pump])
  })

  it('una sesión personalizada guarda su actividad; otro usuario no puede usarla', async () => {
    const p = payload('custom', pump)
    await save(A, p)
    expect(await sessionRow(p.session.id)).toEqual({
      session_type: 'custom',
      activity_type_id: pump,
    })
    await expect(save(B, payload('custom', pump))).rejects.toThrow(/actividad no válida/)
    // Con un tipo que no es 'custom', la actividad se ignora.
    const q = payload('gap', pump)
    await save(A, q)
    expect(await sessionRow(q.session.id)).toEqual({ session_type: 'gap', activity_type_id: null })
  })

  it('la persona vinculada la ve solo si le comparten entrenos, mapa o logros', async () => {
    await asUser(db, A, "select public.invite_partner('bea9@test.dev')")
    await asUser(db, B, 'select public.respond_partner_link($1, true)', [A])
    const visible = () =>
      asUser(db, B, 'select id from public.activity_types where id = $1', [pump])
    expect(await visible()).toHaveLength(0)

    await asUser(
      db,
      A,
      'update public.partner_links set can_view_muscles = true where user_id = $1',
      [A],
    )
    expect(await visible()).toHaveLength(1)
    const log = await asUser<{ activity_type_id: string | null; session_type: string }>(
      db,
      B,
      'select session_type, activity_type_id from public.partner_sessions($1)',
      [A],
    )
    expect(log).toContainEqual({ session_type: 'custom', activity_type_id: pump })
    // Un tercero no ve ni la actividad ni las sesiones.
    expect(
      await asUser(db, C, 'select id from public.activity_types where id = $1', [pump]),
    ).toHaveLength(0)
    expect(await asUser(db, C, 'select * from public.partner_sessions($1)', [A])).toHaveLength(0)

    await asUser(
      db,
      A,
      'update public.partner_links set can_view_muscles = false where user_id = $1',
      [A],
    )
    expect(await visible()).toHaveLength(0)
  })
})
