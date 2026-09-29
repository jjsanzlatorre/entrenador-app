// Revisión de seguridad (fase 7B), comprobada en cada ejecución de los tests:
// - RLS activada en TODAS las tablas de public.
// - Toda función SECURITY DEFINER fija search_path (evita secuestro por objetos con el mismo nombre).
// - anon no puede ejecutar ninguna función SECURITY DEFINER ni leer tablas de usuario.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './pglite'

let db: PGlite

beforeAll(async () => {
  db = await createDb()
})

describe('revisión de seguridad', () => {
  it('RLS activada en todas las tablas de public', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('todas las SECURITY DEFINER fijan search_path', async () => {
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    expect(rows.map((r) => r.proname)).toEqual([])
  })

  it('anon no puede ejecutar ninguna SECURITY DEFINER', async () => {
    const { rows } = await db.query<{ sig: string }>(`
      select p.oid::regprocedure::text as sig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'execute')`)
    expect(rows.map((r) => r.sig)).toEqual([])
  })

  it('anon no puede leer tablas de usuario', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'select')
        and c.relname not in ('muscles', 'exercises', 'exercise_muscles', 'plan_templates',
          'equivalence_objects', 'destinations')`)
    expect(rows.map((r) => r.relname)).toEqual([])
  })
})

describe('are_linked (0029)', () => {
  it('solo responde sobre uno mismo', async () => {
    const { asUser, createUser } = await import('./pglite')
    const [A, B, C] = [
      '00000000-0000-4000-8000-0000000000a9',
      '00000000-0000-4000-8000-0000000000b9',
      '00000000-0000-4000-8000-0000000000c9',
    ]
    await createUser(db, A, 'a9@test.dev')
    await createUser(db, B, 'b9@test.dev')
    await createUser(db, C, 'c9@test.dev')
    await db.query(
      `insert into public.partner_links (user_id, partner_id, status) values ($1, $2, 'accepted'), ($2, $1, 'accepted')`,
      [A, B],
    )
    const linked = async (uid: string) =>
      (await asUser<{ ok: boolean }>(db, uid, 'select public.are_linked($1, $2) as ok', [A, B]))[0]
        ?.ok
    expect(await linked(A)).toBe(true)
    expect(await linked(B)).toBe(true)
    expect(await linked(C)).toBe(false)
  })
})
