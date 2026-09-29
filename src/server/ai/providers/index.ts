import type { AiConfig } from '../config'
import { createAnthropicProvider } from './anthropic'
import { withFallback } from './fallback'
import { createGeminiProvider } from './gemini'
import type { AiProvider } from './types'

// Proveedor según la configuración; null si falta la clave (IA desactivada). Se crea uno por
// consulta: el paso a la reserva dura solo esa consulta.
export function createProvider(config: AiConfig): AiProvider | null {
  if (!config.configured || !config.apiKey) return null
  if (config.provider === 'anthropic') {
    return createAnthropicProvider({ apiKey: config.apiKey, model: config.model })
  }
  const gemini = (model: string) =>
    createGeminiProvider({
      apiKey: config.apiKey!,
      model,
      baseUrl: config.baseUrl ?? undefined,
    })
  return withFallback(
    gemini(config.model),
    config.fallbackModel ? gemini(config.fallbackModel) : null,
  )
}
