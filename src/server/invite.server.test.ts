// Registro con código contra un cliente de Supabase simulado: límite de intentos, email
// existente y deshacer el usuario si el canje falla (sin usuarios ni códigos a medias).
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  INVITE_RATE_LIMIT,
  lookupInvite,
  rateKey,
  redeemErrorStatus,
  redeemInviteForUser,
  registerWithInviteCode,
} from './invite.server'

type Fake = {
  attempts: number
  state: string
  users: string[]
  deleted: string[]
  redeemError: string | null
  createError: { code?: string; message: string } | null
}

function fakeAdmin(init: Partial<Fake> = {}) {
  const f: Fake = {
    attempts: 0,
    state: 'active',
    users: [],
    deleted: [],
    redeemError: null,
    createError: null,
    ...init,
  }
  const client = {
    rpc: (fn: string) => {
      switch (fn) {
        case 'invite_attempts_count':
          return Promise.resolve({ data: f.attempts, error: null })
        case 'record_invite_attempt':
          f.attempts++
          return Promise.resolve({ data: null, error: null })
        case 'lookup_invite_code':
          return Promise.resolve({
            data: [
              { state: f.state, code: 'K7P4-QX2M-AB3C', inviter_id: 'x', inviter_name: 'Ana' },
            ],
            error: null,
          })
        case 'redeem_invite_code':
          return Promise.resolve(
            f.redeemError
              ? { data: null, error: { message: f.redeemError } }
              : { data: 'linked', error: null },
          )
        default:
          throw new Error(fn)
      }
    },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    auth: {
      admin: {
        createUser: () => {
          if (f.createError) return Promise.resolve({ data: { user: null }, error: f.createError })
          const id = `user-${f.users.length + 1}`
          f.users.push(id)
          return Promise.resolve({ data: { user: { id } }, error: null })
        },
        deleteUser: (id: string) => {
          f.deleted.push(id)
          f.users = f.users.filter((u) => u !== id)
          return Promise.resolve({ data: {}, error: null })
        },
      },
    },
  }
  return { f, admin: client as unknown as SupabaseClient<Database> }
}

const input = { code: 'k7p4qx2mab3c', name: 'Bea', email: 'bea@test.dev', password: '12345678' }

describe('registro con código', () => {
  it('válido: crea el usuario y canjea', async () => {
    const { f, admin } = fakeAdmin()
    expect(await registerWithInviteCode(admin, 'k', input)).toEqual({
      status: 'ok',
      inviterName: 'Ana',
    })
    expect(f.users).toEqual(['user-1'])
    expect(f.attempts).toBe(1)
  })

  it('código no válido: no crea usuario', async () => {
    for (const state of ['expired', 'revoked', 'used', 'not_found']) {
      const { f, admin } = fakeAdmin({ state })
      expect(await registerWithInviteCode(admin, 'k', input)).toEqual({ status: state })
      expect(f.users).toEqual([])
    }
  })

  it('el canje falla (p. ej. otro lo gastó a la vez): se borra el usuario creado', async () => {
    const { f, admin } = fakeAdmin({ redeemError: 'invite_used' })
    expect(await registerWithInviteCode(admin, 'k', input)).toEqual({ status: 'used' })
    expect(f.deleted).toEqual(['user-1'])
    expect(f.users).toEqual([])
  })

  it('error inesperado del canje: se borra el usuario y se lanza el error', async () => {
    const { f, admin } = fakeAdmin({ redeemError: 'connection reset' })
    await expect(registerWithInviteCode(admin, 'k', input)).rejects.toThrow(/connection reset/)
    expect(f.deleted).toEqual(['user-1'])
  })

  it('email ya registrado', async () => {
    const { f, admin } = fakeAdmin({
      createError: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
      },
    })
    expect(await registerWithInviteCode(admin, 'k', input)).toEqual({ status: 'email_exists' })
    expect(f.users).toEqual([])
  })

  it('límite de intentos por IP', async () => {
    const { f, admin } = fakeAdmin({ attempts: INVITE_RATE_LIMIT })
    expect(await registerWithInviteCode(admin, 'k', input)).toEqual({ status: 'rate_limited' })
    expect(f.users).toEqual([])
    expect((await lookupInvite(admin, 'k', 'X')).status).toBe('rate_limited')
  })

  it('consultar un código inexistente cuenta como intento; uno válido, no', async () => {
    const ok = fakeAdmin()
    await lookupInvite(ok.admin, 'k', 'K7P4QX2MAB3C')
    expect(ok.f.attempts).toBe(0)
    const bad = fakeAdmin({ state: 'not_found' })
    await lookupInvite(bad.admin, 'k', 'ZZZZ')
    expect(bad.f.attempts).toBe(1)
  })

  it('cuenta existente canjea tras entrar', async () => {
    const { admin } = fakeAdmin()
    expect(await redeemInviteForUser(admin, 'k', input.code, 'me')).toEqual({
      status: 'linked',
      inviterName: 'Ana',
    })
    const own = fakeAdmin({ redeemError: 'invite_own' })
    expect(await redeemInviteForUser(own.admin, 'k', input.code, 'me')).toEqual({ status: 'own' })
  })
})

describe('utilidades', () => {
  it('la clave de límite no guarda la IP en claro', () => {
    expect(rateKey('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/)
    expect(rateKey('1.2.3.4')).not.toContain('1.2.3.4')
    expect(rateKey('1.2.3.4')).not.toBe(rateKey('1.2.3.5'))
  })

  it('traduce los errores del canje', () => {
    expect(redeemErrorStatus('invite_expired')).toBe('expired')
    expect(redeemErrorStatus('invite_inviter_inactive')).toBe('inviter_inactive')
    expect(redeemErrorStatus('otra cosa')).toBeNull()
  })
})
