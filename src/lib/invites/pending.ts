// Código de invitación pendiente: quien ya tenía cuenta abrió /unirse/{código} y fue a iniciar
// sesión. Al entrar en la app se canjea (vínculo con quien le invitó) y se borra.
import type { QueryClient } from '@tanstack/react-query'
import { redeemInvite } from '@/server/invite.functions'
import { partnersKey } from '@/lib/progress/hooks'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import { clearPendingInvite, inviteProblemText, readPendingInvite } from './invite'

let running = false

export async function applyPendingInvite(queryClient: QueryClient, userId: string) {
  const code = readPendingInvite()
  if (!code || running || !navigator.onLine) return
  running = true
  try {
    const result = await redeemInvite({ data: { code } })
    clearPendingInvite()
    if (result.status === 'linked' || result.status === 'already_linked') {
      const who = result.inviterName ?? 'quien te invitó'
      notifySaved(
        result.status === 'linked'
          ? `Ya estás vinculado con ${who}`
          : `Ya estabas vinculado con ${who}`,
      )
      await queryClient.invalidateQueries({ queryKey: partnersKey(userId) })
    } else if (result.status !== 'own') {
      notifyWarning(inviteProblemText(result.status) ?? 'La invitación no es válida')
    }
  } catch (error) {
    notifyError(error, 'aplicar la invitación')
  } finally {
    running = false
  }
}
