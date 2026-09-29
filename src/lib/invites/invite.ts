// Invitaciones por enlace: formato del código, textos para compartir y estado legible.
// Sin dependencias del navegador (se usa también en el servidor y en los tests).
import type { InviteCodeState } from '@/types/database'

// Mismo alfabeto que generate_invite_code() (0030): sin 0/O ni 1/I.
export const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_RE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/

// Igual que normalize_invite_code(): mayúsculas, sin separadores y con los guiones en su sitio.
export function normalizeInviteCode(raw: string) {
  const c = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c
}

export function isInviteCodeFormat(code: string) {
  return CODE_RE.test(code)
}

export function inviteUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, '')}/unirse/${code}`
}

export function inviteMessage(inviterName: string | null | undefined, url: string) {
  const name = inviterName?.trim() || 'Alguien'
  return `${name} te invita a entrenar juntos 💪 ${url}`
}

export function whatsappShareUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// Estado de /unirse/{código} (lo que devuelve el servidor).
export type InviteLookupStatus =
  InviteCodeState | 'not_found' | 'inviter_inactive' | 'rate_limited' | 'unavailable'

// Mensaje para cada código que no se puede usar.
export function inviteProblemText(status: InviteLookupStatus, inviterName?: string | null) {
  const who = inviterName?.trim()
  switch (status) {
    case 'not_found':
      return 'Este enlace de invitación no existe. Revisa que esté completo o pide uno nuevo.'
    case 'expired':
      return `Esta invitación ha caducado. Pide ${who ? `a ${who} ` : ''}un enlace nuevo.`
    case 'revoked':
      return 'Esta invitación se ha anulado. Pide un enlace nuevo a quien te la envió.'
    case 'used':
      return 'Esta invitación ya se ha usado. Pide un enlace nuevo a quien te la envió.'
    case 'inviter_inactive':
      return 'Esta invitación ya no es válida.'
    case 'rate_limited':
      return 'Demasiados intentos desde esta conexión. Espera un rato y vuelve a probar.'
    case 'unavailable':
      return 'Las invitaciones no están disponibles ahora mismo. Inténtalo más tarde.'
    case 'active':
      return null
  }
}

export type InviteListRow = {
  state: InviteCodeState
  usedByName: string | null
  uses: number
  maxUses: number
}

// «Pendiente», «Usada por Ana», «Caducada», «Anulada».
export function inviteStateLabel(row: InviteListRow) {
  switch (row.state) {
    case 'active':
      return row.maxUses > 1 ? `Pendiente (${row.uses} de ${row.maxUses})` : 'Pendiente'
    case 'used':
      return row.usedByName ? `Usada por ${row.usedByName}` : 'Usada'
    case 'expired':
      return row.uses > 0 && row.usedByName ? `Caducada (usada por ${row.usedByName})` : 'Caducada'
    case 'revoked':
      return 'Anulada'
  }
}

// Contraseña temporal legible (xxxx-xxxx-xxxx, 60 bits) para dictarla o mandarla por WhatsApp.
export function temporaryPassword(randomBytes: (n: number) => Uint8Array) {
  const alphabet = INVITE_ALPHABET.toLowerCase()
  const bytes = randomBytes(12)
  let out = ''
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i]! % 32]
    if (i === 3 || i === 7) out += '-'
  }
  return out
}

// Código pendiente de aplicar tras iniciar sesión (cuando el email ya tenía cuenta).
const PENDING_KEY = 'entrenador:pending-invite'

export function savePendingInvite(code: string) {
  try {
    localStorage.setItem(PENDING_KEY, normalizeInviteCode(code))
  } catch {
    // sin almacenamiento: el usuario puede volver a abrir el enlace con la sesión iniciada
  }
}

export function readPendingInvite() {
  try {
    return localStorage.getItem(PENDING_KEY)
  } catch {
    return null
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // nada que borrar
  }
}

// Adónde ir al terminar el onboarding de alguien que acaba de unirse (pantalla de instalar).
const AFTER_ONBOARDING_KEY = 'entrenador:after-onboarding'

export function markJustJoined() {
  try {
    localStorage.setItem(AFTER_ONBOARDING_KEY, 'install')
  } catch {
    // sin almacenamiento: tras el onboarding se va al plan como siempre
  }
}

export function takeJustJoined() {
  try {
    const v = localStorage.getItem(AFTER_ONBOARDING_KEY) === 'install'
    localStorage.removeItem(AFTER_ONBOARDING_KEY)
    return v
  } catch {
    return false
  }
}
