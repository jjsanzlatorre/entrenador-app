// Bloque de varios días del chat (add_sessions_range, 0034): respond_chat_range añade los días
// elegidos en una transacción, avisa de los choques con sesiones ya planificadas, no toca el plan
// existente y solo funciona con la cuenta propia.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000034a1'
const B = '00000000-0000-4000-8000-0000000034b2'
const C = '00000000-0000-4000-8000-0000000034c3'

let db: PGlite

function day(offset: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana34@test.dev')
  await createUser(db, B, 'bea34@test.dev')
  await createUser(db, C, 'carla34@test.dev')
})

const blocks = (id: string) => [
  { block_type: 'free', exercises: [{ exercise_id: id, duration_s: 1800 }] },
]

const rangeDay = (date: string, title: string) => ({
  date,
  session: {
    session_type: 'yoga',
    title,
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 30,
    blocks: blocks('yoga'),
  },
})

// Plan de fuerza que empieza dentro de 5 días (una sesión ese día y otra a los 7).
async function strengthPlan(user: string) {
  const s = (date: string, title: string) => ({
    date,
    week: 1,
    session_type: 'strength',
    title,
    intensity: 'moderate',
    heavy_legs: false,
    duration_min: 60,
    blocks: [
      { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8' }] },
    ],
  })
  await asUser(
    db,
    user,
    `select public.create_user_plan('strength_beginner', 'Fuerza', $1::date, $2::jsonb)`,
    [day(5), JSON.stringify([s(day(5), 'Fuerza A'), s(day(7), 'Fuerza B')])],
  )
}

async function chatWithRange(user: string, days: unknown[]) {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.begin_ai_interaction('chat', '{}'::jsonb, 100, 'Europe/Madrid', 'gemini', 'm', null) as id`,
  )
  const id = rows[0]!.id
  await asUser(
    db,
    user,
    `select public.finish_ai_interaction($1, 'ok', $2::jsonb, 1, 1, null, 'm')`,
    [
      id,
      JSON.stringify({
        reply: 'Te propongo estos días.',
        changes: [],
        dropped: [],
        ranges: [{ title: 'Recuperación', reason: 'Agujetas', days }],
      }),
    ],
  )
  return id
}

async function sessionsOf(user: string) {
  return asUser<{ date: string; title: string; session_type: string; notes: string }>(
    db,
    user,
    `select to_char(date, 'YYYY-MM-DD') as date, title, session_type, notes
     from public.planned_sessions where user_id = $1 order by date, title`,
    [user],
  )
}

const respond = (user: string, sql: string, params: unknown[]) =>
  asUser<{ r: Record<string, unknown> }>(
    db,
    user,
    `select public.respond_chat_range(${sql}) as r`,
    params,
  )

describe('respond_chat_range', () => {
  it('añade los días marcados en una transacción sin tocar el plan desde su inicio', async () => {
    await strengthPlan(A)
    const days = [0, 1, 2, 3, 4].map((i) => rangeDay(day(i), `Suave ${i}`))
    const chat = await chatWithRange(A, days)
    // Se desmarca el día 2.
    const chosen = [day(0), day(1), day(3), day(4)]
    const rows = await respond(A, `$1, 0, true, $2::date[]`, [chat, chosen])
    expect(rows[0]!.r).toEqual({ status: 'accepted', created: 4, dates: chosen, conflicts: [] })
    const all = await sessionsOf(A)
    expect(all.map((s) => [s.date, s.title])).toEqual([
      [day(0), 'Suave 0'],
      [day(1), 'Suave 1'],
      [day(3), 'Suave 3'],
      [day(4), 'Suave 4'],
      [day(5), 'Fuerza A'],
      [day(7), 'Fuerza B'],
    ])
    expect(all[0]!.notes).toContain('Añadida por la IA: Agujetas')
    const saved = await asUser<{ action_results: unknown; accepted: boolean }>(
      db,
      A,
      `select action_results, accepted from public.ai_interactions where id = $1`,
      [chat],
    )
    expect(saved[0]).toEqual({
      action_results: { ranges: { '0': rows[0]!.r } },
      accepted: true,
    })
    // No se aplica dos veces.
    await expect(respond(A, `$1, 0, true, null`, [chat])).rejects.toThrow(/ya respondida/)
  })

  it('un día que ya tiene sesión: falla sin confirmar y no crea ninguna (transacción)', async () => {
    const chat = await chatWithRange(A, [rangeDay(day(6), 'Yoga'), rangeDay(day(7), 'Choque')])
    const before = (await sessionsOf(A)).length
    await expect(respond(A, `$1, 0, true, null`, [chat])).rejects.toThrow(
      new RegExp(`conflicto: ya tienes sesiones planificadas el ${day(7)}`),
    )
    expect(await sessionsOf(A)).toHaveLength(before)
    // Confirmado desde la tarjeta: se añade junto a la que ya había (no la quita).
    const rows = await respond(A, `$1, 0, true, null, true`, [chat])
    expect(rows[0]!.r).toMatchObject({ created: 2, conflicts: [day(7)] })
    const on7 = (await sessionsOf(A)).filter((s) => s.date === day(7)).map((s) => s.title)
    expect(on7).toEqual(['Choque', 'Fuerza B'])
  })

  it('descartar no crea nada; sin días marcados o con un índice inexistente, error', async () => {
    const chat = await chatWithRange(A, [rangeDay(day(9), 'X')])
    await expect(respond(A, `$1, 0, true, '{}'::date[]`, [chat])).rejects.toThrow(/al menos un día/)
    await expect(respond(A, `$1, 1, true, null`, [chat])).rejects.toThrow(/bloque no encontrado/)
    const rows = await respond(A, `$1, 0, false`, [chat])
    expect(rows[0]!.r).toEqual({ status: 'discarded' })
    expect((await sessionsOf(A)).some((s) => s.date === day(9))).toBe(false)
  })

  it('sin plan activo no se añade nada', async () => {
    const chat = await chatWithRange(C, [rangeDay(day(1), 'X')])
    await expect(respond(C, `$1, 0, true, null`, [chat])).rejects.toThrow(/no hay plan activo/)
  })

  it('nadie responde las propuestas de otra persona', async () => {
    await strengthPlan(B)
    const chat = await chatWithRange(A, [rangeDay(day(2), 'Ajena')])
    await expect(respond(B, `$1, 0, true, null`, [chat])).rejects.toThrow(/no encontrada/)
    await expect(
      asUser(db, B, `update public.ai_interactions set action_results = '{}' where id = $1`, [
        chat,
      ]),
    ).rejects.toThrow()
  })
})
