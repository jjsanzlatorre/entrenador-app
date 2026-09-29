// Fase 7A en la base de datos: permisos por persona vinculada (cada uno activado y desactivado),
// fotos siempre privadas, invitaciones a entrenar juntos y reacciones.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a7' // comparte
const B = '00000000-0000-4000-8000-0000000000b7' // ve
const C = '00000000-0000-4000-8000-0000000000c7' // tercero sin vínculo con A
const SESSION = '10000000-0000-4000-8000-000000000001'
const CARDIO = '10000000-0000-4000-8000-000000000002'
const OWN_EXERCISE = 'u_a7_press'

let db: PGlite

const PERMS = ['adherence', 'sessions', 'muscles', 'achievements', 'metrics'] as const
type Perm = (typeof PERMS)[number]

// Deja en la fila A → B exactamente los permisos indicados.
async function share(...perms: Perm[]) {
  const cols = PERMS.map((p) => `can_view_${p} = ${perms.includes(p)}`).join(', ')
  const rows = await asUser(
    db,
    A,
    `update public.partner_links set ${cols} where user_id = $1 and partner_id = $2 returning id`,
    [A, B],
  )
  expect(rows).toHaveLength(1)
}

const count = async (uid: string, sql: string, params: unknown[] = []) =>
  (await asUser(db, uid, sql, params)).length

type LogRow = {
  id: string
  rpe: number | null
  distance_m: string | null
  tonnage_kg: string | null
  total_reps: number | null
}
const partnerLog = (uid = B) =>
  asUser<LogRow>(db, uid, 'select * from public.partner_session_log($1)', [A])
const partnerSets = (uid = B) =>
  asUser(db, uid, "select * from public.partner_exercise_sets($1, '2026-01-01', '2027-01-01')", [A])
const partnerHome = (uid = B) =>
  asUser<{ home_city: string }>(db, uid, 'select * from public.partner_home($1)', [A])

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana7@test.dev')
  await createUser(db, B, 'bea7@test.dev')
  await createUser(db, C, 'carlos7@test.dev')

  // Datos de A: ciudad, compromiso, un ejercicio propio, una sesión de fuerza y una carrera,
  // medidas, un hito y una foto.
  await asUser(
    db,
    A,
    "update public.profiles set home_city = 'Zaragoza', home_lat = 41.65, home_lng = -0.88 where id = $1",
    [A],
  )
  await asUser(db, A, "select public.set_commitment('2026-08-31', 3, null, null, true)")
  await asUser(
    db,
    A,
    `insert into public.exercises (id, name, category, tracking_type, owner_id)
     values ($1, 'Press de Ana', 'strength', 'weight_reps', $2)`,
    [OWN_EXERCISE, A],
  )
  const block = '20000000-0000-4000-8000-000000000001'
  const payload = {
    session: {
      id: SESSION,
      session_type: 'strength',
      title: 'Pierna',
      notes: 'Rodilla bien',
      started_at: '2026-09-21T09:00:00Z',
      ended_at: '2026-09-21T10:00:00Z',
      duration_min: 60,
      rpe: 8,
      client_rev: 1,
    },
    blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
    sets: [
      { exercise: 'back_squat', weight: 100, reps: 5 },
      { exercise: 'back_squat', weight: 100, reps: 5 },
      { exercise: OWN_EXERCISE, weight: 40, reps: 10 },
    ].map((s, i) => ({
      id: `30000000-0000-4000-8000-00000000000${i + 1}`,
      block_id: block,
      exercise_id: s.exercise,
      set_index: i,
      is_warmup: false,
      weight_kg: s.weight,
      reps: s.reps,
      completed: true,
      completed_at: '2026-09-21T09:30:00Z',
    })),
  }
  await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload)])
  await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [
    JSON.stringify({
      session: {
        id: CARDIO,
        session_type: 'running',
        started_at: '2026-09-22T09:00:00Z',
        ended_at: '2026-09-22T09:30:00Z',
        duration_min: 30,
        rpe: 5,
        distance_m: 5000,
        client_rev: 1,
      },
      blocks: [],
      sets: [],
    }),
  ])
  await asUser(
    db,
    A,
    "insert into public.body_metrics (date, weight_kg, waist_cm) values ('2026-09-20', 62, 70)",
  )
  await asUser(
    db,
    A,
    "insert into public.milestones_shown (milestone_key) values ('run_total_madrid')",
  )
  await asUser(
    db,
    A,
    "insert into public.progress_photos (date, pose, storage_path) values ('2026-09-20', 'front', $1)",
    [`${A}/foto.jpg`],
  )
  await asUser(
    db,
    A,
    "insert into storage.objects (bucket_id, name) values ('progress-photos', $1)",
    [`${A}/foto.jpg`],
  )

  // Vínculo A ↔ B aceptado (por defecto: solo cumplimiento).
  await asUser(db, A, "select public.invite_partner('bea7@test.dev')")
  await asUser(db, B, 'select public.respond_partner_link($1, true)', [A])
})

