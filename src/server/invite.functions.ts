import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP } from '@tanstack/react-start/server'
import { z } from 'zod'
import { authMiddleware } from './middleware'
import { getSupabaseAdminClient } from './supabase.server'
import {
  lookupInvite,
  rateKey,
  redeemInviteForUser,
  registerWithInviteCode,
  type InviteLookup,
} from './invite.server'

const codeSchema = z.string().trim().min(1).max(40)

function currentKey() {
  return rateKey(getRequestIP({ xForwardedFor: true }))
}

function adminOrNull() {
  try {
    return getSupabaseAdminClient()
  } catch (error) {
    console.error('[unirse]', error)
    return null
  }
}

// Estado de un código para /unirse/{código}. Sin sesión: lo usa quien aún no tiene cuenta.
export const getInvite = createServerFn({ method: 'GET' })
  .validator(z.object({ code: codeSchema }))
  .handler(async ({ data }): Promise<InviteLookup & { origin: string }> => {
    const origin = new URL(getRequest().url).origin
    const admin = adminOrNull()
    if (!admin) return { status: 'unavailable', code: data.code, inviterName: null, origin }
    try {
      return { ...(await lookupInvite(admin, currentKey(), data.code)), origin }
    } catch (error) {
      console.error('[unirse] lookup', error)
      return { status: 'unavailable', code: data.code, inviterName: null, origin }
    }
  })

const registerSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(1, 'Escribe tu nombre').max(60, 'Nombre demasiado largo'),
    email: z.email('Email no válido').trim().toLowerCase(),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(72, 'La contraseña es demasiado larga'),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Las contraseñas no coinciden',
    path: ['passwordConfirm'],
  })

// Crea la cuenta con un código válido (registro público desactivado: es la única vía).
export const registerWithInvite = createServerFn({ method: 'POST' })
  .validator(registerSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    return registerWithInviteCode(admin, currentKey(), {
      code: data.code,
      name: data.name,
      email: data.email,
      password: data.password,
    })
  })

// Canjea un código con la cuenta que ya tiene sesión (el email ya existía).
export const redeemInvite = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ code: codeSchema }))
  .handler(async ({ data, context }) => {
    const admin = getSupabaseAdminClient()
    return redeemInviteForUser(admin, currentKey(), data.code, context.auth.userId)
  })
