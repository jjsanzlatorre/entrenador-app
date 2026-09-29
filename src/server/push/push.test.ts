import { describe, expect, it, vi } from 'vitest'
import { getPushConfig } from './config'
import { runDailyReminders, type ReminderData } from './reminders'
import { sendToUser, type PushStore, type Subscription } from './send'

const sub = (id: string): Subscription => ({
  id,
  endpoint: `https://push/${id}`,
  p256dh: 'k',
  auth: 'a',
})

function store(
  subs: Subscription[],
  claimed = new Set<string>(),
): PushStore & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    subscriptions: async () => subs,
    claim: async (u, k) => {
      if (claimed.has(`${u}|${k}`)) return false
      claimed.add(`${u}|${k}`)
      return true
    },
    markSuccess: async () => {},
    markFailure: async () => {},
    remove: async (ids) => {
      removed.push(...ids)
    },
  }
}

describe('config', () => {
  it('sin claves no está configurado', () => {
    expect(getPushConfig({}).configured).toBe(false)
    expect(getPushConfig({}).problem).toMatch(/VAPID_PUBLIC_KEY/)
  })
  it('con claves válidas sí; el subject se normaliza', () => {
    const c = getPushConfig({
      VAPID_PUBLIC_KEY: 'B'.repeat(87),
      VAPID_PRIVATE_KEY: 'x'.repeat(43),
      VAPID_SUBJECT: 'yo@example.com',
    })
    expect(c.configured).toBe(true)
    expect(c.subject).toBe('mailto:yo@example.com')
  })
})

describe('sendToUser', () => {
  it('envía, borra las suscripciones caducadas (410) y no repite la misma clave', async () => {
    const s = store([sub('a'), sub('b')])
    const transport = vi.fn(async (x: Subscription) => (x.id === 'a' ? 201 : 410))
    const r1 = await sendToUser(
      { transport, store: s },
      'u',
      { title: 't', body: 'b', url: '/' },
      'k',
    )
    expect(r1).toEqual({ sent: 1, failed: 0, removed: 1 })
    expect(s.removed).toEqual(['b'])
    const r2 = await sendToUser(
      { transport, store: s },
      'u',
      { title: 't', body: 'b', url: '/' },
      'k',
    )
    expect(r2.skipped).toBe('already_sent')
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('sin dispositivos no reserva la clave', async () => {
    const claimed = new Set<string>()
    const r = await sendToUser(
      { transport: vi.fn(), store: store([], claimed) },
      'u',
      { title: 't', body: 'b', url: '/' },
      'k',
    )
    expect(r.skipped).toBe('no_subscriptions')
    expect(claimed.size).toBe(0)
  })
})

describe('runDailyReminders', () => {
  const data = (over: Partial<ReminderData> = {}): ReminderData => ({
    users: async () => [
      {
        userId: 'u1',
        reminderTime: '08:00',
        tz: 'Europe/Madrid',
        planReminder: true,
        behindNudge: false,
      },
      {
        userId: 'u2',
        reminderTime: '20:00',
        tz: 'Europe/Madrid',
        planReminder: true,
        behindNudge: false,
      },
    ],
    alreadySent: async () => false,
    plannedToday: async () => ({ title: 'Pierna' }),
    commitments: async () => [],
    sessions: async () => [],
    ...over,
  })

  it('solo avisa a quien le toca a esta hora, con la clave del día', async () => {
    const send = vi.fn(async () => ({ sent: 1, failed: 0, removed: 0 }))
    const run = await runDailyReminders({
      data: data(),
      send,
      now: new Date('2026-09-29T06:10:00Z'), // 08:10 en Madrid
    })
    expect(run).toMatchObject({ checked: 2, due: 1, sent: 1 })
    expect(send).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Hoy toca: Pierna' }),
      'daily:2026-09-29',
    )
  })

  it('sin sesión planificada ni aviso no manda nada', async () => {
    const send = vi.fn()
    const run = await runDailyReminders({
      data: data({ plannedToday: async () => null }),
      send,
      now: new Date('2026-09-29T06:10:00Z'),
    })
    expect(send).not.toHaveBeenCalled()
    expect(run.skipped).toBe(1)
  })

  it('si ya se envió hoy, no vuelve a mirar', async () => {
    const send = vi.fn()
    await runDailyReminders({
      data: data({ alreadySent: async () => true }),
      send,
      now: new Date('2026-09-29T06:10:00Z'),
    })
    expect(send).not.toHaveBeenCalled()
  })
})
