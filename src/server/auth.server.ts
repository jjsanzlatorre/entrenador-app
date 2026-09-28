import { getSupabaseServerClient } from './supabase.server'
import type { Profile } from '@/types/database'

export type AuthState =
  | { status: 'anonymous' }
  | { status: 'inactive'; email: string | null }
  | { status: 'active'; userId: string; email: string | null; profile: Profile }

// Valida el JWT contra Supabase (getUser) y carga el profile.
export async function loadAuthState(): Promise<AuthState> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { status: 'anonymous' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!profile || !profile.active) {
    return { status: 'inactive', email: data.user.email ?? null }
  }
  return { status: 'active', userId: data.user.id, email: data.user.email ?? null, profile }
}
