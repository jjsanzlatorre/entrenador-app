// Registro de consultas en ai_interactions y límite diario por usuario (RPC en 0024).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiInteractionKind, Database, Json } from '@/types/database'
import type { ModelBlockStore } from './providers/chain'

export class DailyLimitError extends Error {
  constructor() {
    super('ai_daily_limit')
    this.name = 'DailyLimitError'
  }
}

// Ya hay una consulta igual en curso (p. ej. la revisión de esta semana desde otro móvil).
export class InProgressError extends Error {
  constructor() {
    super('ai_in_progress')
    this.name = 'InProgressError'
  }
}

export type FinishStatus = 'ok' | 'invalid' | 'error'

export interface UsageStore {
  // Abre la consulta; lanza DailyLimitError si ya se ha llegado al límite. period: semana de la
  // revisión semanal (InProgressError si ya hay una en curso para ese periodo).
  begin(kind: AiInteractionKind, inputSummary: unknown, period?: string): Promise<string>
  finish(
    id: string,
    result: {
      status: FinishStatus
      output?: unknown
      tokensIn?: number
      tokensOut?: number
      error?: string
      model?: string
    },
  ): Promise<void>
  usedToday(): Promise<number>
}

export function supabaseUsageStore(
  supabase: SupabaseClient<Database>,
  opts: { dailyLimit: number; tz: string; provider: string; model: string },
): UsageStore {
  return {
    async begin(kind, inputSummary, period) {
      const { data, error } = await supabase.rpc('begin_ai_interaction', {
        p_kind: kind,
        p_input_summary: (inputSummary ?? null) as Json,
        p_daily_limit: opts.dailyLimit,
        p_tz: opts.tz,
        p_provider: opts.provider,
        p_model: opts.model,
        p_period: period ?? null,
      })
      if (error) {
        if (/ai_daily_limit/.test(error.message)) throw new DailyLimitError()
        if (/ai_in_progress/.test(error.message)) throw new InProgressError()
        throw new Error(error.message)
      }
      return data
    },
    async finish(id, r) {
      const { error } = await supabase.rpc('finish_ai_interaction', {
        p_id: id,
        p_status: r.status,
        p_output: (r.output ?? null) as Json,
        p_tokens_in: r.tokensIn ?? null,
        p_tokens_out: r.tokensOut ?? null,
        p_error: r.error ?? null,
        p_model: r.model ?? null,
      })
      // No se interrumpe la respuesta al usuario por un fallo del registro.
      if (error) console.error('[ai] no se pudo cerrar la consulta', error.message)
    },
    async usedToday() {
      const { data, error } = await supabase.rpc('ai_calls_today', { p_tz: opts.tz })
      if (error) throw new Error(error.message)
      return data ?? 0
    },
  }
}

// Modelos bloqueados por cuota (0035): compartido entre peticiones y usuarios.
export function supabaseModelBlocks(supabase: SupabaseClient<Database>): ModelBlockStore {
  return {
    async blocked(models) {
      const { data, error } = await supabase.rpc('ai_blocked_models', { p_models: models })
      if (error) throw new Error(error.message)
      return new Map((data ?? []).map((r) => [r.model, { until: r.blocked_until, scope: r.scope }]))
    },
    async block(model, until, scope, reason) {
      const { error } = await supabase.rpc('block_ai_model', {
        p_model: model,
        p_until: until.toISOString(),
        p_scope: scope,
        p_reason: reason,
      })
      if (error) throw new Error(error.message)
    },
  }
}
