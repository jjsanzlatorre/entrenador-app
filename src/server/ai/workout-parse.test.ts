// «Escribir entreno» con la IA (proveedor simulado, nunca la API real): solo exercise_id de la
// biblioteca, reintento si inventa alguno y registro como 'workout_parse'.
import { describe, expect, it, vi } from 'vitest'
import { parsedFromAi } from '@/lib/workout/text-parse'
import { makeExercise } from '@/lib/workout/test-helpers'
import { parseWorkoutText, type CoachDeps } from './coach'
import type { AiProvider, JsonRequest } from './providers/types'
import { DailyLimitError, type UsageStore } from './usage'

function deps(responses: string[], limit = 20) {
  const requests: JsonRequest[] = []
  const rows: { id: string; kind: string; status: string; output?: unknown }[] = []
  const provider: AiProvider = {
    name: 'mock',
    model: 'mock-light',
    generateJson: vi.fn(async (req: JsonRequest) => {
      requests.push(req)
      const next = responses.shift()
      if (next === undefined) throw new Error('sin más respuestas')
      return { text: next, tokensIn: 100, tokensOut: 50, model: 'mock-light' }
    }),
  }
  const usage: UsageStore = {
    async begin(kind) {
      if (rows.length >= limit) throw new DailyLimitError()
      const id = `ai-${rows.length + 1}`
      rows.push({ id, kind, status: 'pending' })
      return id
    },
    async finish(id, r) {
      Object.assign(
        rows.find((x) => x.id === id)!,
        r,
      )
    },
    async usedToday() {
      return rows.length
    },
  }
  return { deps: { provider, usage, dailyLimit: limit } satisfies CoachDeps, requests, rows }
}

const exercises = [
  { id: 'side_plank', name: 'Plancha lateral', aliases: ['side plank'] },
  { id: 'kb_swing', name: 'Kettlebell swing', aliases: ['swing ruso'] },
]

const block = (exercise_id: string | undefined) =>
  JSON.stringify({
    blocks: [
      {
        rounds: 4,
        rest_s: 60,
        exercises: [
          { exercise_id, name: 'balanceo con pesa rusa', reps: 15 },
          { exercise_id: 'side_plank', name: 'plancha de lado', duration_s: 30, per_side: true },
        ],
      },
    ],
  })

describe('workout_parse', () => {
  it('convierte el texto con ejercicios de la biblioteca y lo registra', async () => {
    const { deps: d, requests, rows } = deps([block('kb_swing')])
    const res = await parseWorkoutText(d, {
      text: 'balanceo con pesa rusa 15 + plancha de lado 30" por lado, 4 vueltas',
      exercises,
    })
    expect(res).toMatchObject({ ok: true, parse: { blocks: [{ rounds: 4 }] } })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.prompt).toContain('kb_swing | Kettlebell swing | swing ruso')
    expect(requests[0]!.prompt).toContain('balanceo con pesa rusa')
    expect(rows[0]).toMatchObject({ kind: 'workout_parse', status: 'ok' })

    // En el móvil: los mismos bloques que el parser, marcados «ai».
    if (!res.ok) throw new Error('no')
    const parsed = parsedFromAi(res.parse.blocks, [
      makeExercise({ id: 'kb_swing', trackingType: 'weight_reps' }),
      makeExercise({ id: 'side_plank', trackingType: 'time', isUnilateral: true }),
    ])
    expect(parsed.understood).toBe(true)
    expect(parsed.blocks[0]).toMatchObject({ rounds: 4, restBetweenRoundsS: 60 })
    expect(parsed.blocks[0]!.items[1]).toMatchObject({
      exerciseId: 'side_plank',
      match: 'ai',
      durationS: 30,
      perSide: true,
    })
  })

  it('un id inventado: reintento con el error; si insiste, el ejercicio queda por elegir', async () => {
    const { deps: d, requests } = deps([block('balanceo_inventado'), block('balanceo_inventado')])
    const res = await parseWorkoutText(d, { text: 'balanceo 15 + plancha 30s', exercises })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.prompt).toContain('balanceo_inventado')
    if (!res.ok) throw new Error('no')
    expect(res.parse.blocks[0]!.exercises[0]!.exercise_id).toBeUndefined()
    const parsed = parsedFromAi(res.parse.blocks, [
      makeExercise({ id: 'side_plank', trackingType: 'time' }),
    ])
    expect(parsed.understood).toBe(false)
    expect(parsed.blocks[0]!.items[0]).toMatchObject({
      exerciseId: null,
      name: 'balanceo con pesa rusa',
      reps: 15,
    })
  })

  it('con el límite diario agotado no llama a la IA', async () => {
    const { deps: d, requests } = deps([block('kb_swing')], 0)
    const res = await parseWorkoutText(d, { text: 'x', exercises })
    expect(res).toMatchObject({ ok: false, code: 'daily_limit' })
    expect(requests).toHaveLength(0)
  })
})
