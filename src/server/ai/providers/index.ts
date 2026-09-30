import { modelFor, type AiConfig, type AiTier } from '../config'
import { createAnthropicProvider } from './anthropic'
import { withFallback } from './fallback'
import { createGeminiProvider } from './gemini'
import type { AiProvider } from './types'

// Proveedor según la configuración; null si falta la clave (IA desactivada). Se crea uno por
// consulta: el paso a la reserva dura solo esa consulta. tier: modelo de las tareas pesadas
// (GEMINI_MODEL_HEAVY) o el normal; la reserva vale para los dos.
export function createProvider(config: AiConfig, tier: AiTier = 'light'): AiProvider | null {
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
  const model = modelFor(config, tier)
  return withFallback(
    gemini(model),
    config.fallbackModel && config.fallbackModel !== model ? gemini(config.fallbackModel) : null,
  )
}