describe('permisos por persona', () => {
  beforeEach(async () => {
    await share()
  })

  it('al aceptar: cumplimiento activado y el resto desactivado', async () => {
    await asUser(
      db,
      A,
      'update public.partner_links set can_view_adherence = true where user_id = $1',
      [A],
    )
    const [link] = await asUser<Record<string, unknown>>(
      db,
      B,
      'select * from public.list_partners()',
    )
    expect(link).toMatchObject({
      they_share_adherence: true,
      they_share_sessions: false,
      they_share_muscles: false,
      they_share_achievements: false,
      they_share_metrics: false,
    })
  })

  it('cumplimiento: con permiso se ven compromisos y días; sin él, nada', async () => {
    const days = "select * from public.partner_adherence_days($1, '2026-01-01', 'UTC')"
    expect(await count(B, days, [A])).toBe(0)
    expect(await count(B, 'select id from public.commitments')).toBe(0)
    await share('adherence')
    expect(await count(B, days, [A])).toBe(2)
    expect(await count(B, 'select id from public.commitments')).toBe(1)
    // Solo cumplimiento: nada de entrenos, mapa, logros ni medidas.
    expect(await count(B, 'select id from public.workout_sessions')).toBe(0)
    expect(await partnerLog()).toEqual([])
    expect(await partnerHome()).toEqual([])
    expect(await count(B, 'select id from public.body_metrics')).toBe(0)
  })

  it('entrenos: sesiones, bloques, series con pesos, récords y sus ejercicios propios', async () => {
    const q = {
      sessions: 'select id from public.workout_sessions',
      blocks: 'select id from public.session_blocks',
      sets: 'select weight_kg from public.exercise_sets',
      prs: 'select id from public.personal_records',
      exercise: 'select id from public.exercises where id = $1',
    }
    expect(await count(B, q.sessions)).toBe(0)
    expect(await count(B, q.blocks)).toBe(0)
    expect(await count(B, q.sets)).toBe(0)
    expect(await count(B, q.prs)).toBe(0)
    expect(await count(B, q.exercise, [OWN_EXERCISE])).toBe(0)

    await share('sessions')
    expect(await count(B, q.sessions)).toBe(2)
    expect(await count(B, q.blocks)).toBe(1)
    expect(await count(B, q.sets)).toBe(3)
    expect(await count(B, q.prs)).toBeGreaterThan(0)
    expect(await count(B, q.exercise, [OWN_EXERCISE])).toBe(1)
    expect(
      await count(B, 'select muscle_id from public.exercise_muscles where exercise_id = $1', [
        OWN_EXERCISE,
      ]),
    ).toBe(0)
    // Entrenos no incluye mapa/carga ni logros ni medidas.
    expect(await partnerLog()).toEqual([])
    expect(await partnerSets()).toEqual([])
    expect(await partnerHome()).toEqual([])
    expect(await count(B, 'select 1 from public.milestones_shown')).toBe(0)
    expect(await count(B, 'select id from public.body_metrics')).toBe(0)
    // Ver no es editar.
    expect(
      await count(
        B,
        "update public.workout_sessions set title = 'x' where user_id = $1 returning id",
        [A],
      ),
    ).toBe(0)
    expect(
      await count(B, 'delete from public.exercise_sets where user_id = $1 returning id', [A]),
    ).toBe(0)
  })

  it('mapa y carga: series por ejercicio y RPE, sin pesos, distancias ni tonelaje', async () => {
    await share('muscles')
    const log = await partnerLog()
    expect(log.map((r) => r.id).sort()).toEqual([SESSION, CARDIO].sort())
    expect(log.find((r) => r.id === SESSION)).toMatchObject({
      rpe: 8,
      distance_m: null,
      tonnage_kg: null,
      total_reps: null,
    })
    const sets = await asUser<{ exercise_id: string; sets: number }>(
      db,
      B,
      "select * from public.partner_exercise_sets($1, '2026-01-01', '2027-01-01') order by exercise_id",
      [A],
    )
    expect(sets).toEqual([
      { session_id: SESSION, exercise_id: 'back_squat', sets: 2 },
      { session_id: SESSION, exercise_id: OWN_EXERCISE, sets: 1 },
    ])
    // Sus ejercicios propios (para el reparto por músculo), pero no sus tablas de registro.
    expect(await count(B, 'select id from public.exercises where id = $1', [OWN_EXERCISE])).toBe(1)
    expect(await count(B, 'select id from public.workout_sessions')).toBe(0)
    expect(await count(B, 'select id from public.exercise_sets')).toBe(0)
    expect(await count(B, 'select id from public.personal_records')).toBe(0)
    expect(await partnerHome()).toEqual([])
  })

  it('logros: distancia, tonelaje, reps, ciudad e hitos; sin RPE ni series', async () => {
    expect(await count(B, 'select 1 from public.milestones_shown')).toBe(0)
    await share('achievements')
    const log = await partnerLog()
    const strength = log.find((r) => r.id === SESSION)
    const run = log.find((r) => r.id === CARDIO)
    expect(Number(strength?.tonnage_kg)).toBe(1400)
    expect(strength?.total_reps).toBe(20)
    expect(strength?.rpe).toBeNull()
    expect(Number(run?.distance_m)).toBe(5000)
    expect(await partnerSets()).toEqual([])
    expect(await partnerHome()).toEqual([
      { home_city: 'Zaragoza', home_lat: 41.65, home_lng: -0.88 },
    ])
    expect(await count(B, 'select 1 from public.milestones_shown')).toBe(1)
    expect(await count(B, 'select id from public.exercises where id = $1', [OWN_EXERCISE])).toBe(0)
    expect(await count(B, 'select id from public.workout_sessions')).toBe(0)
  })

  it('medidas: peso y perímetros solo con su permiso', async () => {
    expect(await count(B, 'select id from public.body_metrics')).toBe(0)
    await share('metrics')
    expect(await count(B, 'select id from public.body_metrics')).toBe(1)
    expect(await count(B, 'select id from public.workout_sessions')).toBe(0)
    expect(await partnerLog()).toEqual([])
  })

  it('las fotos nunca se comparten, ni con todos los permisos activados', async () => {
    await share(...PERMS)
    expect(await count(B, 'select id from public.progress_photos')).toBe(0)
    expect(await count(B, 'select name from storage.objects')).toBe(0)
    const [photos] = await asUser<{ ok: boolean }>(
      db,
      B,
      "select public.shares_with_me($1, 'photos') as ok",
      [A],
    )
    expect(photos?.ok).toBe(false)
    const cols = await db.query(
      "select 1 from information_schema.columns where table_name = 'partner_links' and column_name like '%photo%'",
    )
    expect(cols.rows).toEqual([])
    // No hay ninguna política de pareja en las fotos.
    const policies = await db.query<{ policyname: string }>(
      "select policyname from pg_policies where tablename in ('progress_photos', 'objects')",
    )
    expect(policies.rows.map((p) => p.policyname).filter((n) => /partner/.test(n))).toEqual([])
  })

  it('un tercero no ve nada aunque A lo comparta todo con B', async () => {
    await share(...PERMS)
    expect(await count(C, 'select id from public.workout_sessions')).toBe(0)
    expect(await count(C, 'select id from public.body_metrics')).toBe(0)
    expect(await count(C, 'select 1 from public.milestones_shown')).toBe(0)
    expect(await partnerLog(C)).toEqual([])
    expect(await partnerSets(C)).toEqual([])
    expect(await partnerHome(C)).toEqual([])
    // Y B no ve a A en la otra dirección más de lo que A comparte: A no ve nada de B.
    expect(await asUser(db, A, 'select * from public.partner_session_log($1)', [B])).toEqual([])
  })

  it('cada uno solo cambia lo que comparte él (también los permisos nuevos)', async () => {
    const changed = await asUser(
      db,
      B,
      'update public.partner_links set can_view_muscles = true, can_view_achievements = true where user_id = $1 returning id',
      [A],
    )
    expect(changed).toEqual([])
    expect(await partnerLog()).toEqual([])
  })

  it('quitar un permiso tiene efecto inmediato', async () => {
    await share('sessions', 'muscles', 'achievements', 'metrics')
    expect(await count(B, 'select id from public.workout_sessions')).toBe(2)
    await share('muscles', 'achievements', 'metrics')
    expect(await count(B, 'select id from public.workout_sessions')).toBe(0)
    expect((await partnerLog()).length).toBe(2)
    await share()
    expect(await partnerLog()).toEqual([])
    expect(await count(B, 'select id from public.body_metrics')).toBe(0)
  })
})

