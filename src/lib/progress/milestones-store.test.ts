import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetIdbForTests } from '@/lib/offline/idb'
import type { ShownMilestone } from './api'

const server: ShownMilestone[] = []
let online = true

vi.mock('./api', () => ({
  fetchShownMilestones: vi.fn(async () => {
    if (!online) throw new Error('offline')
    return [...server]
  }),
  insertShownMilestones: vi.fn(async (_userId: string, items: ShownMilestone[]) => {
    if (!online) throw new Error('offline')
    for (const i of items) if (!server.some((s) => s.key === i.key)) server.push(i)
  }),
}))

const { loadShownMilestones, markMilestonesShown } = await import('./milestones-store')

beforeEach(async () => {
  await __resetIdbForTests()
  server.length = 0
  online = true
})

const keys = (items: ShownMilestone[]) => items.map((i) => i.key).sort()

describe('milestones_shown en el dispositivo', () => {
  it('con conexión se guarda en el servidor', async () => {
    await markMilestonesShown('u1', ['tonnage_total_tractor'])
    expect(keys(server)).toEqual(['tonnage_total_tractor'])
    const loaded = await loadShownMilestones('u1')
    expect(loaded.reliable).toBe(true)
    expect(keys(loaded.items)).toEqual(['tonnage_total_tractor'])
  })

  it('sin conexión y sin copia no es fiable (no se enseñan pop-ups)', async () => {
    online = false
    const loaded = await loadShownMilestones('u1')
    expect(loaded.reliable).toBe(false)
  })

  it('sin conexión se marca en local y se sube al volver la red', async () => {
    await loadShownMilestones('u1') // copia inicial
    online = false
    await markMilestonesShown('u1', ['run_total_girona'])
    const offline = await loadShownMilestones('u1')
    expect(offline.reliable).toBe(true)
    expect(keys(offline.items)).toEqual(['run_total_girona'])
    expect(server).toHaveLength(0)
    online = true
    const back = await loadShownMilestones('u1')
    expect(keys(server)).toEqual(['run_total_girona'])
    expect(keys(back.items)).toEqual(['run_total_girona'])
  })
})
