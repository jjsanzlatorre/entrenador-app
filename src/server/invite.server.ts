// Lógica de servidor de /unirse (separada de las createServerFn para poder probarla con un
// cliente de Supabase simulado). Usa siempre el cliente con service role.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InviteLookupStatus } from '@/lib/invites/invite'
import { normalizeInviteCode } from '@/lib/invites/invite'
import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>

// 10 intentos por hora y conexión. Cuentan los códigos que no existen y cada registro o canje.
export const INVITE_RATE_LIMIT = 10
export const INVITE_RATE_WINDOW_S = 3600

export function rateKey(ip: string | undefined) {
  return createHash('sha256')
    .update(`invite:${ip ?? 'unknown'}`)
    .digest('hex')
}

export async function isRateLimited(admin: Admin, key: string) {
  const { data, error } = await admin.rpc('invite_attempts_count', {
    p_key: key,
    p_window_s: INVITE_RATE_WINDOW_S,
  })
  if (error) throw new Error(error.message)
  return data >= INVITE_RATE_LIMIT
}

export async function recordAttempt(admin: Admin, key: string) {
  const { error } = await admin.rpc('record_invite_attempt', { p_key: key })
  if (error) throw new Error(error.message)
}

export type InviteLookup = {
  status: InviteLookupStatus
  code: string
  inviterName: string | null
}

export async function lookupInvite(admin: Admin, key: string, raw: string): Promise<InviteLookup> {
  const code = normalizeInviteCode(raw)
  if (await isRateLimited(admin, key)) return { status: 'rate_limited', code, inviterName: null }
  const { data, error } = await admin.rpc('lookup_invite_code', { p_code: code })
  if (error) throw new Error(error.message)
  const row = data[0]
  const status = row?.state ?? 'not_found'
  // Un código que no existe es lo que haría quien intenta adivinarlos.
  if (status === 'not_found') await recordAttempt(admin, key)
  return { status, code, inviterName: row?.inviter_name ?? null }
}

// Errores de redeem_invite_code → estado para la pantalla.
export function redeemErrorStatus(message: string): InviteLookupStatus | 'own' | null {
  const m = /invite_(not_found|revoked|used|expired|inviter_inactive|own)/.exec(message)
  if (!m) return null
  return m[1] as InviteLookupStatus | 'own'
}

export type RegisterInput = { code: string; name: string; email: string; password: string }

export type RegisterResult =
  | { status: 'ok'; inviterName: string | null }
  | { status: 'email_exists' }
  | { status: Exclude<InviteLookupStatus, 'active'> | 'own' }

// Crea la cuenta con un código válido. auth.admin.createUser no está dentro de la transacción de
// Postgres: si algo falla después (perfil o canje), se borra el usuario recién creado (el perfil
// y el resto de sus filas se borran en cascada) y el código queda como estaba (redeem_invite_code
// es una sola transacción).
export async function registerWithInviteCode(
  admin: Admin,
  key: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  if (await isRateLimited(admin, key)) return { status: 'rate_limited' }
  await recordAttempt(admin, key)

  const code = normalizeInviteCode(input.code)
  const { data: found, error: lookupError } = await admin.rpc('lookup_invite_code', {
    p_code: code,
  })
  if (lookupError) throw new Error(lookupError.message)
  const invite = found[0]
  if (!invite) return { status: 'not_found' }
  if (invite.state !== 'active') return { status: invite.state }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.name },
  })
  if (createError || !created.user) {
    const msg = createError?.message ?? ''
    if (
      createError?.code === 'email_exists' ||
      /already (been )?registered|already exists/i.test(msg)
    )
      return { status: 'email_exists' }
    if (createError?.code === 'weak_password' || /password/i.test(msg))
      throw new Error('La contraseña no es válida: usa al menos 8 caracteres y evita las comunes.')
    throw new Error(msg || 'No se ha podido crear la cuenta')
  }
  const userId = created.user.id

  let failure: RegisterResult | null = null
  try {
    // El trigger handle_new_user ya crea el perfil; se asegura con el nombre elegido.
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, display_name: input.name }, { onConflict: 'id' })
    if (profileError) throw new Error(profileError.message)

    const { error: redeemError } = await admin.rpc('redeem_invite_code', {
      p_code: code,
      p_user: userId,
    })
    if (redeemError) {
      const status = redeemErrorStatus(redeemError.message)
      if (!status || status === 'active') throw new Error(redeemError.message)
      failure = { status }
    }
  } catch (error) {
    await rollbackUser(admin, userId)
    throw error
  }
  if (failure) {
    await rollbackUser(admin, userId)
    return failure
  }
  return { status: 'ok', inviterName: invite.inviter_name }
}

async function rollbackUser(admin: Admin, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId)
  // deleteUser de un usuario ya borrado no es un problema; cualquier otro fallo se registra.
  if (error && !/not.?found/i.test(error.message)) {
    console.error('[unirse] no se pudo deshacer el usuario', userId, error)
  }
}

export type RedeemResult =
  | { status: 'linked' | 'already_linked'; inviterName: string | null }
  | { status: Exclude<InviteLookupStatus, 'active'> | 'own' }

// Una cuenta que ya existía canjea el código (tras iniciar sesión).
export async function redeemInviteForUser(
  admin: Admin,
  key: string,
  raw: string,
  userId: string,
): Promise<RedeemResult> {
  if (await isRateLimited(admin, key)) return { status: 'rate_limited' }
  await recordAttempt(admin, key)
  const code = normalizeInviteCode(raw)
  const { data: found, error: lookupError } = await admin.rpc('lookup_invite_code', {
    p_code: code,
  })
  if (lookupError) throw new Error(lookupError.message)
  const inviterName = found[0]?.inviter_name ?? null
  const { data, error } = await admin.rpc('redeem_invite_code', { p_code: code, p_user: userId })
  if (error) {
    const status = redeemErrorStatus(error.message)
    if (status && status !== 'active') return { status }
    throw new Error(error.message)
  }
  return { status: data, inviterName }
}