describe('entreno en pareja', () => {
  const GROUP = '40000000-0000-4000-8000-000000000001'
  const structure = { session_type: 'strength', title: 'Pierna', blocks: [] }

  it('solo con el vínculo aceptado en las dos direcciones', async () => {
    await expect(
      asUser(db, A, 'select public.create_pair_invite($1, $2, $3::jsonb)', [
        C,
        GROUP,
        JSON.stringify(structure),
      ]),
    ).rejects.toThrow(/vinculados/)
  })

  it('invitar, verla la otra persona, actualizar la estructura y unirse', async () => {
    const [{ id } = { id: '' }] = await asUser<{ id: string }>(
      db,
      A,
      'select public.create_pair_invite($1, $2, $3::jsonb) as id',
      [B, GROUP, JSON.stringify(structure)],
    )
    expect(id).toBeTruthy()
    expect(await count(B, "select id from public.pair_invites where status = 'pending'")).toBe(1)
    expect(await count(C, 'select id from public.pair_invites')).toBe(0)
    // Nadie escribe directamente.
    await expect(
      asUser(db, B, "update public.pair_invites set status = 'accepted' where id = $1", [id]),
    ).rejects.toThrow()
    // Solo quien invita actualiza la estructura.
    await expect(
      asUser(db, B, 'select public.update_pair_invite($1, $2::jsonb)', [id, '{"blocks":[]}']),
    ).rejects.toThrow()
    await asUser(db, A, 'select public.update_pair_invite($1, $2::jsonb)', [
      id,
      JSON.stringify({ ...structure, blocks: [{ block_type: 'straight' }] }),
    ])
    // Otro usuario no puede reutilizar el pair_group_id.
    await expect(
      asUser(db, B, 'select public.create_pair_invite($1, $2, $3::jsonb)', [
        A,
        GROUP,
        JSON.stringify(structure),
      ]),
    ).rejects.toThrow()
    // Solo quien recibe responde.
    await expect(
      asUser(db, A, 'select public.respond_pair_invite($1, true)', [id]),
    ).rejects.toThrow()
    await asUser(db, B, 'select public.respond_pair_invite($1, true)', [id])
    const [row] = await asUser<{ status: string; payload: { blocks: unknown[] } }>(
      db,
      A,
      'select status, payload from public.pair_invites where id = $1',
      [id],
    )
    expect(row?.status).toBe('accepted')
    expect(row?.payload.blocks).toHaveLength(1)
    // Ya aceptada: no se puede cambiar ni cancelar.
    await expect(
      asUser(db, A, 'select public.update_pair_invite($1, $2::jsonb)', [id, '{"blocks":[]}']),
    ).rejects.toThrow(/pendiente/)
  })

  it('las dos sesiones quedan enlazadas y la comparación depende de compartir entrenos', async () => {
    const mine = {
      session: {
        id: '10000000-0000-4000-8000-0000000000b1',
        session_type: 'strength',
        started_at: '2026-09-28T09:00:00Z',
        ended_at: '2026-09-28T10:00:00Z',
        pair_group_id: GROUP,
        client_rev: 1,
      },
      blocks: [],
      sets: [],
    }
    await asUser(db, B, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(mine)])
    await asUser(db, A, 'select public.save_workout_session($1::jsonb)', [
      JSON.stringify({
        ...mine,
        session: { ...mine.session, id: '10000000-0000-4000-8000-0000000000a1' },
      }),
    ])
    const pairSql = 'select user_id from public.workout_sessions where pair_group_id = $1'
    await share()
    expect(await asUser(db, B, pairSql, [GROUP])).toEqual([{ user_id: B }])
    await share('sessions')
    expect((await asUser(db, B, pairSql, [GROUP])).length).toBe(2)
  })

  it('rechazar y cancelar', async () => {
    const group = '40000000-0000-4000-8000-000000000002'
    const [{ id } = { id: '' }] = await asUser<{ id: string }>(
      db,
      A,
      'select public.create_pair_invite($1, $2, $3::jsonb) as id',
      [B, group, JSON.stringify(structure)],
    )
    await asUser(db, A, 'select public.cancel_pair_invite($1)', [id])
    await expect(
      asUser(db, B, 'select public.respond_pair_invite($1, true)', [id]),
    ).rejects.toThrow(/pendiente/)
  })
})

