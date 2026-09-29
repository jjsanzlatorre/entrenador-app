// Revisiones semanales guardadas en ai_interactions (kind weekly_review, period = lunes de la
// semana revisada). Volver a abrirla no llama a la IA.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChangeResponses, WeeklyReview } from '@/lib/ai/schemas'
import type { Database } from '@/types/database'
import type { ReviewStore } from './coach'

export function parseResponses(value: unknown): ChangeResponses {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v === 'accepted' || v === 'discarded'),
  ) as ChangeResponses
}

// Comprobación ligera de lo guardado (lo escribió el servidor, pero puede ser de otra versión).
export function parseStoredReview(value: unknown): WeeklyReview | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Partial<WeeklyReview>
  if (
    typeof r.weekStart !== 'string' ||
    !r.facts ||
    !r.review ||
    typeof r.review.headline !== 'string' ||
    !Array.isArray(r.review.recommendations) ||
    !Array.isArray(r.changes)
  ) {
    return null
  }
  return { ...r, dropped: Array.isArray(r.dropped) ? r.dropped : [] } as WeeklyReview
}

export function supabaseReviewStore(
  supabase: SupabaseClient<Database>,
  userId: string,
): ReviewStore {
  return {
    async latest(weekStart) {
      const { data, error } = await supabase
        .from('ai_interactions')
        .select('id, output, responses, created_at')
        .eq('user_id', userId)
        .eq('kind', 'weekly_review')
        .eq('status', 'ok')
        .eq('period', weekStart)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      const review = data ? parseStoredReview(data.output) : null
      if (!data || !review) return null
      return {
        interactionId: data.id,
        review,
        responses: parseResponses(data.responses),
        createdAt: data.created_at,
      }
    },
  }
}
