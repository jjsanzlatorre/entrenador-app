// Emojis y nombres de las reacciones (cliente y servidor).
import type { ReactionEmoji } from '@/types/database'

export const REACTION_EMOJI: Record<ReactionEmoji, string> = {
  clap: '👏',
  fire: '🔥',
  muscle: '💪',
}
export const REACTION_LABEL: Record<ReactionEmoji, string> = {
  clap: 'Aplauso',
  fire: 'Fuego',
  muscle: 'Fuerza',
}
