import type { EmailOtpType } from '@supabase/supabase-js'

export type AuthCallback =
  | { kind: 'error'; message: string }
  | { kind: 'pkce'; code: string; type: string | null }
  | { kind: 'token_hash'; tokenHash: string; type: EmailOtpType }
  | { kind: 'tokens'; accessToken: string; refreshToken: string; type: string | null }
  | { kind: 'invalid' }

// Interpreta la URL con la que Supabase vuelve a /auth/callback:
// magic link PKCE (?code=), plantillas con token_hash (?token_hash=&type=)
// e invitaciones con flujo implícito (#access_token=&refresh_token=&type=invite).
export function parseAuthCallback(search: string, hash: string): AuthCallback {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const get = (key: string) => query.get(key) ?? fragment.get(key)

  const error = get('error_description') ?? get('error')
  if (error) return { kind: 'error', message: error }

  const type = get('type')
  const code = query.get('code')
  if (code) return { kind: 'pkce', code, type }

  const tokenHash = query.get('token_hash')
  if (tokenHash && type) return { kind: 'token_hash', tokenHash, type: type as EmailOtpType }

  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken, type }

  return { kind: 'invalid' }
}
