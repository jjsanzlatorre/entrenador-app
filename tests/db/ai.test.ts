// Fase 6A en la base de datos (0024): ai_interactions con RLS, límite diario, planes de origen
// IA y aplicar / deshacer el ajuste del día.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000006a1'
const B = '00000000-0000-4000-8000-0000000006a2'

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana6a@test.dev')
  await createUser(db, B, 'bea6a@test.dev')
})

async function begin(user: string, limit = 3, kind = 'daily_adjust') {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.begin_ai_interaction($1, '{"x":1}'::jsonb, $2, 'Europe/Madrid', 'gemini', 'm') as id`,
    [kind, limit],
  )
  return rows[0]!.id
}

async function finish(user: string, id: string, status: string, output: unknown = null) {
  await asUser(db, user, `select public.finish_ai_interaction($1, $2, $3::jsonb, 10, 5, null)`, [
    id,
    status,
    JSON.stringify(output),
  ])
}

const blocks = [
  { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 5, reps: '5' }] },
]

async function createPlan(user: string, date: string, source?: string) {
  const sessions = [
    {
      date,
      week: 1,
      session_type: 'strength',
      title: 'Pierna pesada',
      intensity: 'hard',
      heavy_legs: true,
      duration_min: 60,
      notes: null,
      blocks,
    },
  ]
  const sql = source
    ? `select public.create_user_plan(null, 'Plan IA', $1::date, $2::jsonb, $3, 'Resumen') as id`
    : `select public.create_user_plan('strength_beginner', 'Plan', $1::date, $2::jsonb) as id`
  const params = source
    ? [date, JSON.stringify(sessions), source]
    : [date, JSON.stringify(sessions)]
  await asUser(db, user, sql, params)
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select ps.id from public.planned_sessions ps join public.user_plans up on up.id = ps.user_plan_id
     where up.status = 'active' and ps.user_id = $1`,
    [user],
  )
  return rows[0]!.id
}

describe('ai_interactions y límite diario', () => {
  it('cuenta las consultas del día y corta al llegar al límite', async () => {
    const first = await begin(A, 2)
    await finish(A, first, 'ok', { a: 1 })
    const second = await begin(A, 2)
    await finish(A, second, 'invalid')
    await expect(begin(A, 2)).rejects.toThrow(/ai_daily_limit/)
    const used = await asUser<{ n: number }>(
      db,
      A,
      `select public.ai_calls_today('Europe/Madrid') as n`,
    )
    expect(used[0]!.n).toBe(2)
    // Otra persona tiene su propio límite.
    await begin(B, 2)
  })

  it('los fallos del proveedor no cuentan para el límite', async () => {
    const id = await begin(B, 2)
    await finish(B, id, 'error')
    const again = await begin(B, 2)
    expect(again).toBeTruthy()
  })

  it('RLS: cada uno ve solo las suyas; sin insert ni delete directos', async () => {
    const mine = await asUser<{ user_id: string }>(
      db,
      A,
      `select user_id from public.ai_interactions`,
    )
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.user_id === A)).toBe(true)
    await expect(
      asUser(db, A, `insert into public.ai_interactions (kind) values ('chat')`),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, `delete from public.ai_interactions`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      asUser(db, A, `update public.ai_interactions set status = 'error'`),
    ).rejects.toThrow(/permission denied/)
    // accepted sí se puede cambiar (descartar una propuesta).
    const updated = await asUser<{ id: string }>(
      db,
      A,
      `update public.ai_interactions set accepted = false where status = 'ok' returning id`,
    )
    expect(updated.length).toBe(1)
    const other = await asUser<{ id: string }>(
      db,
      B,
      `update public.ai_interactions set accepted = true where user_id = $1 returning id`,
      [A],
    )
    expect(other).toEqual([])
  })

  it('finish solo cierra consultas propias pendientes', async () => {
    const id = await begin(A, 50)
    await finish(B, id, 'ok', { hack: true })
    await finish(A, id, 'ok', { real: true })
    await finish(A, id, 'ok', { again: true })
    const rows = await asUser<{ output: unknown; status: string }>(
      db,
      A,
      `select output, status from public.ai_interactions where id = $1`,
      [id],
    )
    expect(rows[0]).toEqual({ output: { real: true }, status: 'ok' })
  })

  it('sin sesión no se puede abrir una consulta', async () => {
    await expect(
      db.query(`set role anon; select public.begin_ai_interaction('chat', null, 5)`),
    ).rejects.toThrow()
    await db.exec('reset role')
  })
})

describe('create_user_plan con origen', () => {
  it('guarda source = ai y las notas; la llamada de 4 argumentos sigue funcionando', async () => {
    await createPlan(B, '2026-10-05', 'ai')
    const ai = await asUser<{ source: string; notes: string; template_id: string | null }>(
      db,
      B,
      `select source, notes, template_id from public.user_plans where status = 'active'`,
    )
    expect(ai[0]).toEqual({ source: 'ai', notes: 'Resumen', template_id: null })
    await createPlan(B, '2026-10-12')
    const tpl = await asUser<{ source: string }>(
      db,
      B,
      `select source from public.user_plans where status = 'active'`,
    )
    expect(tpl[0]!.source).toBe('template')
    await expect(
      asUser(
        db,
        B,
        `select public.create_user_plan(null, 'x', '2026-10-05'::date, '[{}]'::jsonb, 'otro')`,
      ),
    ).rejects.toThrow(/origen/)
  })
})

