import { describe, expect, it } from 'vitest'
import { fromServerRows, toPayload } from './payload'
import { addExerciseBlock, addToSuperset, createSession, toggleSetComplete } from './session-ops'
import { sequentialIds } from './test-helpers'

describe('payload', () => {
  it('ida y vuelta: local → servidor → local conserva bloques, orden y series', () => {
    const id = sequentialIds()
    const T0 = Date.parse('2026-09-28T10:00:00Z')
    let s = createSession('u1', T0, id)
    s = addExerciseBlock(s, { id: 'bench_press', defaultRestS: 150 }, null, T0, id)
    s = addToSuperset(s, s.blocks[0]!.id, { id: 'db_row', defaultRestS: 90 }, null, T0, id)
    s = addExerciseBlock(s, { id: 'back_squat', defaultRestS: 180 }, null, T0, id)
    s = toggleSetComplete(s, s.blocks[1]!.sets[0]!.id, T0 + 1000)

    const p = toPayload(s)
    expect(p.session.client_rev).toBe(s.rev)
    expect(p.sets).toHaveLength(9)

    const rows = fromServerRows(
      {
        ...p.session,
        user_id: 'u1',
        planned_session_id: null,
        distance_m: null,
        pair_group_id: null,
        created_at: '',
        updated_at: '',
        title: p.session.title ?? null,
        location: p.session.location ?? null,
        notes: null,
        session_type: 'strength',
      } as never,
      p.blocks.map((b) => ({ ...b, session_id: s.id, user_id: 'u1', result: null })) as never,
      p.sets.map((x) => ({ ...x, session_id: s.id, user_id: 'u1' })) as never,
      'live',
    )
    expect(rows.blocks).toEqual(s.blocks)
    expect(rows.title).toBe(s.title)
  })
})
