import type { AiConfig } from '../config'
import { createAnthropicProvider } from './anthropic'
import { createGeminiProvider } from './gemini'
import type { AiProvider } from './types'

// Proveedor según la configuración; null si falta la clave (IA desactivada).
export function createProvider(config: AiConfig): AiProvider | null {
  if (!config.configured || !config.apiKey) return null
  return config.provider === 'anthropic'
    ? createAnthropicProvider({ apiKey: config.apiKey, model: config.model })
    : createGeminiProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl ?? undefined,
      })
}
