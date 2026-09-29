import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetIdbForTests } from '@/lib/offline/idb'

type Row = { user_id: string; date: string; sleep: number | null; energy: number | null }
const server = new Map<string, Row>()
let online = true
let failUploads = false

vi.mock('@/lib/workout/api', () => ({
  isOnline: () => online,
  withTimeout: <T>(p: PromiseLike<T>) => Promise.resolve(p),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    from: () => {
      const filters: Record<string, string> = {}
      const chain = {
        select: () => chain,
        eq: (col: string, value: string) => {
          filters[col] = value
          return chain
        },
        maybeSingle: async () => ({
          data: server.get(`${filters.user_id}:${filters.date}`) ?? null,
          error: null,
        }),
        upsert: async (row: Row) => {
          if (failUploads) return { error: { message: 'Failed to fetch' } }
          server.set(`${row.user_id}:${row.date}`, row)
          return { error: null }
        },
      }
      return chain
    },
  }),
}))

const { dismissCheckin, fetchCheckin, isCheckinDismissed, isComplete, saveCheckin, syncCheckins } =
  await import('./checkin')

const full = { date: '2026-10-05', sleep: 4, energy: 3, soreness: 2, stress: 1 }

beforeEach(async () => {
  await __resetIdbForTests()
  server.clear()
  online = true
  failUploads = false
})

describe('check-in diario (local-first)', () => {
  it('con conexión se sube al momento', async () => {
    expect(await saveCheckin('u1', full)).toBe(true)
    expect(server.get('u1:2026-10-05')?.sleep).toBe(4)
    expect((await fetchCheckin('u1', '2026-10-05'))?.pending).toBe(false)
  })

  it('sin conexión se guarda en el móvil y se sube al volver la conexión', async () => {
    online = false
    expect(await saveCheckin('u1', full)).toBe(false)
    expect(server.size).toBe(0)
    const local = await fetchCheckin('u1', '2026-10-05')
    expect(local).toMatchObject({ ...full, pending: true })

    online = true
    await syncCheckins('u1')
    expect(server.get('u1:2026-10-05')?.energy).toBe(3)
    expect((await fetchCheckin('u1', '2026-10-05'))?.pending).toBe(false)
  })

  it('si la subida falla se reintenta más tarde', async () => {
    failUploads = true
    expect(await saveCheckin('u1', full)).toBe(false)
    failUploads = false
    await syncCheckins('u1')
    expect(server.has('u1:2026-10-05')).toBe(true)
  })

  it('sin copia local, lee el del servidor', async () => {
    server.set('u1:2026-10-06', { user_id: 'u1', date: '2026-10-06', sleep: 2, energy: 2 })
    expect(await fetchCheckin('u1', '2026-10-06')).toMatchObject({ sleep: 2, pending: false })
    online = false
    expect(await fetchCheckin('u1', '2026-10-07')).toBeNull()
  })

  it('«Ahora no» solo vale para ese día', async () => {
    await dismissCheckin('u1', '2026-10-05')
    expect(await isCheckinDismissed('u1', '2026-10-05')).toBe(true)
    expect(await isCheckinDismissed('u1', '2026-10-06')).toBe(false)
  })

  it('completo = los 4 valores', () => {
    expect(isComplete(full)).toBe(true)
    expect(isComplete({ ...full, stress: null })).toBe(false)
    expect(isComplete(null)).toBe(false)
  })
})
