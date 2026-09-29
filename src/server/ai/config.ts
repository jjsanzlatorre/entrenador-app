// Configuración del entrenador IA (solo servidor). El proveedor se elige con AI_PROVIDER:
// - gemini (por defecto): GEMINI_API_KEY, GEMINI_MODEL y GEMINI_FALLBACK_MODEL (opcional: modelo
//   de reserva si el principal devuelve 429 o cuota agotada).
// - anthropic: ANTHROPIC_API_KEY y AI_MODEL.
// AI_DAILY_LIMIT: llamadas por usuario y día (por defecto 20).
// GEMINI_BASE_URL (opcional): otra URL de la API de Gemini (los E2E usan un simulador).
// Sin clave, la IA queda desactivada y la app funciona igual.

export type AiProviderName = 'gemini' | 'anthropic'

export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-5',
}

export const DEFAULT_DAILY_LIMIT = 20

export type AiConfig = {
  provider: AiProviderName
  model: string
  // Solo Gemini: modelo de reserva ante 429 / cuota agotada (null = sin reserva).
  fallbackModel: string | null
  apiKey: string | null
  dailyLimit: number
  // Solo Gemini: URL base alternativa (null = la oficial).
  baseUrl: string | null
  configured: boolean
  problem: string | null
}

type Env = Record<string, string | undefined>

function clean(value: string | undefined) {
  const v = value?.trim().replace(/^['"]|['"]$/g, '')
  return v ? v : undefined
}

export function getAiConfig(env: Env = process.env): AiConfig {
  const raw = clean(env.AI_PROVIDER)?.toLowerCase()
  const provider: AiProviderName = raw === 'anthropic' ? 'anthropic' : 'gemini'
  const unknownProvider = raw !== undefined && raw !== 'gemini' && raw !== 'anthropic'

  const apiKey = provider === 'gemini' ? clean(env.GEMINI_API_KEY) : clean(env.ANTHROPIC_API_KEY)
  const model =
    (provider === 'gemini' ? clean(env.GEMINI_MODEL) : clean(env.AI_MODEL)) ??
    DEFAULT_MODELS[provider]

  const fallback = provider === 'gemini' ? clean(env.GEMINI_FALLBACK_MODEL) : undefined
  const fallbackModel = fallback && fallback !== model ? fallback : null

  const limitRaw = Number.parseInt(clean(env.AI_DAILY_LIMIT) ?? '', 10)
  const dailyLimit =
    Number.isFinite(limitRaw) && limitRaw >= 0 ? Math.min(limitRaw, 1000) : DEFAULT_DAILY_LIMIT

  const problem = unknownProvider
    ? `AI_PROVIDER no válido («${raw}»): usa gemini o anthropic`
    : !apiKey
      ? `Falta ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'}`
      : null

  return {
    provider,
    model,
    fallbackModel,
    apiKey: apiKey ?? null,
    dailyLimit,
    baseUrl: provider === 'gemini' ? (clean(env.GEMINI_BASE_URL) ?? null) : null,
    configured: problem === null,
    problem,
  }
}

// Para /api/health: solo booleanos y nombres, nunca claves.
export function describeAiEnv(env: Env = process.env) {
  const c = getAiConfig(env)
  return {
    AI_PROVIDER: c.provider,
    model: c.model,
    fallbackModel: c.fallbackModel,
    configured: c.configured,
    GEMINI_API_KEY: Boolean(clean(env.GEMINI_API_KEY)),
    ANTHROPIC_API_KEY: Boolean(clean(env.ANTHROPIC_API_KEY)),
    dailyLimit: c.dailyLimit,
  }
}
