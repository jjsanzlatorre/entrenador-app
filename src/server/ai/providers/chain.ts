// Cadena de modelos con presupuesto de tiempo (CLAUDE.md §11):
// - Orden: pesado (GEMINI_MODEL_HEAVY, solo en tareas pesadas) → normal (GEMINI_MODEL) → reserva
//   (GEMINI_FALLBACK_MODEL). Si un modelo devuelve 429 / cuota agotada, error del proveedor,
//   petición rechazada o tarda demasiado, se pasa al siguiente en vez de fallar.
// - Cada llamada tiene su tiempo máximo (el del papel del modelo) y todas comparten el
//   presupuesto de la consulta: la suma nunca pasa de `budgetMs` (la función de Vercel corta a
//   los 60 s).
// - El pesado se usa como mucho una vez por consulta: el reintento (salida no válida o texto ↔
//   tarjetas) va al normal.
// - Un modelo que ha fallado en esta consulta no se vuelve a probar en ella.
// - Cuota agotada: el modelo queda bloqueado (ModelBlockStore, compartido entre peticiones y
//   usuarios porque la cuota es de la clave) hasta el día siguiente si es la diaria (medianoche
//   del Pacífico, cuando Google la renueva) o unos segundos si es por minuto. Mientras, ni se
//   intenta.
import {
  AiProviderError,
  type AiProvider,
  type AiProviderErrorKind,
  type JsonRequest,
  type JsonResponse,
  type ModelAttempt,
  type QuotaScope,
} from './types'

export type ChainRole = ModelAttempt['role']

export type ChainStep = { role: ChainRole; provider: AiProvider; timeoutMs: number }

export interface ModelBlockStore {
  // Modelos bloqueados ahora mismo → hasta cuándo (ISO) y alcance.
  blocked(models: string[]): Promise<Map<string, { until: string; scope: QuotaScope | null }>>
  block(model: string, until: Date, scope: QuotaScope | null, reason: string): Promise<void>
}

export type ChainOptions = {
  steps: ChainStep[]
  blocks?: ModelBlockStore | null
  // Tiempo total de todas las llamadas de la consulta.
  budgetMs: number
  // No se empieza una llamada con menos tiempo que esto.
  minCallMs?: number
  now?: () => number
}

export type ModelChain = AiProvider & {
  readonly attempts: ModelAttempt[]
  // Tiempo desde que se creó la cadena (inicio de la consulta).
  elapsedMs(): number
}

// Errores con los que se pasa al siguiente modelo. auth (misma clave para todos), blocked y
// truncated (los trata generateStructured) no.
const FALL_THROUGH = new Set<AiProviderErrorKind>([
  'quota',
  'timeout',
  'unavailable',
  'bad_request',
])

export const QUOTA_RESET_TZ = 'America/Los_Angeles'

function tzOffsetMs(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return local - Math.floor(at.getTime() / 1000) * 1000
}

// Siguiente medianoche en la zona en que se renueva la cuota diaria de Gemini.
export function nextQuotaReset(now: Date, timeZone = QUOTA_RESET_TZ): Date {
  const local = new Date(now.getTime() + tzOffsetMs(now, timeZone))
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)
  let at = midnight - tzOffsetMs(new Date(midnight), timeZone)
  // Cambio de hora entre medias: se corrige con el desfase de ese instante.
  at = midnight - tzOffsetMs(new Date(at), timeZone)
  return new Date(at)
}

// Hasta cuándo se bloquea un modelo tras un 429.
export function blockUntil(error: AiProviderError, now: Date): Date {
  if (error.scope === 'daily') return nextQuotaReset(now)
  const seconds = Math.min(Math.max(error.retryAfterS ?? 60, 10), 300)
  return new Date(now.getTime() + seconds * 1000)
}

// Error final cuando ningún modelo ha respondido: cuota si todos estaban sin cuota (diaria si
// todas lo eran), tiempo agotado si alguno tardó demasiado o no quedó tiempo y, si no, el último.
export function chainError(attempts: ModelAttempt[], outOfTime: boolean): AiProviderError {
  const failed = attempts.filter((a) => a.outcome !== 'ok')
  const summary = failed
    .map(
      (a) =>
        `${a.model}: ${a.outcome}${a.status ? ` ${a.status}` : ''}${a.scope ? ` (${a.scope})` : ''}`,
    )
    .join(' → ')
  const quotaLike = (a: ModelAttempt) =>
    a.outcome === 'quota' || (a.outcome === 'skipped' && a.blocked_until !== undefined)
  if (failed.length > 0 && failed.every(quotaLike) && !outOfTime) {
    const err = new AiProviderError('quota', `Sin cuota en todos los modelos: ${summary}`, 429)
    const scopes = failed.map((a) => a.scope ?? null)
    err.scope = scopes.every((s) => s === 'daily')
      ? 'daily'
      : scopes.some((s) => s === 'minute')
        ? 'minute'
        : null
    return err
  }
  if (outOfTime || failed.some((a) => a.outcome === 'timeout')) {
    return new AiProviderError('timeout', `Tiempo agotado: ${summary || 'sin tiempo'}`)
  }
  const last = [...failed].reverse().find((a) => a.outcome !== 'skipped')
  const kind =
    last && last.outcome !== 'ok' && last.outcome !== 'skipped' ? last.outcome : 'unavailable'
  return new AiProviderError(
    kind === 'quota' ? 'unavailable' : kind,
    `Ningún modelo ha respondido: ${summary || 'sin modelos'}`,
    last?.status,
  )
}

