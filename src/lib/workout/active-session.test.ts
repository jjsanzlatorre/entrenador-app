import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/offline/sync-engine', () => ({ requestSync: vi.fn() }))
vi.mock('./api', () => ({ rememberLastPerformance: vi.fn() }))

import { __resetIdbForTests, idbGet } from '@/lib/offline/idb'
import { listOutbox } from '@/lib/offline/outbox'
import {
  __resetActiveSessionForTests,
  __waitForWrites,
  discardActiveSession,
  finishActiveSession,
  getActiveSession,
  loadActiveSession,
  startNewSession,
  updateActiveSession,
} from './active-session'
import { addExerciseBlock, toggleSetComplete } from './session-ops'
import type { LocalSession } from './types'

beforeEach(async () => {
  await __resetIdbForTests()
  __resetActiveSessionForTests()
})

describe('sesión activa', () => {
  it('sobrevive a cerrar la app: se recupera de IndexedDB con todas las series', async () => {
    const s = await startNewSession('u1')
    updateActiveSession((x) =>
      addExerciseBlock(x, { id: 'bench_press', defaultRestS: 120 }, null, Date.now()),
    )
    updateActiveSession((x) => toggleSetComplete(x, x.blocks[0]!.sets[0]!.id, Date.now()))
    await __waitForWrites()

    // «Cerrar la app»: se pierde la memoria.
    __resetActiveSessionForTests()
    expect(getActiveSession()).toBeNull()
    const restored = await loadActiveSession('u1')
    expect(restored?.id).toBe(s.id)
    expect(restored?.blocks[0]?.sets[0]?.completed).toBe(true)
    expect(restored?.rest).not.toBeNull()

    const [item] = await listOutbox('u1')
    expect(item).toMatchObject({ kind: 'save', sessionId: s.id, rev: restored?.rev })
  })

  it('terminar deja la sesión encolada y ya no activa', async () => {
    const s = await startNewSession('u1')
    const finished = await finishActiveSession({ rpe: 7, durationMin: 50 })
    expect(finished?.endedAt).toBeTruthy()
    __resetActiveSessionForTests()
    expect(await loadActiveSession('u1')).toBeNull()
    const stored = await idbGet<LocalSession>('sessions', s.id)
    expect(stored?.rpe).toBe(7)
    const [item] = await listOutbox('u1')
    expect(item?.kind === 'save' && item.payload.session.ended_at).toBeTruthy()
  })

  it('descartar encola el borrado en el servidor', async () => {
    const s = await startNewSession('u1')
    await discardActiveSession()
    expect(await idbGet('sessions', s.id)).toBeUndefined()
    const [item] = await listOutbox('u1')
    expect(item).toMatchObject({ kind: 'delete', sessionId: s.id })
  })
})
