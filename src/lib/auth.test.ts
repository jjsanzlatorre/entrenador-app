import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

const state = { popups: true }

vi.mock('@/server/auth.functions', () => ({
  getAuthState: vi.fn(async () => ({
    status: 'active',
    userId: 'u1',
    email: null,
    profile: { show_equivalence_popups: state.popups },
  })),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseBrowserClient: vi.fn() }))
vi.mock('@/lib/pwa', () => ({ clearCachedPages: vi.fn() }))

const { ensureAuthState, resetAuthState } = await import('./auth')

type Active = { profile: { show_equivalence_popups: boolean } }

describe('resetAuthState', () => {
  it('tras guardar el perfil, el root recibe el perfil nuevo (no la copia en caché)', async () => {
    const qc = new QueryClient()
    const before = (await ensureAuthState(qc)) as unknown as Active
    expect(before.profile.show_equivalence_popups).toBe(true)

    state.popups = false // guardado en la base de datos
    await resetAuthState(qc)
    const after = (await ensureAuthState(qc)) as unknown as Active
    expect(after.profile.show_equivalence_popups).toBe(false)
  })
})
