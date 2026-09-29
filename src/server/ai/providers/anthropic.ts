// Adaptador de Anthropic (SDK oficial, salida estructurada con output_config.format).
import Anthropic from '@anthropic-ai/sdk'
import { AiProviderError, kindFromStatus, type AiProvider, type JsonRequest } from './types'

export function createAnthropicProvider(opts: {
  apiKey: string
  model: string
  client?: Pick<Anthropic, 'messages'>
}): AiProvider {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 })
  return {
    name: 'anthropic',
    model: opts.model,
    async generateJson(req: JsonRequest) {
      let message: Anthropic.Message
      try {
        message = await client.messages.create(
          {
            model: opts.model,
            max_tokens: req.maxOutputTokens,
            system: req.system,
            messages: [{ role: 'user', content: req.prompt }],
            output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
          },
          { timeout: req.timeoutMs },
        )
      } catch (error) {
        if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
          throw new AiProviderError(
            kindFromStatus(error.status),
            `Anthropic ${error.status}: ${error.message}`,
            error.status,
          )
        }
        throw new AiProviderError('unavailable', `Anthropic no responde: ${String(error)}`)
      }

      if (message.stop_reason === 'refusal') {
        throw new AiProviderError('blocked', 'Anthropic declinó la petición')
      }
      if (message.stop_reason === 'max_tokens') {
        throw new AiProviderError('truncated', 'La respuesta de Anthropic se cortó por longitud')
      }
      const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      return {
        text,
        tokensIn: message.usage.input_tokens,
        tokensOut: message.usage.output_tokens,
        model: opts.model,
      }
    },
  }
}
