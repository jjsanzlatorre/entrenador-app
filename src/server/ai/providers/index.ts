import { AI_TIMEOUTS, modelFor, type AiConfig, type AiTier, type AiTimeouts } from '../config'
import { createAnthropicProvider } from './anthropic'
import { createModelChain, type ChainStep, type ModelBlockStore, type ModelChain } from './chain'
import { createGeminiProvider } from './gemini'

// Proveedor según la configuración; null si falta la clave (IA desactivada). Se crea uno por
// consulta (el presupuesto de tiempo empieza al crearlo). Con Gemini es una cadena: en las tareas
// pesadas GEMINI_MODEL_HEAVY → GEMINI_MODEL → GEMINI_FALLBACK_MODEL; en el resto, las dos últimas.
export function createProvider(
  config: AiConfig,
  tier: AiTier = 'light',
  opts: { blocks?: ModelBlockStore | null; timeouts?: AiTimeouts; now?: () => number } = {},
): ModelChain | null {
  if (!config.configured || !config.apiKey) return null
  const t = opts.timeouts ?? AI_TIMEOUTS
  const chain = (steps: ChainStep[]) =>
    createModelChain({ steps, blocks: opts.blocks, budgetMs: t.budgetMs, now: opts.now })
  if (config.provider === 'anthropic') {
    const provider = createAnthropicProvider({ apiKey: config.apiKey, model: config.model })
    const heavy = tier === 'heavy'
    return chain([{ role: 'light', provider, timeoutMs: heavy ? t.heavyMs : t.lightMs }])
  }
  const gemini = (model: string) =>
    createGeminiProvider({
      apiKey: config.apiKey!,
      model,
      baseUrl: config.baseUrl ?? undefined,
    })
  const steps: ChainStep[] = []
  const heavyModel = modelFor(config, tier)
  if (heavyModel !== config.model) {
    steps.push({ role: 'heavy', provider: gemini(heavyModel), timeoutMs: t.heavyMs })
  }
  steps.push({ role: 'light', provider: gemini(config.model), timeoutMs: t.lightMs })
  if (config.fallbackModel) {
    steps.push({ role: 'fallback', provider: gemini(config.fallbackModel), timeoutMs: t.lightMs })
  }
  return chain(steps)
}
