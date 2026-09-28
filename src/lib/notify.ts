// Avisos de guardado (toasts). Ningún guardado debe fallar en silencio.
import { toast } from 'sonner'

// Mensajes de PostgREST/Postgres que el usuario no entendería.
const TECHNICAL: [RegExp, string][] = [
  [/permission denied|row-level security|42501/i, 'no tienes permiso para hacer este cambio'],
  [/failed to fetch|network|load failed/i, 'no hay conexión'],
  [/jwt|not authenticated/i, 'tu sesión ha caducado; vuelve a entrar'],
]

export function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  for (const [re, friendly] of TECHNICAL) if (re.test(raw)) return friendly
  return raw
}

// «No se ha podido guardar: <motivo>».
export function saveErrorText(error: unknown, action = 'guardar') {
  const reason = errorMessage(error)
  return reason ? `No se ha podido ${action}: ${reason}` : `No se ha podido ${action}`
}

export function notifyError(error: unknown, action = 'guardar') {
  console.error(`[${action}]`, error)
  toast.error(saveErrorText(error, action))
}

export function notifySaved(message = 'Guardado') {
  toast.success(message)
}
