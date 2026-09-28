import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetIdbForTests } from './idb'
import {
  backoffMs,
  enqueueDelete,
  enqueueSave,
  flushOutbox,
  listOutbox,
  makeAllDue,
} from './outbox'
import type { SessionPayload } from '@/lib/workout/payload'

const payload = (rev: number) =>
  ({ session: { id: 's1', client_rev: rev } }) as unknown as SessionPayload

beforeEach(async () => {
  await __resetIdbForTests()
})

describe('outbox', () => {
  it('agrupa varios guardados de la misma sesión en una sola entrada', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1), 1000)
    await enqueueSave('s1', 'u1', 2, payload(2), 2000)
    const items = await listOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'save', rev: 2, createdAt: 1000 })
  })

  it('envía y vacía la cola', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1))
    const save = vi.fn().mockResolvedValue(undefined)
    const result = await flushOutbox({ save, remove: vi.fn() }, 'u1')
    expect(save).toHaveBeenCalledWith(payload(1))
    expect(result.sent).toEqual(['s1'])
    expect(await listOutbox('u1')).toEqual([])
  })

  it('sin conexión reintenta con backoff y no pierde nada', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1))
    const save = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await flushOutbox({ save, remove: vi.fn() }, 'u1', 10_000)
    let [item] = await listOutbox('u1')
    expect(item).toMatchObject({ attempts: 1, nextAttemptAt: 12_000, lastError: 'Failed to fetch' })

    // Antes de tiempo no se reintenta.
    await flushOutbox({ save, remove: vi.fn() }, 'u1', 11_000)
    expect(save).toHaveBeenCalledTimes(1)

    await flushOutbox({ save, remove: vi.fn() }, 'u1', 12_000)
    ;[item] = await listOutbox('u1')
    expect(item).toMatchObject({ attempts: 2, nextAttemptAt: 16_000 })

    // Al volver la conexión se fuerza el reintento.
    await makeAllDue('u1')
    save.mockResolvedValue(undefined)
    await flushOutbox({ save, remove: vi.fn() }, 'u1', 12_500)
    expect(await listOutbox('u1')).toEqual([])
  })

  it('no borra una versión nueva que llegó mientras se enviaba la anterior', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1))
    const save = vi.fn().mockImplementation(async () => {
      await enqueueSave('s1', 'u1', 2, payload(2))
    })
    await flushOutbox({ save, remove: vi.fn() }, 'u1')
    const [item] = await listOutbox('u1')
    expect(item).toMatchObject({ rev: 2 })
  })

  it('borrar reemplaza un guardado pendiente', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1))
    await enqueueDelete('s1', 'u1')
    const save = vi.fn()
    const remove = vi.fn().mockResolvedValue(undefined)
    await flushOutbox({ save, remove }, 'u1')
    expect(save).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('s1')
  })

  it('cada usuario solo ve su cola', async () => {
    await enqueueSave('s1', 'u1', 1, payload(1))
    expect(await listOutbox('u2')).toEqual([])
  })

  it('backoff exponencial con tope de 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(backoffMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ])
  })
})
