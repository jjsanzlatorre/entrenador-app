// Modelo de reserva: si el principal devuelve 429 o cuota agotada, se reintenta una vez con el
// de reserva antes de dar el aviso. Tras un 429 del principal, el resto de llamadas de la misma
// consulta (p. ej. el reintento por salida no válida) van directamente a la reserva.
import { AiProviderError, type AiProvider } from './types'

export function withFallback(primary: AiProvider, fallback: AiProvider | null): AiProvider {
  if (!fallback) return primary
  let primaryExhausted = false
  return {
    name: primary.name,
    get model() {
      return primaryExhausted ? fallback.model : primary.model
    },
    async generateJson(req) {
      if (!primaryExhausted) {
        try {
          return await primary.generateJson(req)
        } catch (error) {
          if (!(error instanceof AiProviderError) || error.kind !== 'quota') throw error
          console.warn(
            `[ai] ${primary.model} sin cuota (${error.message}); se usa ${fallback.model}`,
          )
          primaryExhausted = true
        }
      }
      return fallback.generateJson(req)
    },
  }
}
