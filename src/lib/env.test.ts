import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeEnv, readPublicEnv } from './env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readPublicEnv (servidor)', () => {
  it('lee las variables en tiempo de ejecución', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
    expect(readPublicEnv()).toEqual({
      env: { supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: 'anon' },
      problems: [],
    })
  })

  it('quita espacios y comillas pegadas al copiar', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' "https://abc.supabase.co" ')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', "'anon'\n")
    expect(readPublicEnv().env).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon',
    })
  })

  it('lista lo que falta sin lanzar', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(readPublicEnv()).toEqual({
      env: null,
      problems: ['Falta VITE_SUPABASE_URL', 'Falta VITE_SUPABASE_ANON_KEY'],
    })
  })

  it('detecta una URL sin https://', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
    expect(readPublicEnv().problems).toEqual([
      'VITE_SUPABASE_URL no es una URL válida (debe empezar por https://)',
    ])
  })

  it('describeEnv solo expone booleanos', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'secret-looking-value')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    const json = JSON.stringify(describeEnv())
    expect(json).not.toContain('abc.supabase.co')
    expect(json).not.toContain('secret-looking-value')
    expect(json).not.toContain('service"')
    expect(describeEnv().runtime).toEqual({
      VITE_SUPABASE_URL: true,
      VITE_SUPABASE_ANON_KEY: true,
      SUPABASE_SERVICE_ROLE_KEY: true,
    })
  })
})
