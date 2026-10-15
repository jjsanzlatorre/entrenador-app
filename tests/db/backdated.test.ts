// Entrenos con fecha pasada (0045): récords con su fecha real al registrar a posteriori o al
// cambiar la fecha, planificada pasada enlazada y revisión semanal marcada como desactualizada.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a5'
const B = '00000000-0000-4000-8000-0000000000b5'

let seq = 0
const uuid = (prefix: string) =>
  `${prefix}0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana@backdated.dev')
  await createUser(db, B, 'bea@backdated.dev')
})

// Sesión de press banca con series de `weight` × `reps`, empezada a `start` (ISO) y de 60 min.
function payload(opts: {
  id: string
  start: string
  weight: number
  reps?: number
  rev: number
  planned?: string | null
  blockId?: string
  setIds?: string[]
}) {
  const block = opts.blockId ?? uuid('2')
  const startMs = Date.parse(opts.start)
  const end = new Date(startMs + 60 * 60_000).toISOString()
  return {
    session: {
      id: opts.id,
      planned_session_id: opts.planned ?? null,
      session_type: 'strength',
      title: 'Test',
      started_at: opts.start,
      ended_at: end,
      duration_min: 60,
      rpe: 7,
      client_rev: opts.rev,
    },
    blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
    sets: (opts.setIds ?? [uuid('3'), uuid('3')]).map((id, i) => ({
      id,
      block_id: block,
      exercise_id: 'bench_press',
      set_index: i,
      is_warmup: false,
      weight_kg: opts.weight,
      reps: opts.reps ?? 5,
      completed: true,
      completed_at: end,
    })),
  }
}

async function save(uid: string, p: ReturnType<typeof payload>) {
  await asUser(db, uid, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(p)])
}

async function maxWeightRecords(uid: string) {
  return asUser<{ session_id: string; value: string; achieved_at: Date }>(
    db,
    uid,
    `select session_id, value, achieved_at from public.personal_records
     where exercise_id = 'bench_press' and pr_type = 'max_weight' order by achieved_at`,
  )
}

describe('récords con la fecha real', () => {
  const today = uuid('1')
  const past = uuid('1')
  const pastBlock = uuid('2')
  const pastSets = [uuid('3'), uuid('3')]

  it('una sesión registrada ayer deja el récord con la fecha de ayer', async () => {
    await save(A, payload({ id: today, start: '2026-10-15T08:00:00Z', weight: 80, rev: 1 }))
    // Registrada después (hoy) pero hecha antes (miércoles 14): con el mismo peso, el récord es
    // el de ayer y la sesión de hoy ya no es un récord.
    await save(
      A,
      payload({
        id: past,
        start: '2026-10-14T17:00:00Z',
        weight: 80,
        rev: 1,
        blockId: pastBlock,
        setIds: pastSets,
      }),
    )
    const prs = await maxWeightRecords(A)
    expect(prs).toHaveLength(1)
    expect(prs[0]!.session_id).toBe(past)
    expect(new Date(prs[0]!.achieved_at).toISOString()).toBe('2026-10-14T18:00:00.000Z')
  })

  it('al cambiar la fecha de la sesión, el récord se rehace con la nueva fecha', async () => {
    // La del 14 pasa al 16: ahora la primera marca es la del 15.
    await save(
      A,
      payload({
        id: past,
        start: '2026-10-16T07:00:00Z',
        weight: 80,
        rev: 2,
        blockId: pastBlock,
        setIds: pastSets,
      }),
    )
    const prs = await maxWeightRecords(A)
    expect(prs.map((p) => p.session_id)).toEqual([today])
    expect(new Date(prs[0]!.achieved_at).toISOString()).toBe('2026-10-15T09:00:00.000Z')
  })
})

describe('planificada de un día pasado «Registrar como hecha»', () => {
  it('queda hecha y enlazada a la sesión con su fecha', async () => {
    const sessions = JSON.stringify(
      ['2026-10-12', '2026-10-14', '2026-10-16'].map((date, i) => ({
        date,
        week: 1,
        session_type: 'strength',
        title: `Sesión ${i + 1}`,
        intensity: 'moderate',
        duration_min: 60,
        notes: null,
        blocks: [{ block_type: 'straight', exercises: [{ exercise_id: 'bench_press', sets: 3 }] }],
      })),
    )
    const [plan] = await asUser<{ id: string }>(
      db,
      B,
      `select public.create_user_plan('hybrid_beginner', 'Híbrido', '2026-10-12', $1::jsonb) as id`,
      [sessions],
    )
    const planned = await asUser<{ id: string; date: string }>(
      db,
      B,
      `select id, date::text from public.planned_sessions where user_plan_id = $1 order by date`,
      [plan!.id],
    )
    const monday = planned[0]!
    const workout = uuid('1')
    await save(
      B,
      payload({
        id: workout,
        start: '2026-10-12T16:00:00Z',
        weight: 50,
        rev: 1,
        planned: monday.id,
      }),
    )
    const rows = await asUser<{ id: string; status: string; workout_session_id: string | null }>(
      db,
      B,
      `select id, status, workout_session_id from public.planned_sessions
       where user_plan_id = $1 order by date`,
      [plan!.id],
    )
    expect(rows[0]).toMatchObject({ status: 'done', workout_session_id: workout })
    expect(rows.slice(1).map((r) => r.status)).toEqual(['planned', 'planned'])
  })
})

describe('revisión semanal desactualizada', () => {
  async function review(uid: string, period: string) {
    const [row] = await db
      .query<{ id: string }>(
        `insert into public.ai_interactions (user_id, kind, status, period, output)
       values ($1, 'weekly_review', 'ok', $2, '{}'::jsonb) returning id`,
        [uid, period],
      )
      .then((r) => r.rows)
    return row!.id
  }
  async function staleAt(id: string) {
    const rows = await asUser<{ stale_at: Date | null }>(
      db,
      A,
      'select stale_at from public.ai_interactions where id = $1',
      [id],
    )
    return rows[0]!.stale_at
  }

  it('registrar un entreno en una semana ya revisada la marca; en otra semana no', async () => {
    const reviewed = await review(A, '2026-10-05')
    const other = await review(A, '2026-09-28')
    // Domingo 11 oct, 20:00 en Madrid (18:00 UTC): semana del 5 oct.
    await save(A, payload({ id: uuid('1'), start: '2026-10-11T18:00:00Z', weight: 40, rev: 1 }))
    expect(await staleAt(reviewed)).not.toBeNull()
    expect(await staleAt(other)).toBeNull()
  })

  it('mover una sesión de otra semana a la revisada también la marca', async () => {
    const reviewed = await review(A, '2026-09-21')
    const id = uuid('1')
    const block = uuid('2')
    const sets = [uuid('3')]
    await save(
      A,
      payload({
        id,
        start: '2026-09-15T08:00:00Z',
        weight: 40,
        rev: 1,
        blockId: block,
        setIds: sets,
      }),
    )
    expect(await staleAt(reviewed)).toBeNull()
    // Volver a guardar sin cambios de fecha ni duración no la marca.
    await save(
      A,
      payload({
        id,
        start: '2026-09-15T08:00:00Z',
        weight: 45,
        rev: 2,
        blockId: block,
        setIds: sets,
      }),
    )
    expect(await staleAt(reviewed)).toBeNull()
    await save(
      A,
      payload({
        id,
        start: '2026-09-23T08:00:00Z',
        weight: 45,
        rev: 3,
        blockId: block,
        setIds: sets,
      }),
    )
    expect(await staleAt(reviewed)).not.toBeNull()
  })

  it('solo las revisiones propias; una regenerada nace al día', async () => {
    const theirs = await review(B, '2026-10-05')
    await save(A, payload({ id: uuid('1'), start: '2026-10-07T08:00:00Z', weight: 40, rev: 1 }))
    const fresh = await review(A, '2026-10-05')
    const rows = await db.query<{ stale_at: Date | null }>(
      'select stale_at from public.ai_interactions where id = $1',
      [theirs],
    )
    expect(rows.rows[0]!.stale_at).toBeNull()
    expect(await staleAt(fresh)).toBeNull()
  })

  it('el usuario no puede escribir stale_at ni llamar a las funciones del trigger', async () => {
    const id = await review(A, '2026-08-31')
    await expect(
      asUser(db, A, `update public.ai_interactions set stale_at = now() where id = $1`, [id]),
    ).rejects.toThrow()
    await expect(asUser(db, A, `select public.user_week_start($1, now())`, [A])).rejects.toThrow()
  })
})
