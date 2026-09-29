import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './middleware'
import { getSupabaseAdminClient } from './supabase.server'

// Cambia la contraseña temporal que puso el admin y quita la obligación de cambiarla. Se hace en
// el servidor para que la marca solo se quite si la contraseña nueva se ha guardado.
export const changeTemporaryPassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      password: z
        .string()
        .min(8, 'La contraseña debe tener al menos 8 caracteres')
        .max(72, 'La contraseña es demasiado larga'),
    }),
  )
  .handler(async ({ data, context }) => {
    const admin = getSupabaseAdminClient()
    const { error } = await admin.auth.admin.updateUserById(context.auth.userId, {
      password: data.password,
    })
    if (error) {
      throw new Error(
        /password/i.test(error.message)
          ? 'La contraseña no es válida: usa al menos 8 caracteres y evita las comunes.'
          : error.message,
      )
    }
    const { error: flagError } = await admin
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', context.auth.userId)
    if (flagError) throw new Error(flagError.message)
    return { ok: true as const }
  })
