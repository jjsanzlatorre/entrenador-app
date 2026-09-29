// Adaptador de Google Gemini (API REST generateContent, salida JSON con responseJsonSchema).
import {
  AiProviderError,
  kindFromStatus,
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
  error?: { message?: string; status?: string }
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
        throw new AiProviderError('unavailable', `Gemini no responde: ${String(error)}`)
      }

      const body = (await res.json().catch(() => ({}))) as GeminiResponse
      if (!res.ok) {
        const detail = body.error?.message ?? res.statusText
        // Gemini devuelve 400 con «API key not valid» cuando la clave es incorrecta.
        const kind =
          res.status === 400 && /api key/i.test(detail) ? 'auth' : kindFromStatus(res.status)
        throw new AiProviderError(kind, `Gemini ${res.status}: ${detail}`, res.status)
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
      }
    },
  }
}
