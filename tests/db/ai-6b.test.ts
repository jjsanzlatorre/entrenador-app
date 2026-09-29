// Fase 6B en la base de datos (0025): periodo de la revisión semanal, modelo que respondió,
// chat (ai_chat_messages + save_chat_turn) y aceptar / descartar cambios del plan propuestos
// (respond_ai_change).
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000006b1'
const B = '00000000-0000-4000-8000-0000000006b2'

let db: PGlite

// Días relativos a hoy (respond_ai_change no deja mover ni añadir al pasado).
function day(offset: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana6b@test.dev')
  await createUser(db, B, 'bea6b@test.dev')
})

async function begin(user: string, kind: string, period: string | null = null, limit = 100) {
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select public.begin_ai_interaction($1, '{}'::jsonb, $2, 'Europe/Madrid', 'gemini', 'principal', $3) as id`,
    [kind, limit, period],
  )
  return rows[0]!.id
}

async function finish(user: string, id: string, output: unknown, model: string | null = null) {
  await asUser(
    db,
    user,
    `select public.finish_ai_interaction($1, 'ok', $2::jsonb, 10, 5, null, $3)`,
    [id, JSON.stringify(output), model],
  )
}

async function interaction(user: string, id: string) {
  const rows = await asUser<{
    model: string
    period: string | null
    responses: Record<string, string>
    accepted: boolean | null
  }>(
    db,
    user,
    `select model, period, responses, accepted from public.ai_interactions where id = $1`,
    [id],
  )
  return rows[0]!
}

const blocks = [
  { block_type: 'straight', exercises: [{ exercise_id: 'back_squat', sets: 5, reps: '5' }] },
]

// Plan activo que empieza hoy con 3 sesiones pendientes; devuelve sus ids por orden de día.
async function createPlan(user: string) {
  const sessions = [0, 2, 4].map((offset, i) => ({
    date: day(offset),
    week: 1,
    session_type: 'strength',
    title: `Fuerza ${i + 1}`,
    intensity: 'hard',
    heavy_legs: true,
    duration_min: 60,
    blocks,
  }))
  await asUser(
    db,
    user,
    `select public.create_user_plan('strength_beginner', 'Plan', $1::date, $2::jsonb)`,
    [day(0), JSON.stringify(sessions)],
  )
  const rows = await asUser<{ id: string }>(
    db,
    user,
    `select ps.id from public.planned_sessions ps join public.user_plans up on up.id = ps.user_plan_id
     where up.status = 'active' and ps.user_id = $1 order by ps.date`,
    [user],
  )
  return rows.map((r) => r.id)
}

async function planned(user: string, id: string) {
  const rows = await asUser<{
    date: string
    original_date: string | null
    status: string
    title: string
    notes: string | null
    adjusted_from: unknown
  }>(
    db,
    user,
    `select date::text, original_date::text, status, title, notes, adjusted_from
     from public.planned_sessions where id = $1`,
    [id],
  )
  return rows[0]
}

async function respond(user: string, id: string, index: number, accept: boolean) {
  const rows = await asUser<{ r: string }>(
    db,
    user,
    `select public.respond_ai_change($1, $2, $3) as r`,
    [id, index, accept],
  )
  return rows[0]!.r
}

describe('revisión semanal: periodo y modelo', () => {
  it('guarda el periodo y el modelo que respondió (p. ej. el de reserva)', async () => {
    const id = await begin(A, 'weekly_review', '2026-09-21')
    await finish(A, id, { changes: [] }, 'reserva')
    expect(await interaction(A, id)).toMatchObject({ model: 'reserva', period: '2026-09-21' })
  })

  it('sin modelo en finish se queda el de begin', async () => {
    const id = await begin(A, 'daily_adjust')
    await finish(A, id, {})
    expect((await interaction(A, id)).model).toBe('principal')
  })

  it('dos revisiones de la misma semana a la vez: la segunda se rechaza', async () => {
    await begin(B, 'weekly_review', '2026-09-28')
    await expect(begin(B, 'weekly_review', '2026-09-28')).rejects.toThrow(/ai_in_progress/)
    // Otra semana u otro tipo sí.
    await begin(B, 'weekly_review', '2026-10-05')
    await begin(B, 'chat')
  })

  it('las llamadas antiguas (sin periodo ni modelo) siguen funcionando', async () => {
    const rows = await asUser<{ id: string }>(
      db,
      A,
      `select public.begin_ai_interaction('chat', '{}'::jsonb, 100, 'Europe/Madrid', 'gemini', 'm') as id`,
    )
    await asUser(db, A, `select public.finish_ai_interaction($1, 'ok', '{}'::jsonb, 1, 1, null)`, [
      rows[0]!.id,
    ])
  })
})

describe('chat', () => {
  it('save_chat_turn guarda la pregunta y la respuesta de una consulta válida, una vez', async () => {
    const id = await begin(A, 'chat')
    await finish(A, id, { reply: '¡Vas muy bien!', changes: [] })
    await asUser(db, A, `select public.save_chat_turn($1, $2)`, [id, '¿Qué tal voy?'])
    await asUser(db, A, `select public.save_chat_turn($1, $2)`, [id, '¿Qué tal voy?'])
    const rows = await asUser<{ role: string; content: string; interaction_id: string }>(
      db,
      A,
      `select role, content, interaction_id from public.ai_chat_messages order by seq`,
    )
    expect(rows).toEqual([
      { role: 'user', content: '¿Qué tal voy?', interaction_id: id },
      { role: 'assistant', content: '¡Vas muy bien!', interaction_id: id },
    ])
  })

  it('no se guarda con una consulta ajena, sin terminar o de otro tipo', async () => {
    const other = await begin(B, 'chat')
    await finish(B, other, { reply: 'hola' })
    await expect(asUser(db, A, `select public.save_chat_turn($1, 'x')`, [other])).rejects.toThrow(
      /no encontrada/,
    )
    const pending = await begin(A, 'chat')
    await expect(asUser(db, A, `select public.save_chat_turn($1, 'x')`, [pending])).rejects.toThrow(
      /no encontrada/,
    )
    const review = await begin(A, 'weekly_review', '2026-01-05')
    await finish(A, review, { reply: 'x' })
    await expect(asUser(db, A, `select public.save_chat_turn($1, 'x')`, [review])).rejects.toThrow(
      /no encontrada/,
    )
  })

  it('RLS: cada uno ve y borra solo lo suyo; sin insert ni update directos', async () => {
    await expect(
      asUser(
        db,
        A,
        `insert into public.ai_chat_messages (role, content) values ('assistant', 'x')`,
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, `update public.ai_chat_messages set content = 'x'`)).rejects.toThrow(
      /permission denied/,
    )
    const seenByB = await asUser(db, B, `select id from public.ai_chat_messages`)
    expect(seenByB).toEqual([])
    const deletedByB = await asUser(db, B, `delete from public.ai_chat_messages returning id`)
    expect(deletedByB).toEqual([])
    const deletedByA = await asUser(db, A, `delete from public.ai_chat_messages returning id`)
    expect(deletedByA).toHaveLength(2)
  })
})

describe('cambios propuestos (respond_ai_change)', () => {
  let ids: string[]
  let proposal: string

  const session = {
    title: 'Fuerza suave',
    intensity: 'easy',
    heavy_legs: false,
    duration_min: 40,
    blocks: [
      { block_type: 'straight', exercises: [{ exercise_id: 'goblet_squat', sets: 2, reps: '10' }] },
    ],
  }

  beforeAll(async () => {
    ids = await createPlan(A)
    proposal = await begin(A, 'weekly_review', '2026-02-02')
    await finish(A, proposal, {
      changes: [
        {
          action: 'modify',
          planned_session_id: ids[0],
          title: 'Más suave',
          reason: 'Carga alta',
          session,
        },
        {
          action: 'move',
          planned_session_id: ids[1],
          date: day(3),
          title: 'Al día siguiente',
          reason: 'x',
        },
        { action: 'skip', planned_session_id: ids[2], title: 'Descansa', reason: 'Agujetas' },
        {
          action: 'add',
          date: day(5),
          title: 'Rodaje',
          reason: 'Vas bien',
          session: { ...session, session_type: 'running', title: 'Rodaje suave' },
        },
        { action: 'skip', planned_session_id: ids[0], title: 'Otra', reason: 'x' },
      ],
    })
  })

  it('nada cambia hasta aceptar; modify guarda la original y se puede deshacer', async () => {
    expect((await planned(A, ids[0]!))!.title).toBe('Fuerza 1')
    expect(await respond(A, proposal, 0, true)).toBe('modify')
    const row = await planned(A, ids[0]!)
    expect(row).toMatchObject({ title: 'Fuerza suave', status: 'planned' })
    expect(row!.notes).toContain('Cambio de la IA: Carga alta')
    expect(row!.adjusted_from).toMatchObject({ title: 'Fuerza 1', intensity: 'hard' })
    await asUser(db, A, `select public.revert_daily_adjust($1)`, [ids[0]])
    expect((await planned(A, ids[0]!))!.title).toBe('Fuerza 1')
  })

  it('move cambia el día y guarda el original', async () => {
    expect(await respond(A, proposal, 1, true)).toBe('move')
    expect(await planned(A, ids[1]!)).toMatchObject({
      date: day(3),
      original_date: day(2),
      status: 'moved',
    })
  })

  it('skip la cambia por descanso; add crea una sesión en el plan activo', async () => {
    expect(await respond(A, proposal, 2, true)).toBe('skip')
    expect(await planned(A, ids[2]!)).toMatchObject({ status: 'skipped' })
    expect(await respond(A, proposal, 3, true)).toBe('add')
    const added = await asUser<{
      title: string
      session_type: string
      date: string
      status: string
    }>(
      db,
      A,
      `select title, session_type, date::text, status from public.planned_sessions
       where user_id = $1 and title = 'Rodaje suave'`,
      [A],
    )
    expect(added).toEqual([
      { title: 'Rodaje suave', session_type: 'running', date: day(5), status: 'planned' },
    ])
  })

  it('cada cambio se responde una vez; descartar no toca el plan', async () => {
    await expect(respond(A, proposal, 1, true)).rejects.toThrow(/ya respondido/)
    expect(await respond(A, proposal, 4, false)).toBe('discarded')
    expect((await planned(A, ids[0]!))!.status).toBe('planned')
    expect(await interaction(A, proposal)).toMatchObject({
      accepted: true,
      responses: {
        '0': 'accepted',
        '1': 'accepted',
        '2': 'accepted',
        '3': 'accepted',
        '4': 'discarded',
      },
    })
    await expect(respond(A, proposal, 9, true)).rejects.toThrow(/no encontrado/)
  })

  it('descartarlo todo deja la propuesta como no aceptada', async () => {
    const id = await begin(A, 'chat')
    await finish(A, id, {
      reply: 'ok',
      changes: [{ action: 'skip', planned_session_id: ids[0], title: 'x', reason: 'x' }],
    })
    await respond(A, id, 0, false)
    expect((await interaction(A, id)).accepted).toBe(false)
  })

  it('no se aplica una propuesta ajena, ni sobre una sesión ajena o ya no pendiente', async () => {
    await expect(respond(B, proposal, 0, true)).rejects.toThrow(/no encontrada/)
    const bIds = await createPlan(B)
    const onOther = await begin(A, 'chat')
    await finish(A, onOther, {
      reply: 'x',
      changes: [
        { action: 'skip', planned_session_id: bIds[0], title: 'x', reason: 'x' },
        { action: 'skip', planned_session_id: ids[2], title: 'ya saltada', reason: 'x' },
        {
          action: 'move',
          planned_session_id: ids[0],
          date: day(-10),
          title: 'pasado',
          reason: 'x',
        },
      ],
    })
    await expect(respond(A, onOther, 0, true)).rejects.toThrow(/no encontrada/)
    expect((await planned(B, bIds[0]!))!.status).toBe('planned')
    await expect(respond(A, onOther, 1, true)).rejects.toThrow(/ya no está pendiente/)
    await expect(respond(A, onOther, 2, true)).rejects.toThrow(/fecha no válida/)
    // Un fallo no deja el cambio como respondido.
    expect((await interaction(A, onOther)).responses).toEqual({})
  })

  it('los ajustes del día no se responden por aquí', async () => {
    const adjust = await begin(A, 'daily_adjust')
    await finish(A, adjust, { changes: [{ action: 'skip', planned_session_id: ids[0] }] })
    await expect(respond(A, adjust, 0, true)).rejects.toThrow(/no encontrada/)
  })
})
