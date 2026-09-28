// Utilidades comunes de los E2E contra el Supabase simulado (tests/e2e/mock-supabase.ts).
export const MOCK = 'http://localhost:54321'
export const USER_ID = '11111111-1111-4111-8111-111111111111'

// Cookie de sesión de @supabase/ssr con un JWT que el mock acepta.
export function authCookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, exp, role: 'authenticated', aud: 'authenticated' })}.sig`
  const session = {
    access_token: jwt,
    refresh_token: 'refresh',
    expires_at: exp,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: USER_ID, email: 'e2e@test.dev' },
  }
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
}
