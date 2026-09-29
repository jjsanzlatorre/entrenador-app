import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { adminMiddleware } from './middleware'
import { getSupabaseAdminClient } from './supabase.server'
import { temporaryPassword } from '@/lib/invites/invite'
import type { UserRole } from '@/types/database'

// Baneo largo (~100 años): invalida el refresh token de un usuario desactivado.
const DEACTIVATED_BAN = '876000h'

export type AdminUser = {
  id: string
  email: string | null
  displayName: string | null
  role: UserRole
  active: boolean
  mustChangePassword: boolean
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
          mustChangePassword: p?.must_change_password ?? false,
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

// Contraseña temporal (recuperar el acceso sin email). Se devuelve una sola vez para que el admin
// la copie; al entrar con ella, la app obliga a cambiarla (profiles.must_change_password).
export const setTemporaryPassword = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ userId: z.uuid() }))
  .handler(async ({ data, context }) => {
    if (data.userId === context.auth.userId) {
      throw new Error('Cambia tu propia contraseña desde Perfil')
    }
    const admin = getSupabaseAdminClient()
    const password = temporaryPassword((n) => randomBytes(n))
    // Primero la marca: si luego falla la contraseña, se quita.
    const { error: flagError } = await admin
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', data.userId)
    if (flagError) throw new Error(flagError.message)
    const { error } = await admin.auth.admin.updateUserById(data.userId, { password })
    if (error) {
      await admin.from('profiles').update({ must_change_password: false }).eq('id', data.userId)
      throw new Error(error.message)
    }
    return { password }
  })
