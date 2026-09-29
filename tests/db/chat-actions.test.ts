// Acciones del chat en la base de datos (0033): enlazar el plan generado, crearlo al aceptar (con
// el resultado real), ajuste del día desde el chat y descartar. Todo solo con la cuenta propia.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000033a1'
const B = '00000000-0000-4000-8000-0000000033b2'

let db: PGlite

function day(offset: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana33@test.dev')
  await createUser(db, B, 'bea33@test.dev')
})

async function interaction(user: string, kind: string, output: unknown) {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.begin_ai_interaction($1, '{}'::jsonb, 100, 'Europe/Madrid', 'gemini', 'm', null) as id`,
    [kind],
  )
  const id = rows[0]!.id
  await asUser(
    db,
    user,
    `select public.finish_ai_interaction($1, 'ok', $2::jsonb, 1, 1, null, 'm')`,
    [id, JSON.stringify(output)],
  )
  return id
}

const blocks = [
  { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 3, reps: '8' }] },
]

// 3 días × 4 semanas desde `start`.
function sessions(start: string) {
  const base = new Date(`${start}T00:00:00Z`)
  return [0, 1, 2, 3].flatMap((w) =>
    [0, 2, 4].map((d, i) => {
      const date = new Date(base)
      date.setUTCDate(base.getUTCDate() + w * 7 + d)
      return {
        date: date.toISOString().slice(0, 10),
        week: w + 1,
        session_type: 'strength',
        title: `Fuerza ${i + 1}`,
        intensity: 'moderate',
        heavy_legs: false,
        duration_min: 60,
        blocks,
      }
    }),
  )
}

const planRequest = {
  family: 'strength',
  days_per_week: 3,
  title: 'Plan de fuerza',
  reason: 'Lo has pedido',
}

async function chatWithPlan(user: string) {
  const chat = await interaction(user, 'chat', {
    reply: 'Te propongo un plan.',
    changes: [],
    dropped: [],
    plan_request: planRequest,
  })
  const plan = await interaction(user, 'plan_generation', {
    proposal: {
      name: 'Fuerza IA',
      summary: 'Plan de 3 días',
      baseTemplateId: 'strength_beginner',
      structure: { weeks: [] },
      dropped: [],
    },
  })
  return { chat, plan }
}

async function results(user: string, id: string) {
  const rows = await asUser<{ action_results: Record<string, Record<string, unknown>> }>(
    db,
    user,
    `select action_results from public.ai_interactions where id = $1`,
    [id],
  )
  return rows[0]!.action_results
}

describe('create_plan desde el chat', () => {
  it('enlaza, crea el plan y devuelve lo que ha quedado en la base de datos', async () => {
    // Plan anterior activo con una sesión pendiente futura.
    await asUser(
      db,
      A,
      `select public.create_user_plan('strength_beginner', 'Plan viejo', $1::date, $2::jsonb)`,
      [day(-7), JSON.stringify(sessions(day(-7)).slice(0, 6))],
    )
    const { chat, plan } = await chatWithPlan(A)
    await asUser(db, A, `select public.link_chat_plan($1, $2)`, [chat, plan])
    expect((await results(A, chat)).plan).toEqual({ status: 'prepared', interaction_id: plan })

    const start = day(1)
    const rows = await asUser<{ r: Record<string, unknown> }>(
      db,
      A,
      `select public.accept_chat_plan($1, '', $2::date, $3::jsonb) as r`,
      [chat, start, JSON.stringify(sessions(start))],
    )
    const r = rows[0]!.r
    expect(r).toMatchObject({
      status: 'accepted',
      name: 'Fuerza IA',
      start_date: start,
      sessions: 12,
      weeks: 4,
      per_week: 3,
      replaced: 'Plan viejo',
    })
    // Está en el calendario y el anterior queda archivado (no borrado).
    const plans = await asUser<{ name: string; status: string; source: string }>(
      db,
      A,
      `select name, status, source from public.user_plans where user_id = $1 order by created_at`,
      [A],
    )
    expect(plans).toEqual([
      { name: 'Plan viejo', status: 'archived', source: 'template' },
      { name: 'Fuerza IA', status: 'active', source: 'ai' },
    ])
    const count = await asUser<{ n: number }>(
      db,
      A,
      `select count(*)::int as n from public.planned_sessions ps
       join public.user_plans up on up.id = ps.user_plan_id
       where up.status = 'active' and ps.user_id = $1`,
      [A],
    )
    expect(count[0]!.n).toBe(12)
    expect((await results(A, chat)).plan).toMatchObject({ status: 'accepted', plan_id: r.plan_id })
    const accepted = await asUser<{ accepted: boolean }>(
      db,
      A,
      `select accepted from public.ai_interactions where id = $1`,
      [plan],
    )
    expect(accepted[0]!.accepted).toBe(true)

    // No se crea dos veces.
    await expect(
      asUser(db, A, `select public.accept_chat_plan($1, 'x', $2::date, $3::jsonb)`, [
        chat,
        start,
        JSON.stringify(sessions(start)),
      ]),
    ).rejects.toThrow(/ya se ha creado/)
  })

  it('sin plan preparado no se crea nada', async () => {
    const { chat } = await chatWithPlan(A)
    await expect(
      asUser(db, A, `select public.accept_chat_plan($1, 'x', $2::date, $3::jsonb)`, [
        chat,
        day(1),
        JSON.stringify(sessions(day(1))),
      ]),
    ).rejects.toThrow(/ningún plan preparado/)
  })

  it('una respuesta sin create_plan no se puede enlazar', async () => {
    const chat = await interaction(A, 'chat', { reply: 'Hola', changes: [], dropped: [] })
    const { plan } = await chatWithPlan(A)
    await expect(
      asUser(db, A, `select public.link_chat_plan($1, $2)`, [chat, plan]),
    ).rejects.toThrow(/no propone un plan/)
  })

  it('nadie usa las propuestas de otra persona', async () => {
    const { chat, plan } = await chatWithPlan(A)
    await expect(
      asUser(db, B, `select public.link_chat_plan($1, $2)`, [chat, plan]),
    ).rejects.toThrow(/no encontrada/)
    const mine = await chatWithPlan(B)
    await expect(
      asUser(db, B, `select public.link_chat_plan($1, $2)`, [mine.chat, plan]),
    ).rejects.toThrow(/plan no encontrado/)
    await asUser(db, A, `select public.link_chat_plan($1, $2)`, [chat, plan])
    await expect(
      asUser(db, B, `select public.accept_chat_plan($1, 'x', $2::date, $3::jsonb)`, [
        chat,
        day(1),
        JSON.stringify(sessions(day(1))),
      ]),
    ).rejects.toThrow(/no encontrada/)
  })

  it('descartar deja la propuesta descartada y ya no se puede crear', async () => {
    const { chat, plan } = await chatWithPlan(A)
    await asUser(db, A, `select public.link_chat_plan($1, $2)`, [chat, plan])
    await asUser(db, A, `select public.discard_chat_action($1, 'plan')`, [chat])
    expect((await results(A, chat)).plan).toEqual({ status: 'discarded' })
    await expect(
      asUser(db, A, `select public.accept_chat_plan($1, 'x', $2::date, $3::jsonb)`, [
        chat,
        day(1),
        JSON.stringify(sessions(day(1))),
      ]),
    ).rejects.toThrow(/ningún plan preparado/)
    await expect(
      asUser(db, A, `select public.discard_chat_action($1, 'otra')`, [chat]),
    ).rejects.toThrow(/acción no válida/)
  })

  it('action_results no se puede escribir directamente', async () => {
    const { chat } = await chatWithPlan(A)
    await expect(
      asUser(
        db,
        A,
        `update public.ai_interactions set action_results = '{}'::jsonb where id = $1`,
        [chat],
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('adjust_today desde el chat', () => {
  it('aplica el ajuste del día y guarda el resultado', async () => {
    const today = day(0)
    await asUser(
      db,
      B,
      `select public.create_user_plan('strength_beginner', 'Plan B', $1::date, $2::jsonb)`,
      [today, JSON.stringify(sessions(today).slice(0, 3))],
    )
    const ps = await asUser<{ id: string }>(
      db,
      B,
      `select ps.id from public.planned_sessions ps join public.user_plans up on up.id = ps.user_plan_id
       where up.status = 'active' and ps.user_id = $1 and ps.date = $2::date`,
      [B, today],
    )
    const planned = ps[0]!.id
    const chat = await interaction(B, 'chat', {
      reply: 'Te propongo revisar hoy.',
      changes: [],
      dropped: [],
      adjust_today: { title: 'Revisar hoy', reason: 'Cansancio', planned_session_id: planned },
    })
    const adjust = await interaction(B, 'daily_adjust', {
      proposal: {
        plannedSessionId: planned,
        adjust: { decision: 'rest', reason: 'Descansa hoy' },
        dropped: [],
      },
    })
    const rows = await asUser<{ r: Record<string, unknown> }>(
      db,
      B,
      `select public.apply_chat_adjust($1, $2, $3) as r`,
      [chat, adjust, planned],
    )
    expect(rows[0]!.r).toMatchObject({
      status: 'accepted',
      decision: 'rest',
      planned_session_id: planned,
      date: today,
      session_status: 'skipped',
    })
    expect((await results(B, chat)).adjust).toMatchObject({ status: 'accepted', decision: 'rest' })
    await expect(
      asUser(db, B, `select public.apply_chat_adjust($1, $2, $3)`, [chat, adjust, planned]),
    ).rejects.toThrow(/ya respondida/)
  })

  it('una respuesta sin adjust_today no aplica ajustes', async () => {
    const chat = await interaction(B, 'chat', { reply: 'Hola', changes: [], dropped: [] })
    await expect(
      asUser(db, B, `select public.apply_chat_adjust($1, $1, $1)`, [chat]),
    ).rejects.toThrow(/no propone un ajuste/)
  })
})
