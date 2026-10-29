// «Escribir entreno» (0046): el tipo de consulta 'workout_parse' cuenta en el límite diario como
// las demás; los bloques por rondas se guardan en config sin cambios de esquema.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb, createUser } from './pglite'

const A = '00000000-0000-4000-8000-0000000046a1'

let db: PGlite

beforeAll(async () => {
  db = await createDb({ runs: 2 })
  await createUser(db, A, 'ana46@test.dev')
})

describe('workout_parse (0046)', () => {
  it('se puede abrir una consulta de tipo workout_parse y cuenta en el límite', async () => {
    const [row] = await asUser<{ id: string }>(
      db,
      A,
      `select public.begin_ai_interaction('workout_parse', '{"chars":80}'::jsonb, 1, 'Europe/Madrid', 'gemini', 'm') as id`,
    )
    expect(row?.id).toBeTruthy()
    await expect(
      asUser(
        db,
        A,
        `select public.begin_ai_interaction('workout_parse', '{}'::jsonb, 1, 'Europe/Madrid', 'gemini', 'm')`,
      ),
    ).rejects.toThrow(/ai_daily_limit/)
  })

  it('un tipo desconocido sigue sin valer', async () => {
    await expect(
      asUser(
        db,
        A,
        `select public.begin_ai_interaction('otra_cosa', '{}'::jsonb, 50, 'Europe/Madrid', 'gemini', 'm')`,
      ),
    ).rejects.toThrow()
  })

  it('un circuito de 5 ejercicios × 4 rondas se guarda con sus ajustes y 20 series', async () => {
    const session = '00000000-0000-4000-8000-00000046c001'
    const block = '00000000-0000-4000-8000-00000046b001'
    const ids = ['side_plank', 'hip_thrust', 'pull_up', 'plank', 'push_up']
    const sets = ids.flatMap((exercise, e) =>
      Array.from({ length: 4 }, (_, r) => ({
        id: `00000000-0000-4000-8000-0000004${e}${r}d01`.slice(0, 36),
        block_id: block,
        exercise_id: exercise,
        set_index: r,
        is_warmup: false,
        weight_kg: exercise === 'hip_thrust' ? 40 : null,
        reps: exercise.includes('plank') ? null : 20,
        rir: null,
        duration_s: exercise.includes('plank') ? 45 : null,
        distance_m: null,
        calories: null,
        completed: true,
        completed_at: '2026-10-28T18:30:00Z',
      })),
    )
    const payload = {
      session: {
        id: session,
        planned_session_id: null,
        session_type: 'strength',
        activity_type_id: null,
        title: 'Circuito',
        started_at: '2026-10-28T18:00:00Z',
        ended_at: '2026-10-28T18:40:00Z',
        duration_min: 40,
        rpe: 7,
        distance_m: null,
        avg_hr: null,
        max_hr: null,
        calories: null,
        location: 'gym',
        notes: null,
        pair_group_id: null,
        client_rev: 1,
      },
      blocks: [
        {
          id: block,
          order: 0,
          block_type: 'superset',
          config: {
            exercises: ids.map((exercise_id, i) => ({
              exercise_id,
              rest_s: i === 4 ? 90 : 60,
              ...(exercise_id === 'side_plank' ? { per_side: true } : {}),
            })),
            settings: {
              kind: 'circuit',
              rounds: 4,
              rest_between_rounds_s: 90,
              rest_between_exercises_s: 0,
            },
          },
          result: null,
        },
      ],
      sets,
    }
    await asUser(db, A, `select public.save_workout_session($1::jsonb)`, [JSON.stringify(payload)])
    const [saved] = await asUser<{ n: number; per_side: boolean; rounds: number }>(
      db,
      A,
      `select
         (select count(*)::int from public.exercise_sets where session_id = $1 and completed) as n,
         (b.config -> 'exercises' -> 0 ->> 'per_side')::boolean as per_side,
         (b.config -> 'settings' ->> 'rounds')::int as rounds
       from public.session_blocks b where b.session_id = $1`,
      [session],
    )
    expect(saved).toEqual({ n: 20, per_side: true, rounds: 4 })
  })
})