export function createModelChain(opts: ChainOptions): ModelChain {
  const now = opts.now ?? Date.now
  const start = now()
  const minCallMs = opts.minCallMs ?? 3000
  // Quitar modelos repetidos (p. ej. la reserva igual que el normal).
  const steps = opts.steps.filter(
    (s, i) => opts.steps.findIndex((o) => o.provider.model === s.provider.model) === i,
  )
  const attempts: ModelAttempt[] = []
  const dead = new Set<string>()
  let loaded: Promise<void> | null = null
  let current = steps[0]?.provider.model ?? ''

  const loadBlocks = async () => {
    if (!opts.blocks || steps.length === 0) return
    try {
      const blocked = await opts.blocks.blocked(steps.map((s) => s.provider.model))
      for (const s of steps) {
        const b = blocked.get(s.provider.model)
        if (!b) continue
        dead.add(s.provider.model)
        attempts.push({
          model: s.provider.model,
          role: s.role,
          outcome: 'skipped',
          scope: b.scope,
          ms: 0,
          detail: 'bloqueado por cuota',
          blocked_until: b.until,
        })
      }
    } catch (error) {
      // Sin el registro de bloqueos se prueba igual (como mucho se gasta una llamada).
      console.error('[ai] no se pudieron leer los modelos bloqueados', error)
    }
  }

  const record = async (step: ChainStep, error: AiProviderError, ms: number, timeoutMs: number) => {
    const attempt: ModelAttempt = {
      model: step.provider.model,
      role: step.role,
      outcome: error.kind,
      ms,
      timeout_ms: timeoutMs,
      detail: error.message.slice(0, 300),
      ...(error.status ? { status: error.status } : {}),
      ...(error.kind === 'quota' ? { scope: error.scope } : {}),
    }
    attempts.push(attempt)
    if (error.kind === 'quota' && opts.blocks) {
      const until = blockUntil(error, new Date(now()))
      attempt.blocked_until = until.toISOString()
      try {
        await opts.blocks.block(
          step.provider.model,
          until,
          error.scope,
          error.message.slice(0, 300),
        )
      } catch (e) {
        console.error('[ai] no se pudo guardar el bloqueo del modelo', e)
      }
    }
  }

  return {
    name: steps[0]?.provider.name ?? 'none',
    get model() {
      return current
    },
    attempts,
    elapsedMs: () => now() - start,
    async generateJson(req: JsonRequest): Promise<JsonResponse> {
      loaded ??= loadBlocks()
      await loaded
      let outOfTime = false
      const before = attempts.length
      for (const step of steps) {
        const model = step.provider.model
        if (dead.has(model)) continue
        const remaining = opts.budgetMs - (now() - start)
        if (remaining < minCallMs) {
          outOfTime = true
          attempts.push({
            model,
            role: step.role,
            outcome: 'skipped',
            ms: 0,
            detail: `sin tiempo (quedaban ${Math.max(0, Math.round(remaining))} ms)`,
          })
          break
        }
        const timeoutMs = Math.min(step.timeoutMs, req.timeoutMs, remaining)
        // El pesado, una vez por consulta (acierte o falle).
        if (step.role === 'heavy') dead.add(model)
        const t0 = now()
        try {
          const res = await step.provider.generateJson({ ...req, timeoutMs })
          current = res.model ?? model
          attempts.push({
            model: current,
            role: step.role,
            outcome: 'ok',
            ms: now() - t0,
            timeout_ms: timeoutMs,
          })
          if (attempts.length - before > 1) {
            console.warn(
              `[ai] respondió ${current} tras: ${attempts
                .slice(before, -1)
                .map((a) => `${a.model} ${a.outcome}`)
                .join(', ')}`,
            )
          }
          return { ...res, model: current }
        } catch (error) {
          const err =
            error instanceof AiProviderError
              ? error
              : new AiProviderError('unavailable', `Error del proveedor: ${String(error)}`)
          await record(step, err, now() - t0, timeoutMs)
          if (!FALL_THROUGH.has(err.kind)) throw err
          dead.add(model)
        }
      }
      throw chainError(attempts, outOfTime)
    },
  }
}
