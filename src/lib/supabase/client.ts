import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

let browserClient: SupabaseClient<Database> | undefined

// Cliente de navegador: guarda la sesión en cookies para que el servidor también la lea.
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const { url, anonKey } = getPublicEnv()
    browserClient = createBrowserClient<Database>(url, anonKey, {
      // Los enlaces de invitación y magic link se procesan a mano en /auth/callback.
      auth: { detectSessionInUrl: false },
    })
  }
  return browserClient
}
