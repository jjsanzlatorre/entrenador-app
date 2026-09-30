// Interfaz común de los proveedores de IA. El resto de la app no sabe cuál hay detrás.
import type { AiProviderErrorKind, ModelAttempt, QuotaScope } from '@/lib/ai/schemas'

export type { AiProviderErrorKind, ModelAttempt, QuotaScope }

export type JsonRequest = {
  system: string
  // Mensaje del usuario (instrucciones de la tarea + datos en JSON).
  prompt: string
  // JSON Schema (subconjunto sencillo, ver json-schema.ts) de la respuesta.
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  // Tiempo máximo de la llamada (ms). Con la cadena de modelos es un tope: cada modelo tiene el
  // suyo y todos comparten el presupuesto de la consulta (chain.ts).
  timeoutMs: number
}

export type JsonResponse = {
  text: string
  tokensIn: number
  tokensOut: number
  // Modelo que ha respondido (con reserva puede no ser el principal).
  model?: string
}

export interface AiProvider {
  readonly name: string
  readonly model: string
  generateJson(request: JsonRequest): Promise<JsonResponse>
  // Solo la cadena de modelos: intentos de esta consulta (modelo, resultado, tiempos) y tiempo
  // desde que empezó.
  readonly attempts?: ModelAttempt[]
  elapsedMs?(): number
}

export class AiProviderError extends Error {
  // Solo en cuota: alcance y segundos que pide esperar el proveedor (RetryInfo).
  scope: QuotaScope | null = null
  retryAfterS: number | null = null
  constructor(
    readonly kind: AiProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

export function kindFromStatus(status: number): AiProviderErrorKind {
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 404 || status === 422) return 'bad_request'
  return 'unavailable'
}

// Error de una llamada cortada por tiempo (AbortSignal.timeout / SDK).
export function isTimeoutError(error: unknown) {
  const name = (error as { name?: string } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(String(error))
}
