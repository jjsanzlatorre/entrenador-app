import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { adminMiddleware } from './middleware'
import { getSupabaseAdminClient } from './supabase.server'
import type { UserRole } from '@/types/database'

// Baneo largo (~100 años): invalida el refresh token de un usuario desactivado.
const DEACTIVATED_BAN = '876000h'

export type AdminUser = {
  id: string
  email: string | null
  displayName: string | null
  role: UserRole
  active: boolean
  invitedAt: string | null
  lastSignInAt: string | null
}

export const listUsers = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<AdminUser[]> => {
    const admin = getSupabaseAdminClient()
    const [{ data: authData, error: authError }, { data: profiles, error: profilesError }] =
      await Promise.all([
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from('profiles').select('*'),
      ])
    if (authError) throw new Error(authError.message)
    if (profilesError) throw new Error(profilesError.message)

    const byId = new Map(profiles.map((p) => [p.id, p]))
    return authData.users
      .map((u) => {
        const p = byId.get(u.id)
        return {
          id: u.id,
          email: u.email ?? null,
          displayName: p?.display_name ?? null,
          role: p?.role ?? 'member',
          active: p?.active ?? false,
          invitedAt: u.invited_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
        }
      })
      .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))
  })

export const inviteUser = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ email: z.email('Email no válido').trim().toLowerCase() }))
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const origin = new URL(getRequest().url).origin
    const { error } = await admin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: `${origin}/auth/callback`,
    })
    if (error) {
      if (error.code === 'email_exists' || /already/i.test(error.message)) {
        throw new Error('Ese email ya tiene cuenta')
      }
      throw new Error(error.message)
    }
    return { ok: true as const }
  })

export const setUserActive = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ userId: z.uuid(), active: z.boolean() }))
  .handler(async ({ data, context }) => {
    if (data.userId === context.auth.userId) {
      throw new Error('No puedes desactivarte a ti mismo')
    }
    const admin = getSupabaseAdminClient()
    const { error: profileError } = await admin
      .from('profiles')
      .update({ active: data.active })
      .eq('id', data.userId)
    if (profileError) throw new Error(profileError.message)

    const { error: banError } = await admin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? 'none' : DEACTIVATED_BAN,
    })
    if (banError) throw new Error(banError.message)
    return { ok: true as const }
  })
