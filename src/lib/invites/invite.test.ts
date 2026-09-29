import { describe, expect, it } from 'vitest'
import {
  inviteMessage,
  inviteProblemText,
  inviteStateLabel,
  inviteUrl,
  isInviteCodeFormat,
  normalizeInviteCode,
  temporaryPassword,
  whatsappShareUrl,
} from './invite'

describe('códigos de invitación', () => {
  it('normaliza como normalize_invite_code()', () => {
    expect(normalizeInviteCode('k7p4qx2mab3c')).toBe('K7P4-QX2M-AB3C')
    expect(normalizeInviteCode(' k7p4 - qx2m - ab3c ')).toBe('K7P4-QX2M-AB3C')
    expect(normalizeInviteCode('abc')).toBe('ABC')
  })

  it('formato: 12 símbolos sin 0/O ni 1/I', () => {
    expect(isInviteCodeFormat('K7P4-QX2M-AB3C')).toBe(true)
    expect(isInviteCodeFormat('K7P4-QX2M-AB0C')).toBe(false)
    expect(isInviteCodeFormat('K7P4-QX2M-ABIC')).toBe(false)
    expect(isInviteCodeFormat('K7P4-QX2M')).toBe(false)
  })

  it('texto y enlaces para compartir', () => {
    const url = inviteUrl('https://app.example/', 'K7P4-QX2M-AB3C')
    expect(url).toBe('https://app.example/unirse/K7P4-QX2M-AB3C')
    expect(inviteMessage('Juanjo', url)).toBe(`Juanjo te invita a entrenar juntos 💪 ${url}`)
    expect(inviteMessage(null, url)).toMatch(/^Alguien te invita/)
    const wa = whatsappShareUrl(inviteMessage('Ana', url))
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length))).toBe(
      inviteMessage('Ana', url),
    )
  })

  it('estado legible', () => {
    const base = { usedByName: null, uses: 0, maxUses: 1 }
    expect(inviteStateLabel({ ...base, state: 'active' })).toBe('Pendiente')
    expect(inviteStateLabel({ ...base, state: 'active', uses: 1, maxUses: 3 })).toBe(
      'Pendiente (1 de 3)',
    )
    expect(inviteStateLabel({ ...base, state: 'used', usedByName: 'Bea', uses: 1 })).toBe(
      'Usada por Bea',
    )
    expect(inviteStateLabel({ ...base, state: 'expired' })).toBe('Caducada')
    expect(inviteStateLabel({ ...base, state: 'revoked' })).toBe('Anulada')
  })

  it('mensajes claros para cada código que no vale', () => {
    for (const s of [
      'not_found',
      'expired',
      'revoked',
      'used',
      'inviter_inactive',
      'rate_limited',
      'unavailable',
    ] as const) {
      expect(inviteProblemText(s, 'Ana')).toBeTruthy()
    }
    expect(inviteProblemText('expired', 'Ana')).toContain('a Ana')
    expect(inviteProblemText('active')).toBeNull()
  })
})

describe('contraseña temporal', () => {
  it('xxxx-xxxx-xxxx con el alfabeto legible', () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 37)
    const pw = temporaryPassword(bytes)
    expect(pw).toMatch(/^[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}$/)
    expect(pw.length).toBeGreaterThanOrEqual(8)
  })
})
