// Fase 5A en la base de datos: plantillas, planes, sesiones planificadas y su enlace.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a5'
const B = '00000000-0000-4000-8000-0000000000b5'

let seq = 0
const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

let db: PGlite

function sessions(dates: string[]) {
  return JSON.stringify(
    dates.map((date, i) => ({
      date,
      week: 1,
      session_type: 'strength',
      title: `Sesión ${i + 1}`,
      intensity: 'moderate',
      duration_min: 60,
      notes: null,
      blocks: [{ block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3 }] }],
    })),
  )
}

async function createPlan(user: string, start: string, dates: string[]) {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.create_user_plan('hybrid_beginner', 'Híbrido', $1::date, $2::jsonb) as id`,
    [start, sessions(dates)],
  )
  return rows[0]!.id
}

async function plannedIds(user: string, plan: string) {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    'select id from public.planned_sessions where user_plan_id = $1 order by date',
    [plan],
  )
  return rows.map((r) => r.id)
}

async function saveWorkout(user: string, planned: string | null, ended = true) {
  const id = uuid('10000000')
  const payload = {
    session: {
      id,
      planned_session_id: planned,
      session_type: 'strength',
      title: 'Test',
      started_at: '2026-10-05T09:00:00Z',
      ended_at: ended ? '2026-10-05T10:00:00Z' : null,
      duration_min: 60,
      rpe: 7,
      client_rev: 1,
    },
    blocks: [],
    sets: [],
  }
  await asUser(db, user, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload)])
  return id
}

const status = async (user: string, id: string) =>
  (
    await asUser<{ status: string; workout_session_id: string | null }>(
      db,
      user,
      'select status, workout_session_id from public.planned_sessions where id = $1',
      [id],
    )
  )[0]

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana@test.dev')
  await createUser(db, B, 'bea@test.dev')
})

describe('plan_templates', () => {
  it('12 plantillas sembradas y de solo lectura', async () => {
    const rows = await asUser<{ id: string; days_per_week: number }>(
      db,
      A,
      'select id, days_per_week from public.plan_templates order by id',
    )
    expect(rows).toHaveLength(12)
    expect(rows.find((r) => r.id === 'hybrid_beginner')?.days_per_week).toBe(4)
    await expect(
      asUser(db, A, "update public.plan_templates set name = 'x' where id = 'hybrid_beginner'"),
    ).rejects.toThrow()
    await expect(
      asUser(
        db,
        A,
        `insert into public.plan_templates (id, family, name, level, days_per_week, structure)
         values ('x', 'hybrid', 'x', 'beginner', 3, '{}')`,
      ),
    ).rejects.toThrow()
  })

  it('los ejercicios nuevos de DEKA existen con músculos', async () => {
    const rows = await asUser<{ exercise_id: string }>(
      db,
      A,
      `select distinct exercise_id from public.exercise_muscles
       where exercise_id in ('ram_reverse_lunge', 'tank_push_pull', 'ram_burpee')`,
    )
    expect(rows).toHaveLength(3)
  })
})

describe('create_user_plan', () => {
  it('crea el plan con sus sesiones; al crear otro, archiva el anterior', async () => {
    const first = await createPlan(A, '2026-10-05', ['2026-10-05', '2026-10-07', '2026-10-09'])
    expect(await plannedIds(A, first)).toHaveLength(3)

    const second = await createPlan(A, '2026-10-12', ['2026-10-12', '2026-10-14'])
    const plans = await asUser<{ id: string; status: string }>(
      db,
      A,
      'select id, status from public.user_plans order by created_at',
    )
    expect(plans.find((p) => p.id === first)?.status).toBe('archived')
    expect(plans.find((p) => p.id === second)?.status).toBe('active')
    expect(plans.filter((p) => p.status === 'active')).toHaveLength(1)
    // Las del plan anterior ya pasadas se conservan (lo hecho no se pierde).
    expect(await plannedIds(A, first)).toHaveLength(3)
  })

  it('RLS: B no ve ni toca los planes de A; no se puede insertar a mano', async () => {
    expect(await asUser(db, B, 'select * from public.user_plans')).toHaveLength(0)
    expect(await asUser(db, B, 'select * from public.planned_sessions')).toHaveLength(0)
    await expect(
      asUser(db, A, `insert into public.user_plans (name, start_date) values ('x', '2026-10-05')`),
    ).rejects.toThrow()
    const plan = (
      await asUser<{ id: string }>(
        db,
        A,
        "select id from public.user_plans where status = 'active'",
      )
    )[0]!.id
    await expect(
      asUser(
        db,
        A,
        `insert into public.planned_sessions (user_plan_id, date, session_type, title)
         values ($1, '2026-10-05', 'strength', 'x')`,
        [plan],
      ),
    ).rejects.toThrow()
    const updated = await asUser(
      db,
      B,
      "update public.planned_sessions set status = 'skipped' returning id",
    )
    expect(updated).toHaveLength(0)
  })

  it('mover y saltar: solo día y estado; el enlace no se puede escribir a mano', async () => {
    const plan = await createPlan(A, '2026-10-19', ['2026-10-19'])
    const [id] = await plannedIds(A, plan)
    await asUser(
      db,
      A,
      "update public.planned_sessions set date = '2026-10-20', original_date = '2026-10-19', status = 'moved' where id = $1",
      [id],
    )
    expect((await status(A, id!))?.status).toBe('moved')
    const workout = await saveWorkout(A, null)
    await expect(
      asUser(db, A, 'update public.planned_sessions set workout_session_id = $1 where id = $2', [
        workout,
        id,
      ]),
    ).rejects.toThrow()
  })
})

describe('enlace sesión registrada ↔ planificada', () => {
  it('guardar una sesión terminada desde el plan la marca hecha; borrarla la devuelve a pendiente', async () => {
    const plan = await createPlan(A, '2026-10-26', ['2026-10-26', '2026-10-28'])
    const [p1, p2] = await plannedIds(A, plan)

    // Sin terminar todavía: no se marca.
    const workout = await saveWorkout(A, p1!, false)
    expect(await status(A, p1!)).toEqual({ status: 'planned', workout_session_id: null })

    // Al terminarla (se vuelve a guardar la misma sesión) sí.
    await asUser(
      db,
      A,
      `update public.workout_sessions set ended_at = '2026-10-26T10:00:00Z' where id = $1`,
      [workout],
    )
    expect(await status(A, p1!)).toEqual({ status: 'done', workout_session_id: workout })

    // Cambiar el enlace a otra planificada: la primera vuelve a pendiente.
    await asUser(
      db,
      A,
      'update public.workout_sessions set planned_session_id = $1 where id = $2',
      [p2, workout],
    )
    expect(await status(A, p1!)).toEqual({ status: 'planned', workout_session_id: null })
    expect(await status(A, p2!)).toEqual({ status: 'done', workout_session_id: workout })

    await asUser(db, A, 'delete from public.workout_sessions where id = $1', [workout])
    expect(await status(A, p2!)).toEqual({ status: 'planned', workout_session_id: null })
  })

  it('set_planned_session_done: con o sin sesión, deshacer y nunca con sesiones ajenas', async () => {
    const plan = await createPlan(A, '2026-11-02', ['2026-11-02', '2026-11-04'])
    const [p1, p2] = await plannedIds(A, plan)
    const workout = await saveWorkout(A, null)

    await asUser(db, A, 'select public.set_planned_session_done($1, true, $2)', [p1, workout])
    expect(await status(A, p1!)).toEqual({ status: 'done', workout_session_id: workout })
    const linked = await asUser<{ planned_session_id: string }>(
      db,
      A,
      'select planned_session_id from public.workout_sessions where id = $1',
      [workout],
    )
    expect(linked[0]!.planned_session_id).toBe(p1)

    // La misma sesión a otra planificada: la primera se libera.
    await asUser(db, A, 'select public.set_planned_session_done($1, true, $2)', [p2, workout])
    expect(await status(A, p1!)).toEqual({ status: 'planned', workout_session_id: null })
    expect(await status(A, p2!)).toEqual({ status: 'done', workout_session_id: workout })

    // Deshacer.
    await asUser(db, A, 'select public.set_planned_session_done($1, false)', [p2])
    expect(await status(A, p2!)).toEqual({ status: 'planned', workout_session_id: null })

    // Hecha sin sesión.
    await asUser(db, A, 'select public.set_planned_session_done($1, true)', [p1])
    expect(await status(A, p1!)).toEqual({ status: 'done', workout_session_id: null })

    // B no puede tocar la planificada de A ni enlazar la sesión de A.
    await expect(
      asUser(db, B, 'select public.set_planned_session_done($1, false)', [p1]),
    ).rejects.toThrow()
    const bPlan = await createPlan(B, '2026-11-02', ['2026-11-02'])
    const [bp] = await plannedIds(B, bPlan)
    await expect(
      asUser(db, B, 'select public.set_planned_session_done($1, true, $2)', [bp, workout]),
    ).rejects.toThrow()
  })

  it('el trigger no marca planificadas de otro usuario', async () => {
    const plan = await createPlan(A, '2026-11-09', ['2026-11-09'])
    const [p] = await plannedIds(A, plan)
    await saveWorkout(B, p!)
    expect(await status(A, p!)).toEqual({ status: 'planned', workout_session_id: null })
  })
})
