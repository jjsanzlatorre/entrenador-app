import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { getPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

// Cliente con la sesión del usuario (cookies de la petición). Respeta RLS.
export function getSupabaseServerClient() {
  const { url, anonKey } = getPublicEnv()
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          setCookie(name, value, options)
        }
      },
    },
  })
}

// Cliente con service role. Salta RLS: usar solo tras comprobar permisos.
export function getSupabaseAdminClient() {
  const { url } = getPublicEnv()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.')
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
