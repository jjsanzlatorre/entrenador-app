import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { getPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

// Cliente con la sesión del usuario (cookies de la petición). Respeta RLS.
export function getSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv()
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
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
  const { supabaseUrl } = getPublicEnv()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceRoleKey) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.')
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
