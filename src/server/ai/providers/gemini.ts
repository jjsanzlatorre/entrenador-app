// Adaptador de Google Gemini (API REST generateContent, salida JSON con responseJsonSchema).
import {
  AiProviderError,
  isTimeoutError,
  kindFromStatus,
  type QuotaScope,
  type AiProvider,
  type JsonRequest,
  type JsonResponse,
} from './types'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
  error?: { message?: string; status?: string; details?: GeminiErrorDetail[] }
}

type GeminiErrorDetail = {
  '@type'?: string
  violations?: { quotaId?: string; quotaMetric?: string }[]
  retryDelay?: string
}

// Alcance de un 429: los detalles (QuotaFailure) dicen qué cuota se ha agotado
// («GenerateRequestsPerDayPerProjectPerModel-FreeTier», «…PerMinute…»); si no, el mensaje.
export function quotaScopeOf(error: GeminiResponse['error']): QuotaScope | null {
  const ids = (error?.details ?? []).flatMap((d) =>
    (d.violations ?? []).map((v) => `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`),
  )
  const text = [...ids, error?.message ?? ''].join(' ')
  if (/per ?day|daily|RPD/i.test(text)) return 'daily'
  if (/per ?minute|RPM|TPM/i.test(text)) return 'minute'
  return null
}

// Segundos que pide esperar Gemini (RetryInfo.retryDelay «37s»).
export function retryDelayOf(error: GeminiResponse['error']): number | null {
  for (const d of error?.details ?? []) {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay ?? '')
    if (m) return Math.ceil(Number(m[1]))
  }
  return null
}

export function createGeminiProvider(opts: {
  apiKey: string
  model: string
  baseUrl?: string
  fetch?: typeof fetch
}): AiProvider {
  const doFetch = opts.fetch ?? fetch
  const baseUrl = (opts.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, '')
  return {
    name: 'gemini',
    model: opts.model,
    async generateJson(req: JsonRequest): Promise<JsonResponse> {
      const url = `${baseUrl}/models/${encodeURIComponent(opts.model)}:generateContent`
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: req.jsonSchema,
              maxOutputTokens: req.maxOutputTokens,
              temperature: 0.4,
            },
          }),
          signal: AbortSignal.timeout(req.timeoutMs),
        })
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new AiProviderError(
            'timeout',
            `Gemini ${opts.model} no ha respondido en ${Math.round(req.timeoutMs / 1000)} s`,
          )
        }
        throw new AiProviderError('unavailable', `Gemini no responde: ${String(error)}`)
      }

      const body = (await res.json().catch(() => ({}))) as GeminiResponse
      if (!res.ok) {
        const detail = body.error?.message ?? res.statusText
        // Gemini devuelve 400 con «API key not valid» cuando la clave es incorrecta y
        // RESOURCE_EXHAUSTED cuando se agota la cuota (normalmente con 429).
        const kind =
          body.error?.status === 'RESOURCE_EXHAUSTED'
            ? 'quota'
            : res.status === 400 && /api key/i.test(detail)
              ? 'auth'
              : kindFromStatus(res.status)
        const err = new AiProviderError(kind, `Gemini ${res.status}: ${detail}`, res.status)
        if (kind === 'quota') {
          err.scope = quotaScopeOf(body.error)
          err.retryAfterS = retryDelayOf(body.error)
        }
        throw err
      }

      if (body.promptFeedback?.blockReason) {
        throw new AiProviderError(
          'blocked',
          `Gemini bloqueó la petición: ${body.promptFeedback.blockReason}`,
        )
      }
      const candidate = body.candidates?.[0]
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
      const finish = candidate?.finishReason
      if (finish === 'MAX_TOKENS') {
        throw new AiProviderError('truncated', 'La respuesta de Gemini se cortó por longitud')
      }
      if (finish && finish !== 'STOP' && !text) {
        throw new AiProviderError('blocked', `Gemini no respondió (${finish})`)
      }
      const usage = body.usageMetadata ?? {}
      return {
        text,
        tokensIn: usage.promptTokenCount ?? 0,
        tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        model: opts.model,
      }
    },
  }
}
