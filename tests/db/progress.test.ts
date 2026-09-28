// Fase 3A en la base de datos: récords, compromisos, peso/medidas, fotos y vínculos (RLS).
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const C = '00000000-0000-4000-8000-0000000000c1'

let seq = 0
function uuid(prefix: string) {
  seq++
  return `${prefix}0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

type SetInput = {
  exercise: string
  weight?: number | null
  reps?: number | null
  warmup?: boolean
  duration?: number | null
  distance?: number | null
  completed?: boolean
}

function sessionPayload(opts: {
  id: string
  day: string
  sets: SetInput[]
  ended?: boolean
  type?: string
  durationMin?: number
  rev?: number
}) {
  const block = uuid('2')
  return {
    session: {
      id: opts.id,
      session_type: opts.type ?? 'strength',
      title: 'Test',
      started_at: `${opts.day}T09:00:00Z`,
      ended_at: opts.ended === false ? null : `${opts.day}T10:00:00Z`,
      duration_min: opts.durationMin ?? 60,
      rpe: 7,
      client_rev: opts.rev ?? 1,
    },
    blocks: [{ id: block, order: 0, block_type: 'straight', config: {} }],
    sets: opts.sets.map((s, i) => ({
      id: uuid('3'),
      block_id: block,
      exercise_id: s.exercise,
      set_index: i,
      is_warmup: s.warmup ?? false,
      weight_kg: s.weight ?? null,
      reps: s.reps ?? null,
      duration_s: s.duration ?? null,
      distance_m: s.distance ?? null,
      completed: s.completed ?? true,
      completed_at: `${opts.day}T09:30:00Z`,
    })),
  }
}

async function save(uid: string, payload: ReturnType<typeof sessionPayload>) {
  await asUser(db, uid, 'select public.save_workout_session($1::jsonb)', [JSON.stringify(payload)])
}

type PrRow = {
  pr_type: string
  value: string
  previous_value: string | null
  weight_kg: string | null
  session_id: string
}

async function records(uid: string, exercise: string) {
  return asUser<PrRow>(
    db,
    uid,
    'select pr_type, value, previous_value, weight_kg, session_id from public.personal_records where exercise_id = $1 order by achieved_at, pr_type, weight_kg',
    [exercise],
  )
}

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana@test.dev')
  await createUser(db, B, 'bea@test.dev')
  await createUser(db, C, 'carlos@test.dev')
})

describe('récords personales', () => {
  const S1 = uuid('1')
  const S2 = uuid('1')
  const S3 = uuid('1')

  it('la primera sesión deja las marcas de referencia (sin valor anterior)', async () => {
    await save(
      A,
      sessionPayload({
        id: S1,
        day: '2026-09-01',
        sets: [
          { exercise: 'bench_press', weight: 40, reps: 10, warmup: true },
          { exercise: 'bench_press', weight: 60, reps: 8 },
          { exercise: 'bench_press', weight: 60, reps: 7 },
        ],
      }),
    )
    const rows = await records(A, 'bench_press')
    const byType = Object.fromEntries(rows.map((r) => [r.pr_type, r]))
    expect(Number(byType.est_1rm?.value)).toBe(76)
    expect(Number(byType.max_weight?.value)).toBe(60)
    expect(Number(byType.max_reps_at_weight?.value)).toBe(8)
    expect(rows.every((r) => r.previous_value === null)).toBe(true)
  })

  it('una mejora crea un nuevo récord con la marca anterior; lo que no mejora, no', async () => {
    await save(
      A,
      sessionPayload({
        id: S2,
        day: '2026-09-04',
        sets: [
          { exercise: 'bench_press', weight: 62.5, reps: 8 },
          { exercise: 'bench_press', weight: 55, reps: 6 },
        ],
      }),
    )
    const rows = (await records(A, 'bench_press')).filter((r) => r.session_id === S2)
    const byType = Object.fromEntries(rows.map((r) => [r.pr_type, r]))
    expect(Number(byType.max_weight?.value)).toBe(62.5)
    expect(Number(byType.max_weight?.previous_value)).toBe(60)
    expect(Number(byType.est_1rm?.previous_value)).toBe(76)
    // 62,5 × 8 es la primera vez con ese peso: referencia (sin anterior); 55 × 6 no es récord.
    expect(rows.filter((r) => r.pr_type === 'max_reps_at_weight')).toEqual([
      expect.objectContaining({ value: '8', previous_value: null }),
    ])
  })

  it('más reps con un peso ya usado es récord de reps', async () => {
    await save(
      A,
      sessionPayload({
        id: S3,
        day: '2026-09-08',
        sets: [{ exercise: 'bench_press', weight: 60, reps: 10 }],
      }),
    )
    const rows = (await records(A, 'bench_press')).filter((r) => r.session_id === S3)
    // 60 × 10 también mejora el 1RM estimado (80 frente a 79,2 de 62,5 × 8).
    expect(rows.map((r) => r.pr_type)).toEqual(['est_1rm', 'max_reps_at_weight'])
    const reps = rows.find((r) => r.pr_type === 'max_reps_at_weight')
    expect(Number(reps?.previous_value)).toBe(8)
    expect(Number(reps?.weight_kg)).toBe(60)
  })

  it('las sesiones sin terminar no cuentan', async () => {
    await save(
      A,
      sessionPayload({
        id: uuid('1'),
        day: '2026-09-09',
        ended: false,
        sets: [{ exercise: 'bench_press', weight: 100, reps: 5 }],
      }),
    )
    const max = (await records(A, 'bench_press')).filter((r) => r.pr_type === 'max_weight')
    expect(max.map((r) => Number(r.value))).toEqual([60, 62.5])
  })

  it('al borrar una sesión se rehace el historial', async () => {
    await asUser(db, A, 'delete from public.workout_sessions where id = $1', [S2])
    const max = (await records(A, 'bench_press')).filter((r) => r.pr_type === 'max_weight')
    expect(max.map((r) => Number(r.value))).toEqual([60])
  })

  it('en cardio: distancia más larga y mejor ritmo (menor es mejor)', async () => {
    await save(
      A,
      sessionPayload({
        id: uuid('1'),
        day: '2026-09-10',
        type: 'running',
        sets: [{ exercise: 'run', distance: 5000, duration: 1500 }],
      }),
    )
    await save(
      A,
      sessionPayload({
        id: uuid('1'),
        day: '2026-09-12',
        type: 'running',
        sets: [
          { exercise: 'run', distance: 3000, duration: 840 },
          { exercise: 'run', distance: 400, duration: 80 },
        ],
      }),
    )
    const rows = await records(A, 'run')
    const pace = rows.filter((r) => r.pr_type === 'best_pace')
    expect(
      pace.map((r) => [Number(r.value), r.previous_value && Number(r.previous_value)]),
    ).toEqual([
      [300, null],
      [280, 300],
    ])
    expect(
      rows.filter((r) => r.pr_type === 'longest_distance').map((r) => Number(r.value)),
    ).toEqual([5000])
  })

  it('nadie puede escribir récords a mano ni ver los de otro', async () => {
    await expect(
      asUser(
        db,
        A,
        "insert into public.personal_records (user_id, exercise_id, pr_type, value, unit, session_id, achieved_at) values ($1, 'bench_press', 'max_weight', 300, 'kg', $2, now())",
        [A, S1],
      ),
    ).rejects.toThrow()
    expect(await records(B, 'bench_press')).toEqual([])
  })
})

describe('compromisos', () => {
  it('set_commitment cierra el anterior y guarda el historial', async () => {
    await asUser(db, A, "select public.set_commitment('2026-08-03', 3)")
    await asUser(db, A, `select public.set_commitment('2026-09-07', 4, 240, '{"strength": 2}')`)
    const rows = await asUser<{
      valid_from: Date
      valid_to: Date | null
      sessions_per_week: number
    }>(
      db,
      A,
      'select valid_from, valid_to, sessions_per_week from public.commitments order by valid_from',
    )
    expect(rows.map((r) => [iso(r.valid_from), r.valid_to && iso(r.valid_to)])).toEqual([
      ['2026-08-03', '2026-09-06'],
      ['2026-09-07', null],
    ])
  })

  it('cambiarlo dos veces en la misma semana sustituye el de esa semana', async () => {
    await asUser(db, A, "select public.set_commitment('2026-09-07', 2)")
    const rows = await asUser<{ sessions_per_week: number }>(
      db,
      A,
      'select sessions_per_week from public.commitments order by valid_from',
    )
    expect(rows.map((r) => r.sessions_per_week)).toEqual([3, 2])
  })

  it('valid_from tiene que ser lunes', async () => {
    await expect(asUser(db, A, "select public.set_commitment('2026-09-08', 3)")).rejects.toThrow()
  })
})

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('peso, medidas y fotos', () => {
  it('cada uno ve solo sus medidas y sus fotos', async () => {
    await asUser(
      db,
      A,
      "insert into public.body_metrics (date, weight_kg, waist_cm) values ('2026-09-01', 70.5, 80)",
    )
    await asUser(
      db,
      A,
      "insert into public.progress_photos (date, pose, storage_path) values ('2026-09-01', 'front', $1)",
      [`${A}/foto.jpg`],
    )
    expect(await asUser(db, B, 'select * from public.body_metrics')).toEqual([])
    expect(await asUser(db, B, 'select * from public.progress_photos')).toEqual([])
  })

  it('no se puede guardar una foto fuera de la carpeta propia', async () => {
    await expect(
      asUser(
        db,
        A,
        "insert into public.progress_photos (date, pose, storage_path) values ('2026-09-01', 'side', $1)",
        [`${B}/foto.jpg`],
      ),
    ).rejects.toThrow()
  })

  it('storage: el bucket es privado y cada uno solo toca su carpeta', async () => {
    const [bucket] = (
      await db.query<{ public: boolean }>(
        "select public from storage.buckets where id = 'progress-photos'",
      )
    ).rows
    expect(bucket?.public).toBe(false)
    await asUser(
      db,
      A,
      "insert into storage.objects (bucket_id, name) values ('progress-photos', $1)",
      [`${A}/a.jpg`],
    )
    await expect(
      asUser(
        db,
        A,
        "insert into storage.objects (bucket_id, name) values ('progress-photos', $1)",
        [`${B}/b.jpg`],
      ),
    ).rejects.toThrow()
    expect(await asUser(db, B, 'select name from storage.objects')).toEqual([])
    expect(await asUser(db, A, 'select name from storage.objects')).toEqual([
      { name: `${A}/a.jpg` },
    ])
  })
})

describe('vínculos', () => {
  type Link = {
    partner_id: string
    status: string
    i_share_adherence: boolean
    they_share_adherence: boolean
    they_share_sessions: boolean
  }
  const links = (uid: string) => asUser<Link>(db, uid, 'select * from public.list_partner_links()')
  const partnerDays = (uid: string, partner: string) =>
    asUser<{ day: Date; session_type: string }>(
      db,
      uid,
      "select * from public.partner_adherence_days($1, '2026-01-01', 'UTC')",
      [partner],
    )

  it('sin vínculo no se ve nada de la otra persona', async () => {
    expect(await asUser(db, B, 'select * from public.commitments')).toEqual([])
    expect(await asUser(db, B, 'select id from public.workout_sessions')).toEqual([])
    expect(await asUser(db, B, 'select id from public.exercise_sets')).toEqual([])
    expect(await partnerDays(B, A)).toEqual([])
  })

  it('invitar por email: no existe, a uno mismo', async () => {
    await expect(asUser(db, A, "select public.invite_partner('nadie@test.dev')")).rejects.toThrow(
      /ningún usuario/,
    )
    await expect(asUser(db, A, "select public.invite_partner('ana@test.dev')")).rejects.toThrow()
  })

  it('una invitación pendiente no da acceso', async () => {
    await asUser(db, A, "select public.invite_partner('BEA@test.dev ')")
    expect((await links(A)).map((l) => l.status)).toEqual(['sent'])
    expect((await links(B)).map((l) => l.status)).toEqual(['received'])
    expect(await partnerDays(B, A)).toEqual([])
    expect(await asUser(db, B, 'select * from public.commitments')).toEqual([])
  })

  it('al aceptar se comparte el cumplimiento en las dos direcciones, pero no pesos ni sesiones', async () => {
    await asUser(db, B, 'select public.respond_partner_link($1, true)', [A])
    const [fromB] = await links(B)
    expect(fromB).toMatchObject({
      status: 'accepted',
      i_share_adherence: true,
      they_share_adherence: true,
      they_share_sessions: false,
    })
    // Cumplimiento: compromisos y días/tipos de sesión.
    expect((await asUser(db, B, 'select user_id from public.commitments')).length).toBe(2)
    const days = await partnerDays(B, A)
    expect(days.length).toBeGreaterThan(0)
    expect(Object.keys(days[0] ?? {})).toEqual(['day', 'session_type'])
    // Ni sesiones, ni series (pesos), ni récords, ni medidas, ni fotos.
    expect(await asUser(db, B, 'select id from public.workout_sessions')).toEqual([])
    expect(await asUser(db, B, 'select weight_kg from public.exercise_sets')).toEqual([])
    expect(await asUser(db, B, 'select id from public.session_blocks')).toEqual([])
    expect(await asUser(db, B, 'select id from public.personal_records')).toEqual([])
    expect(await asUser(db, B, 'select id from public.body_metrics')).toEqual([])
    expect(await asUser(db, B, 'select id from public.progress_photos')).toEqual([])
    // Un tercero sigue sin ver nada.
    expect(await partnerDays(C, A)).toEqual([])
    expect(await asUser(db, C, 'select * from public.commitments')).toEqual([])
  })

  it('cada uno controla solo lo que comparte él', async () => {
    // B intenta darse acceso a las sesiones de A: no puede tocar la fila de A.
    const changed = await asUser(
      db,
      B,
      'update public.partner_links set can_view_sessions = true where user_id = $1 returning id',
      [A],
    )
    expect(changed).toEqual([])
    // Tampoco puede cambiar el estado de su propia fila directamente.
    await expect(
      asUser(db, B, "update public.partner_links set status = 'pending' where user_id = $1", [B]),
    ).rejects.toThrow()
    expect(await asUser(db, B, 'select id from public.exercise_sets')).toEqual([])
  })

  it('con can_view_sessions se ven las sesiones y series; con can_view_metrics, las medidas', async () => {
    await asUser(
      db,
      A,
      'update public.partner_links set can_view_sessions = true, can_view_metrics = true where user_id = $1',
      [A],
    )
    expect((await asUser(db, B, 'select id from public.workout_sessions')).length).toBeGreaterThan(
      0,
    )
    expect((await asUser(db, B, 'select id from public.exercise_sets')).length).toBeGreaterThan(0)
    expect((await asUser(db, B, 'select id from public.body_metrics')).length).toBe(1)
    // Las fotos nunca.
    expect(await asUser(db, B, 'select id from public.progress_photos')).toEqual([])
    // Ver no es editar.
    const edited = await asUser(
      db,
      B,
      "update public.workout_sessions set title = 'hack' where user_id = $1 returning id",
      [A],
    )
    expect(edited).toEqual([])
    // Y en la otra dirección nada cambia: A no ve las de B.
    expect(
      await asUser(db, A, 'select id from public.body_metrics where user_id = $1', [B]),
    ).toEqual([])
  })

  it('dejar de compartir el cumplimiento lo oculta al momento', async () => {
    await asUser(
      db,
      A,
      'update public.partner_links set can_view_adherence = false, can_view_sessions = false, can_view_metrics = false where user_id = $1',
      [A],
    )
    expect(await partnerDays(B, A)).toEqual([])
    expect(await asUser(db, B, 'select * from public.commitments')).toEqual([])
  })

  it('revocar corta el acceso en las dos direcciones', async () => {
    await asUser(
      db,
      A,
      'update public.partner_links set can_view_adherence = true where user_id = $1',
      [A],
    )
    expect((await asUser(db, B, 'select * from public.commitments')).length).toBe(2)
    await asUser(db, B, 'select public.revoke_partner_link($1)', [A])
    expect(await asUser(db, B, 'select * from public.commitments')).toEqual([])
    expect(await links(A)).toEqual([])
    expect(await links(B)).toEqual([])
  })

  it('si los dos se invitan, el vínculo queda aceptado', async () => {
    await asUser(db, C, "select public.invite_partner('ana@test.dev')")
    await asUser(db, A, "select public.invite_partner('carlos@test.dev')")
    expect((await links(A)).find((l) => l.partner_id === C)?.status).toBe('accepted')
  })
})