describe('reacciones', () => {
  const MONDAY = '2026-09-21'
  const toggle = (from: string, to: string, kind: string, key: string, emoji = 'clap') =>
    asUser<{ on: boolean }>(db, from, 'select public.toggle_reaction($1, $2, $3, $4) as on', [
      to,
      kind,
      key,
      emoji,
    ])

  it('a la semana solo si me comparte el cumplimiento, y una por emoji', async () => {
    await share()
    await expect(toggle(B, A, 'week', MONDAY)).rejects.toThrow(/cumplimiento/)
    await share('adherence')
    await expect(toggle(B, A, 'week', '2026-09-22')).rejects.toThrow(/invalid week/)
    expect((await toggle(B, A, 'week', MONDAY))[0]?.on).toBe(true)
    expect((await toggle(B, A, 'week', MONDAY, 'fire'))[0]?.on).toBe(true)
    expect(await count(A, 'select id from public.reactions where to_user = $1', [A])).toBe(2)
    // Tocar otra vez la quita.
    expect((await toggle(B, A, 'week', MONDAY, 'fire'))[0]?.on).toBe(false)
    expect(await count(A, 'select id from public.reactions where to_user = $1', [A])).toBe(1)
  })

  it('a una sesión solo si me comparte los entrenos y la sesión es suya', async () => {
    await share('adherence')
    await expect(toggle(B, A, 'session', SESSION)).rejects.toThrow(/sesión/)
    await share('sessions')
    await expect(toggle(B, A, 'session', '10000000-0000-4000-8000-0000000000b1')).rejects.toThrow()
    expect((await toggle(B, A, 'session', SESSION, 'muscle'))[0]?.on).toBe(true)
    await expect(toggle(B, A, 'session', SESSION, 'heart')).rejects.toThrow()
  })

  it('solo las ven los dos implicados; marcar vistas solo las propias', async () => {
    expect(await count(C, 'select id from public.reactions')).toBe(0)
    const unseen = 'select id from public.reactions where to_user = $1 and seen_at is null'
    expect(await count(A, unseen, [A])).toBe(2)
    await asUser(db, B, 'select public.mark_reactions_seen()')
    expect(await count(A, unseen, [A])).toBe(2)
    await asUser(db, A, 'select public.mark_reactions_seen()')
    expect(await count(A, unseen, [A])).toBe(0)
    await expect(
      asUser(db, B, 'delete from public.reactions where from_user = $1', [B]),
    ).rejects.toThrow()
  })

  it('revocar el vínculo corta todo al momento', async () => {
    await share(...PERMS)
    await asUser(db, B, 'select public.revoke_partner_link($1)', [A])
    expect(await count(B, 'select id from public.workout_sessions where user_id = $1', [A])).toBe(0)
    expect(await count(B, 'select id from public.body_metrics')).toBe(0)
    expect(await count(B, 'select id from public.commitments')).toBe(0)
    expect(await partnerLog()).toEqual([])
    expect(await partnerSets()).toEqual([])
    expect(await partnerHome()).toEqual([])
    await expect(toggle(B, A, 'week', MONDAY, 'muscle')).rejects.toThrow()
    await expect(
      asUser(db, A, 'select public.create_pair_invite($1, $2, $3::jsonb)', [
        B,
        '40000000-0000-4000-8000-000000000003',
        '{"blocks":[]}',
      ]),
    ).rejects.toThrow(/vinculados/)
    // Al volver a vincularse, todo vuelve a estar desactivado salvo el cumplimiento.
    await asUser(db, A, "select public.invite_partner('bea7@test.dev')")
    await asUser(db, B, 'select public.respond_partner_link($1, true)', [A])
    const [link] = await asUser<Record<string, boolean>>(
      db,
      B,
      'select * from public.list_partners()',
    )
    expect(link).toMatchObject({
      they_share_adherence: true,
      they_share_sessions: false,
      they_share_muscles: false,
      they_share_achievements: false,
      they_share_metrics: false,
    })
  })
})