describe('ajuste del día', () => {
  let planned: string

  async function proposal(user: string, adjust: unknown, plannedId = planned) {
    const id = await begin(user, 100)
    await finish(user, id, 'ok', { proposal: { plannedSessionId: plannedId, adjust, dropped: [] } })
    return id
  }

  async function plannedRow() {
    const rows = await asUser<{
      title: string
      intensity: string
      duration_min: number
      notes: string | null
      status: string
      heavy_legs: boolean
      blocks: unknown
      adjusted_from: unknown
    }>(
      db,
      A,
      `select title, intensity, duration_min, notes, status, heavy_legs, blocks, adjusted_from
       from public.planned_sessions where id = $1`,
      [planned],
    )
    return rows[0]!
  }

  beforeAll(async () => {
    planned = await createPlan(A, '2026-09-29')
  })

  const reduce = {
    decision: 'reduce',
    reason: 'Energía 1 y agujetas 5: hoy suave.',
    session: {
      title: 'Pierna suave',
      intensity: 'easy',
      heavy_legs: false,
      duration_min: 35,
      blocks: [
        {
          block_type: 'straight',
          exercises: [{ exercise_id: 'goblet_squat', sets: 2, reps: '10' }],
        },
      ],
    },
  }

  it('solo se aplica al aceptar: reduce cambia la sesión y guarda la original', async () => {
    const id = await proposal(A, reduce)
    expect((await plannedRow()).title).toBe('Pierna pesada')
    const res = await asUser<{ d: string }>(
      db,
      A,
      `select public.apply_daily_adjust($1, $2) as d`,
      [id, planned],
    )
    expect(res[0]!.d).toBe('reduce')
    const row = await plannedRow()
    expect(row).toMatchObject({
      title: 'Pierna suave',
      intensity: 'easy',
      duration_min: 35,
      heavy_legs: false,
      status: 'planned',
    })
    expect(row.notes).toContain('Ajustada por la IA')
    expect(row.adjusted_from).toMatchObject({
      title: 'Pierna pesada',
      intensity: 'hard',
      duration_min: 60,
    })
    const acc = await asUser<{ accepted: boolean }>(
      db,
      A,
      `select accepted from public.ai_interactions where id = $1`,
      [id],
    )
    expect(acc[0]!.accepted).toBe(true)
    // No se puede aplicar dos veces.
    await expect(
      asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [id, planned]),
    ).rejects.toThrow(/ya respondida/)
  })

  it('deshacer devuelve la prescripción original', async () => {
    await asUser(db, A, `select public.revert_daily_adjust($1)`, [planned])
    const row = await plannedRow()
    expect(row).toMatchObject({
      title: 'Pierna pesada',
      intensity: 'hard',
      duration_min: 60,
      status: 'planned',
    })
    expect(row.adjusted_from).toBeNull()
    expect(row.blocks).toEqual(blocks)
    await expect(asUser(db, A, `select public.revert_daily_adjust($1)`, [planned])).rejects.toThrow(
      /no hay ajuste/,
    )
  })

  it('descanso salta la sesión; keep no cambia nada', async () => {
    const keep = await proposal(A, { decision: 'keep', reason: 'Todo bien.' })
    await asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [keep, planned])
    expect((await plannedRow()).status).toBe('planned')
    expect((await plannedRow()).adjusted_from).toBeNull()

    const rest = await proposal(A, { decision: 'rest', reason: 'Mejor descansar.' })
    await asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [rest, planned])
    const row = await plannedRow()
    expect(row.status).toBe('skipped')
    expect(row.notes).toContain('Descanso (IA)')
    await asUser(db, A, `select public.revert_daily_adjust($1)`, [planned])
    expect((await plannedRow()).status).toBe('planned')
  })

  it('no se aplica a otra sesión, a otra persona ni una propuesta ajena', async () => {
    const other = await createPlan(B, '2026-09-29')
    const id = await proposal(A, reduce)
    await expect(
      asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [id, other]),
    ).rejects.toThrow(/propuesta no encontrada/)
    await expect(
      asUser(db, B, `select public.apply_daily_adjust($1, $2)`, [id, planned]),
    ).rejects.toThrow(/propuesta no encontrada/)
    const forB = await proposal(A, reduce, other)
    await expect(
      asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [forB, other]),
    ).rejects.toThrow(/no encontrada/)
    expect((await plannedRow()).title).toBe('Pierna pesada')
  })

  it('una propuesta reduce sin sesión no se aplica', async () => {
    const id = await proposal(A, { decision: 'reduce', reason: 'x' })
    await expect(
      asUser(db, A, `select public.apply_daily_adjust($1, $2)`, [id, planned]),
    ).rejects.toThrow(/no trae sesión/)
  })
})
