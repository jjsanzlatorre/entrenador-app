// Reacciones 👏 🔥 💪 (fase 7A): sobre la semana de cumplimiento o una sesión compartida.
// Una por emoji y persona: tocar otra vez la quita.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { notifyError } from '@/lib/notify'
import {
  markReactionsSeen,
  REACTION_EMOJI,
  REACTION_LABEL,
  toggleReaction,
  type Reaction,
} from '@/lib/partners/api'
import { reactionsKey, useReactions } from '@/lib/partners/hooks'
import { pushReaction } from '@/lib/notifications/push'
import { usePartnerLinks } from '@/lib/progress/hooks'
import { formatDayMonth } from '@/lib/progress/dates'
import { cn } from '@/lib/utils'
import type { ReactionEmoji, ReactionKind } from '@/types/database'

const EMOJIS: ReactionEmoji[] = ['clap', 'fire', 'muscle']

// Botones para reaccionar a algo de otra persona.
export function ReactionBar({
  userId,
  to,
  toName,
  kind,
  targetKey,
  className,
}: {
  userId: string
  to: string
  toName: string
  kind: ReactionKind
  targetKey: string
  className?: string
}) {
  const reactions = useReactions(userId)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<ReactionEmoji | null>(null)
  const mine = new Set(
    (reactions.data ?? [])
      .filter(
        (r) => r.fromUser === userId && r.toUser === to && r.kind === kind && r.key === targetKey,
      )
      .map((r) => r.emoji),
  )
  const what = kind === 'week' ? 'su semana' : 'su sesión'

  async function toggle(emoji: ReactionEmoji) {
    setBusy(emoji)
    try {
      const added = await toggleReaction(to, kind, targetKey, emoji)
      if (added) pushReaction(to, kind, targetKey, emoji)
      await queryClient.invalidateQueries({ queryKey: reactionsKey(userId) })
    } catch (error) {
      notifyError(error, 'reaccionar')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn('flex gap-1.5', className)} role="group" aria-label={`Reaccionar a ${what}`}>
      {EMOJIS.map((emoji) => {
        const on = mine.has(emoji)
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={on}
            aria-label={`${REACTION_LABEL[emoji]} a ${what} de ${toName}`}
            disabled={busy !== null || reactions.isPending}
            onClick={() => void toggle(emoji)}
            className={cn(
              'flex h-9 min-w-11 items-center justify-center rounded-full border text-lg transition active:scale-90',
              on ? 'border-primary bg-primary/10' : 'bg-card opacity-70',
            )}
          >
            {REACTION_EMOJI[emoji]}
          </button>
        )
      })}
    </div>
  )
}

function groupByPerson(list: Reaction[]) {
  const by = new Map<string, ReactionEmoji[]>()
  for (const r of list) by.set(r.fromUser, [...(by.get(r.fromUser) ?? []), r.emoji])
  return [...by.entries()]
}

// Reacciones que he recibido sobre algo mío (mi semana o una sesión).
export function ReceivedReactions({
  userId,
  kind,
  targetKey,
  className,
}: {
  userId: string
  kind: ReactionKind
  targetKey: string
  className?: string
}) {
  const reactions = useReactions(userId)
  const links = usePartnerLinks(userId)
  const names = new Map((links.data ?? []).map((l) => [l.partnerId, l.displayName]))
  const received = (reactions.data ?? []).filter(
    (r) => r.toUser === userId && r.kind === kind && r.key === targetKey && names.has(r.fromUser),
  )
  if (received.length === 0) return null
  return (
    <p className={cn('text-muted-foreground text-xs', className)}>
      {groupByPerson(received)
        .map(
          ([from, emojis]) => `${names.get(from)} ${emojis.map((e) => REACTION_EMOJI[e]).join('')}`,
        )
        .join(' · ')}
    </p>
  )
}

// Aviso discreto en «Hoy» con las reacciones nuevas. Se cierra con un toque (quedan vistas).
export function ReactionsNotice({ userId }: { userId: string }) {
  const reactions = useReactions(userId)
  const links = usePartnerLinks(userId)
  const queryClient = useQueryClient()
  const names = new Map((links.data ?? []).map((l) => [l.partnerId, l.displayName]))
  const unseen = (reactions.data ?? []).filter(
    (r) => r.toUser === userId && !r.seenAt && names.has(r.fromUser),
  )
  if (unseen.length === 0) return null

  const lines = groupByPerson(unseen).map(([from, emojis]) => {
    const theirs = unseen.filter((r) => r.fromUser === from)
    const weeks = theirs.filter((r) => r.kind === 'week')
    const sessions = theirs.filter((r) => r.kind === 'session')
    const targets = [
      weeks.length > 0
        ? weeks.length === 1
          ? `a tu semana del ${formatDayMonth(weeks[0]!.key)}`
          : 'a tus semanas'
        : null,
      sessions.length > 0 ? (sessions.length === 1 ? 'a una sesión' : 'a tus sesiones') : null,
    ].filter(Boolean)
    return {
      from,
      text: `${names.get(from)} ${[...new Set(emojis)].map((e) => REACTION_EMOJI[e]).join('')} ${targets.join(' y ')}`,
      sessionId: sessions.length === 1 && weeks.length === 0 ? sessions[0]!.key : null,
    }
  })

  async function dismiss() {
    try {
      await markReactionsSeen()
      await queryClient.invalidateQueries({ queryKey: reactionsKey(userId) })
    } catch (error) {
      notifyError(error, 'marcar las reacciones como vistas')
    }
  }

  return (
    <div
      className="bg-muted/60 flex items-start gap-2 rounded-xl px-3 py-2 text-sm"
      role="status"
      aria-label="Reacciones nuevas"
    >
      <ul className="min-w-0 flex-1">
        {lines.map((l) => (
          <li key={l.from} className="truncate">
            {l.sessionId ? (
              <Link
                to="/entrenar/historial/$sessionId"
                params={{ sessionId: l.sessionId }}
                className="underline-offset-2 hover:underline"
                onClick={() => void dismiss()}
              >
                {l.text}
              </Link>
            ) : (
              l.text
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Cerrar el aviso de reacciones"
        className="text-muted-foreground -m-1 p-1"
        onClick={() => void dismiss()}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
