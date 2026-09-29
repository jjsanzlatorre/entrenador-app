// Interfaz común de los proveedores de IA. El resto de la app no sabe cuál hay detrás.

export type JsonRequest = {
  system: string
  // Mensaje del usuario (instrucciones de la tarea + datos en JSON).
  prompt: string
  // JSON Schema (subconjunto sencillo, ver json-schema.ts) de la respuesta.
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  // Tiempo máximo de la llamada (ms).
  timeoutMs: number
}

export type JsonResponse = {
  text: string
  tokensIn: number
  tokensOut: number
}

export interface AiProvider {
  readonly name: string
  readonly model: string
  generateJson(request: JsonRequest): Promise<JsonResponse>
}

// quota: cuota o límite de velocidad del proveedor (429).
// auth: clave no válida o sin permiso.
// unavailable: caída, tiempo agotado o error de red.
// bad_request: el proveedor rechaza la petición (modelo inexistente, esquema no aceptado…).
// blocked: el proveedor se niega a responder (filtros de seguridad).
// truncated: la respuesta se cortó por longitud.
export type AiProviderErrorKind =
  'quota' | 'auth' | 'unavailable' | 'bad_request' | 'blocked' | 'truncated'

export class AiProviderError extends Error {
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
  if (status === 400 || status === 404 || status === 422) return 'bad_request'
  return 'unavailable'
}
