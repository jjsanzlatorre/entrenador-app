import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-00000000000a'

let db: PGlite

beforeAll(async () => {
  // Dos pasadas: la migración 0026 es idempotente.
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'a@test.dev')
})

describe('0026 técnica de ejercicios', () => {
  it('todos los ejercicios globales tienen 3–4 pasos y 2–3 errores', async () => {
    const { rows } = await db.query<{ id: string; steps: number; mistakes: number }>(
      `select id, cardinality(technique_steps) as steps, cardinality(technique_mistakes) as mistakes
       from public.exercises where owner_id is null`,
    )
    expect(rows.length).toBeGreaterThanOrEqual(58)
    for (const r of rows) {
      expect(r.steps, r.id).toBeGreaterThanOrEqual(3)
      expect(r.steps, r.id).toBeLessThanOrEqual(4)
      expect(r.mistakes, r.id).toBeGreaterThanOrEqual(2)
      expect(r.mistakes, r.id).toBeLessThanOrEqual(3)
    }
  })

  it('un usuario autenticado lee la técnica; sus ejercicios propios empiezan vacíos', async () => {
    const [bench] = await asUser<{ technique_steps: string[] }>(
      db,
      A,
      `select technique_steps from public.exercises where id = 'bench_press'`,
    )
    expect(bench!.technique_steps[0]).toContain('Túmbate')

    const [own] = await asUser<{ technique_steps: string[]; technique_mistakes: string[] }>(
      db,
      A,
      `insert into public.exercises (name, category, tracking_type, owner_id)
       values ('Mi ejercicio', 'strength', 'reps', $1)
       returning technique_steps, technique_mistakes`,
      [A],
    )
    expect(own).toEqual({ technique_steps: [], technique_mistakes: [] })
  })

  it('volver a aplicar la migración no toca los ejercicios propios', async () => {
    await asUser(
      db,
      A,
      `update public.exercises set technique_steps = array['Mi paso'] where owner_id = $1`,
      [A],
    )
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    await db.exec(
      readFileSync(
        join(import.meta.dirname, '../../supabase/migrations/0026_exercise_technique.sql'),
        'utf8',
      ),
    )
    const { rows } = await db.query<{ technique_steps: string[] }>(
      `select technique_steps from public.exercises where owner_id = $1`,
      [A],
    )
    expect(rows).toEqual([{ technique_steps: ['Mi paso'] }])
  })

  it('limita el número de pasos y errores', async () => {
    await expect(
      db.query(
        `update public.exercises set technique_steps = array_fill('x'::text, array[9])
         where id = 'bench_press'`,
      ),
    ).rejects.toThrow(/exercises_technique_len/)
  })
})
