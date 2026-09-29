// Invitaciones por enlace desde el navegador (RPC de 0030 con la sesión del usuario).
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isOnline, OfflineError, withTimeout } from '@/lib/workout/api'
import type { InviteCodeState } from '@/types/database'

export type InviteStatus = {
  canInvite: boolean
  isAdmin: boolean
  maxActive: number | null
  activeCount: number
}

export type InviteCode = {
  id: string
  code: string
  createdBy: string
  createdByName: string | null
  createdAt: string
  expiresAt: string
  maxUses: number
  uses: number
  usedByName: string | null
  usedAt: string | null
  state: InviteCodeState
}

export type InviteSettings = { membersCanInvite: boolean; maxActivePerUser: number }

function db() {
  return getSupabaseBrowserClient()
}

function friendly(message: string) {
  if (/invite_not_allowed/.test(message)) return 'El admin no ha activado las invitaciones.'
  if (/invite_limit/.test(message))
    return 'Ya tienes el máximo de invitaciones pendientes. Anula alguna para crear otra.'
  if (/invite_not_found/.test(message)) return 'Esa invitación ya no existe.'
  return message
}

async function run<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  if (!isOnline()) throw new OfflineError('Necesitas conexión')
  const res = await withTimeout(promise)
  if (res.error) throw new Error(friendly(res.error.message))
  return res.data
}

export async function fetchInviteStatus(): Promise<InviteStatus> {
  const rows = await run(db().rpc('my_invite_status'))
  const r = rows?.[0]
  return {
    canInvite: r?.can_invite ?? false,
    isAdmin: r?.is_admin ?? false,
    maxActive: r?.max_active ?? null,
    activeCount: r?.active_count ?? 0,
  }
}

export async function createInviteCode(opts?: { days?: number; maxUses?: number }) {
  const row = await run(
    db().rpc('create_invite_code', {
      p_expires_days: opts?.days ?? 7,
      p_max_uses: opts?.maxUses ?? 1,
    }),
  )
  if (!row) throw new Error('No se ha podido crear la invitación')
  return row.code
}

export function revokeInviteCode(id: string) {
  return run(db().rpc('revoke_invite_code', { p_id: id }))
}

export async function fetchInviteCodes(all = false): Promise<InviteCode[]> {
  const rows = await run(db().rpc('list_invite_codes', { p_all: all }))
  return (rows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    uses: r.uses,
    usedByName: r.used_by_name,
    usedAt: r.used_at,
    state: r.state,
  }))
}

export async function fetchInviteSettings(): Promise<InviteSettings> {
  const row = await run(db().from('app_settings').select('*').maybeSingle())
  return {
    membersCanInvite: row?.members_can_invite ?? false,
    maxActivePerUser: row?.max_active_invites_per_user ?? 3,
  }
}

export function saveInviteSettings(s: InviteSettings) {
  return run(
    db().rpc('set_invite_settings', {
      p_members_can_invite: s.membersCanInvite,
      p_max_active: s.maxActivePerUser,
    }),
  )
}
