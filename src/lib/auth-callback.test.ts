import { describe, expect, it } from 'vitest'
import { parseAuthCallback } from './auth-callback'

describe('parseAuthCallback', () => {
  it('detecta el código PKCE del magic link', () => {
    expect(parseAuthCallback('?code=abc', '')).toEqual({ kind: 'pkce', code: 'abc', type: null })
  })

  it('detecta los tokens de una invitación en el fragmento', () => {
    expect(
      parseAuthCallback('', '#access_token=at&refresh_token=rt&expires_in=3600&type=invite'),
    ).toEqual({ kind: 'tokens', accessToken: 'at', refreshToken: 'rt', type: 'invite' })
  })

  it('detecta token_hash con su tipo', () => {
    expect(parseAuthCallback('?token_hash=th&type=magiclink', '')).toEqual({
      kind: 'token_hash',
      tokenHash: 'th',
      type: 'magiclink',
    })
  })

  it('prioriza los errores que devuelve Supabase', () => {
    expect(
      parseAuthCallback('', '#error=access_denied&error_description=Email+link+is+invalid'),
    ).toEqual({ kind: 'error', message: 'Email link is invalid' })
  })

  it('marca como inválida una URL sin datos', () => {
    expect(parseAuthCallback('', '')).toEqual({ kind: 'invalid' })
    expect(parseAuthCallback('?token_hash=th', '')).toEqual({ kind: 'invalid' })
  })
})
