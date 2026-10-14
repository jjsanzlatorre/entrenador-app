// Mover sesiones y el plan entero (0043): apply_plan_change aplica la lista de cambios en una
// transacción, solo sobre sesiones pendientes del plan activo propio, y undo_plan_change deshace
// el último cambio sin tocar lo hecho después.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000043a1'
const B = '00000000-0000-4000-8000-0000000043b2'

let db: PGlite

function day(offset: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana43@test.dev')
  await createUser(db, B, 'bea43@test.dev')
})

type Row = { id: string; date: string; status: string; original_date: string | null; title: string }

async function newPlan(user: string, offsets: number[]) {
  const sessions = offsets.map((o, i) => ({
    date: day(o),
    week: 1,
    session_type: 'strength',
    title: `S${i + 1}`,
    intensity: 'moderate',
    heavy_legs: i === 0,
    duration_min: 60,
    blocks: [{ block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3 }] }],
  }))
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.create_user_plan('strength_beginner', 'Fuerza', $1::date, $2::jsonb) as id`,
    [day(offsets[0]!), JSON.stringify(sessions)],
  )
  return rows[0]!.id
}

async function sessionsOf(user: string, plan: string) {
  return asUser<Row>(
    db,
    user,
    `select id, date::text as date, status, original_date::text as original_date, title
     from public.planned_sessions where user_plan_id = $1 order by date, title`,
    [plan],
  )
}

async function apply(
  user: string,
  plan: string,
  kind: string,
  moves: { id: string; date: string }[],
  copies: { source_id: string; date: string }[] = [],
  newStart: string | null = null,
  params: Record<string, unknown> = {},
) {
  const rows = await asUser<{ r: { change_id: string; moved: number; inserted: number } }>(
    db,
    user,
    `select public.apply_plan_change($1, $2, $3::jsonb, $4::jsonb, $5::date, $6::jsonb) as r`,
    [plan, kind, JSON.stringify(moves), JSON.stringify(copies), newStart, JSON.stringify(params)],
  )
  return rows[0]!.r
}

async function undo(user: string, change: string) {
  const rows = await asUser<{ r: { restored: number; removed: number } }>(
    db,
    user,
    `select public.undo_plan_change($1) as r`,
    [change],
  )
  return rows[0]!.r
}

describe('apply_plan_change / undo_plan_change', () => {
  it('mover marca «movida» con el día original y deshacer lo devuelve', async () => {
    const plan = await newPlan(A, [1, 3, 5])
    const [s1] = await sessionsOf(A, plan)
    const r = await apply(A, plan, 'move', [{ id: s1!.id, date: day(2) }])
    expect(r.moved).toBe(1)
    let rows = await sessionsOf(A, plan)
    const moved = rows.find((x) => x.id === s1!.id)!
    expect(moved).toMatchObject({ date: day(2), status: 'moved', original_date: day(1) })

    await undo(A, r.change_id)
    rows = await sessionsOf(A, plan)
    expect(rows.find((x) => x.id === s1!.id)).toMatchObject({
      date: day(1),
      status: 'planned',
      original_date: null,
    })
    // Ya deshecho: no se deshace dos veces.
    await expect(undo(A, r.change_id)).rejects.toThrow(/deshecho/)
  })

  it('intercambiar cambia las dos fechas en una sola transacción', async () => {
    const plan = await newPlan(A, [1, 3, 5])
    const [s1, s2] = await sessionsOf(A, plan)
    await apply(A, plan, 'swap', [
      { id: s1!.id, date: s2!.date },
      { id: s2!.id, date: s1!.date },
    ])
    const rows = await sessionsOf(A, plan)
    expect(rows.find((x) => x.id === s1!.id)!.date).toBe(day(3))
    expect(rows.find((x) => x.id === s2!.id)!.date).toBe(day(1))
  })

  it('desplazar y pausar solo cambian la fecha (no «movida») y pueden mover el inicio', async () => {
    const plan = await newPlan(A, [2, 4, 6])
    const rows = await sessionsOf(A, plan)
    const r = await apply(
      A,
      plan,
      'pause',
      rows.map((x) => ({ id: x.id, date: day(Number(x.title.slice(1)) * 2 + 7) })),
      [],
      day(9),
      { from: day(0), until: day(6) },
    )
    const after = await sessionsOf(A, plan)
    expect(after.every((x) => x.status === 'planned' && x.original_date === null)).toBe(true)
    expect(after.map((x) => x.date)).toEqual([day(9), day(11), day(13)])
    const start = await asUser<{ start_date: string }>(
      db,
      A,
      `select start_date::text as start_date from public.user_plans where id = $1`,
      [plan],
    )
    expect(start[0]!.start_date).toBe(day(9))
    const changes = await asUser<{ kind: string; params: { until: string } }>(
      db,
      A,
      `select kind, params from public.plan_changes where id = $1`,
      [r.change_id],
    )
    expect(changes[0]).toMatchObject({ kind: 'pause', params: { until: day(6) } })

    await undo(A, r.change_id)
    expect((await sessionsOf(A, plan)).map((x) => x.date)).toEqual([day(2), day(4), day(6)])
    const back = await asUser<{ start_date: string }>(
      db,
      A,
      `select start_date::text as start_date from public.user_plans where id = $1`,
      [plan],
    )
    expect(back[0]!.start_date).toBe(day(2))
  })

  it('repetir semana copia la sesión (misma prescripción) y deshacer borra la copia', async () => {
    const plan = await newPlan(A, [1, 3])
    const [s1, s2] = await sessionsOf(A, plan)
    const r = await apply(
      A,
      plan,
      'repeat',
      [{ id: s2!.id, date: day(10) }],
      [{ source_id: s1!.id, date: day(8) }],
    )
    expect(r.inserted).toBe(1)
    const rows = await asUser<{
      title: string
      heavy_legs: boolean
      blocks: unknown
      status: string
    }>(
      db,
      A,
      `select title, heavy_legs, blocks, status from public.planned_sessions
       where user_plan_id = $1 and date = $2`,
      [plan, day(8)],
    )
    expect(rows[0]).toMatchObject({ title: 'S1', heavy_legs: true, status: 'planned' })
    expect(rows[0]!.blocks).toEqual([
      { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3 }] },
    ])

    const u = await undo(A, r.change_id)
    expect(u).toEqual({ restored: 1, removed: 1 })
    expect((await sessionsOf(A, plan)).map((x) => x.date)).toEqual([day(1), day(3)])
  })

  it('solo pendientes del plan propio; todo o nada', async () => {
    const plan = await newPlan(A, [1, 3])
    const [s1, s2] = await sessionsOf(A, plan)
    await asUser(db, A, `update public.planned_sessions set status = 'done' where id = $1`, [
      s2!.id,
    ])
    // Una hecha en la lista: no se mueve nada (ni la pendiente).
    await expect(
      apply(A, plan, 'shift', [
        { id: s1!.id, date: day(8) },
        { id: s2!.id, date: day(10) },
      ]),
    ).rejects.toThrow(/pendientes/)
    expect((await sessionsOf(A, plan)).find((x) => x.id === s1!.id)!.date).toBe(day(1))

    // Repetida, vacía, tipo desconocido.
    await expect(
      apply(A, plan, 'move', [
        { id: s1!.id, date: day(2) },
        { id: s1!.id, date: day(4) },
      ]),
    ).rejects.toThrow(/repetida/)
    await expect(apply(A, plan, 'move', [])).rejects.toThrow(/nada/)
    await expect(apply(A, plan, 'teleport', [{ id: s1!.id, date: day(2) }])).rejects.toThrow()

    // Otra persona: ni su plan ni sus sesiones.
    const other = await newPlan(B, [1])
    const [b1] = await sessionsOf(B, other)
    await expect(apply(A, other, 'move', [{ id: b1!.id, date: day(2) }])).rejects.toThrow(
      /plan no encontrado/,
    )
    await expect(apply(A, plan, 'move', [{ id: b1!.id, date: day(2) }])).rejects.toThrow(
      /pendientes/,
    )
    await expect(
      apply(A, plan, 'repeat', [], [{ source_id: b1!.id, date: day(9) }]),
    ).rejects.toThrow(/sesión no válida/)
    expect((await sessionsOf(B, other))[0]!.date).toBe(day(1))
  })

  it('deshacer: solo el último cambio, sin tocar lo hecho después ni planes ajenos', async () => {
    const plan = await newPlan(A, [1, 3, 5])
    const [s1, s2] = await sessionsOf(A, plan)
    const first = await apply(A, plan, 'move', [{ id: s1!.id, date: day(2) }])
    const second = await apply(A, plan, 'move', [{ id: s2!.id, date: day(4) }])
    await expect(undo(A, first.change_id)).rejects.toThrow(/último/)
    await expect(undo(B, second.change_id)).rejects.toThrow(/no encontrado/)

    // La sesión movida se hace antes de deshacer: se queda donde está.
    await asUser(db, A, `update public.planned_sessions set status = 'done' where id = $1`, [
      s2!.id,
    ])
    const u = await undo(A, second.change_id)
    expect(u.restored).toBe(0)
    expect((await sessionsOf(A, plan)).find((x) => x.id === s2!.id)).toMatchObject({
      date: day(4),
      status: 'done',
    })
    // Ahora sí se puede deshacer el primero.
    await undo(A, first.change_id)
    expect((await sessionsOf(A, plan)).find((x) => x.id === s1!.id)!.date).toBe(day(1))
  })

  it('plan_changes: solo lectura propia', async () => {
    const plan = await newPlan(A, [1])
    const [s1] = await sessionsOf(A, plan)
    await apply(A, plan, 'move', [{ id: s1!.id, date: day(2) }])
    const mine = await asUser<{ n: number }>(
      db,
      A,
      `select count(*)::int as n from public.plan_changes`,
    )
    expect(mine[0]!.n).toBeGreaterThan(0)
    const theirs = await asUser<{ n: number }>(
      db,
      B,
      `select count(*)::int as n from public.plan_changes where user_id = $1`,
      [A],
    )
    expect(theirs[0]!.n).toBe(0)
    await expect(asUser(db, A, `update public.plan_changes set undone_at = now()`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      asUser(db, A, `insert into public.plan_changes (user_plan_id, kind) values ($1, 'move')`, [
        plan,
      ]),
    ).rejects.toThrow(/permission denied/)
  })
})
