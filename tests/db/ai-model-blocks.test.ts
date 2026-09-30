// Modelos de IA bloqueados por cuota (0035): solo por RPC, usuarios activos, plazo máximo de
// 36 h, gana el plazo más largo y lo caducado no cuenta.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000035a1'
const B = '00000000-0000-4000-8000-0000000035b2'

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana35@test.dev')
  await createUser(db, B, 'bea35@test.dev')
})

const blocked = async (user: string, models: string[]) =>
  asUser<{ model: string; scope: string | null }>(
    db,
    user,
    `select model, scope from public.ai_blocked_models($1::text[]) order by model`,
    [models],
  )

const block = (user: string, model: string, interval: string, scope: string | null = 'daily') =>
  asUser(
    db,
    user,
    `select public.block_ai_model($1, now() + $2::interval, $3, 'Gemini 429') as until`,
    [model, interval, scope],
  )

describe('ai_model_blocks (0035)', () => {
  it('un bloqueo lo ven todos los usuarios (la cuota es de la clave)', async () => {
    await block(A, 'gemini-heavy', '10 hours')
    expect(await blocked(B, ['gemini-heavy', 'gemini-lite'])).toEqual([
      { model: 'gemini-heavy', scope: 'daily' },
    ])
  })

  it('gana el plazo más largo y nunca más de 36 h', async () => {
    await block(A, 'gemini-x', '10 hours')
    await block(B, 'gemini-x', '1 minute', 'minute')
    const [row] = await db
      .query<{ hours: number; scope: string }>(
        `select extract(epoch from blocked_until - now()) / 3600 as hours, scope
       from public.ai_model_blocks where model = 'gemini-x'`,
      )
      .then((r) => r.rows)
    expect(Number(row!.hours)).toBeGreaterThan(9)
    expect(row!.scope).toBe('daily')
    await block(A, 'gemini-y', '10 days')
    const [y] = await db
      .query<{ hours: number }>(
        `select extract(epoch from blocked_until - now()) / 3600 as hours
         from public.ai_model_blocks where model = 'gemini-y'`,
      )
      .then((r) => r.rows)
    expect(Number(y!.hours)).toBeLessThanOrEqual(36)
  })

  it('lo caducado no cuenta y se puede volver a bloquear', async () => {
    await db.query(
      `update public.ai_model_blocks set blocked_until = now() - interval '1 minute' where model = 'gemini-heavy'`,
    )
    expect(await blocked(A, ['gemini-heavy'])).toEqual([])
    await block(A, 'gemini-heavy', '30 seconds', 'minute')
    expect(await blocked(A, ['gemini-heavy'])).toEqual([{ model: 'gemini-heavy', scope: 'minute' }])
  })

  it('valida los datos', async () => {
    await expect(block(A, 'm', '-1 hour')).rejects.toThrow(/plazo/)
    await expect(block(A, 'm', '1 hour', 'weekly')).rejects.toThrow(/alcance/)
    await expect(block(A, '', '1 hour')).rejects.toThrow(/modelo/)
  })

  it('sin RPC no se lee ni se escribe la tabla; anon ni con RPC', async () => {
    await expect(asUser(db, A, `select * from public.ai_model_blocks`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      asUser(
        db,
        A,
        `insert into public.ai_model_blocks (model, blocked_until) values ('z', now())`,
      ),
    ).rejects.toThrow(/permission denied/)
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.block_ai_model(text, timestamptz, text, text)', 'execute') as ok`,
    )
    expect(rows[0]!.ok).toBe(false)
  })

  it('un usuario desactivado no puede', async () => {
    await db.query(`update public.profiles set active = false where id = $1`, [B])
    await expect(blocked(B, ['gemini-heavy'])).rejects.toThrow(/not authenticated/)
    await expect(block(B, 'gemini-z', '1 hour')).rejects.toThrow(/not authenticated/)
  })
})
