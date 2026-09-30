// generateStructured: pide al proveedor un JSON, lo valida con Zod y con comprobaciones propias
// (p. ej. exercise_id existentes) y, si no vale, reintenta una vez con los errores. Si vuelve a
// fallar: `repair` (descartar lo inválido) si se da; si no, error de salida no válida.
import type { z } from 'zod'
import { toProviderJsonSchema } from './json-schema'
import { AiProviderError, type AiProvider } from './providers/types'

export class AiInvalidOutputError extends Error {
  constructor(readonly issues: string[]) {
    super(`Respuesta de la IA no válida: ${issues.slice(0, 5).join(' | ')}`)
    this.name = 'AiInvalidOutputError'
  }
}

export type StructuredRequest<T> = {
  provider: AiProvider
  schema: z.ZodType<T>
  system: string
  // Instrucciones de la tarea.
  prompt: string
  // Datos del usuario (se envían como JSON compacto).
  context: unknown
  // Problemas que Zod no detecta (lista vacía = válido).
  check?: (data: T) => string[]
  // Último recurso tras el reintento: corrige quitando lo inválido (null = no se puede).
  repair?: (data: T) => T | null
  maxOutputTokens?: number
  timeoutMs?: number
}

export type StructuredResult<T> = {
  data: T
  attempts: number
  repaired: boolean
  tokensIn: number
  tokensOut: number
  // Modelo que dio la última respuesta.
  model?: string
  // Texto crudo de cada respuesta del proveedor y problemas de cada intento (para depurar).
  raw: string[]
  issueLog: string[][]
}

// Tamaño máximo de cada respuesta cruda que se guarda.
const RAW_LIMIT = 20_000

// Quita ```json … ``` si el modelo lo añade.
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return JSON.parse(fenced ? fenced[1]! : trimmed)
}

function zodIssues(error: z.ZodError) {
  return error.issues.slice(0, 15).map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
}

export async function generateStructured<T>(
  req: StructuredRequest<T>,
): Promise<StructuredResult<T>> {
  const jsonSchema = toProviderJsonSchema(req.schema)
  const basePrompt = `${req.prompt}\n\nDATOS DEL USUARIO (JSON):\n${JSON.stringify(req.context)}`
  let tokensIn = 0
  let tokensOut = 0
  let issues: string[] = []
  let lastValid: T | null = null
  let model: string | undefined
  const raw: string[] = []
  const issueLog: string[][] = []
  const done = (data: T, attempts: number, repaired: boolean): StructuredResult<T> => ({
    data,
    attempts,
    repaired,
    tokensIn,
    tokensOut,
    model,
    raw,
    issueLog,
  })

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nTu respuesta anterior no era válida por estos motivos:\n- ${issues.join(
            '\n- ',
          )}\nCorrígelos y devuelve solo el JSON completo.`
    let text: string
    try {
      const res = await req.provider.generateJson({
        system: req.system,
        prompt,
        jsonSchema,
        maxOutputTokens: req.maxOutputTokens ?? 8192,
        timeoutMs: req.timeoutMs ?? 50_000,
      })
      tokensIn += res.tokensIn
      tokensOut += res.tokensOut
      model = res.model ?? model
      text = res.text
      raw.push(text.slice(0, RAW_LIMIT))
    } catch (error) {
      // Una respuesta cortada se trata como no válida (se reintenta); el resto se propaga.
      if (error instanceof AiProviderError && error.kind === 'truncated' && attempt === 1) {
        issues = ['La respuesta se cortó: sé más conciso (notas breves).']
        issueLog.push(issues)
        continue
      }
      // Si el reintento falla por el proveedor (p. ej. cuota), vale la primera respuesta
      // corregida quitando lo inválido.
      if (attempt === 2 && lastValid !== null && req.repair) {
        issueLog.push([`El reintento falló: ${error instanceof Error ? error.message : error}`])
        const fixed = req.repair(lastValid)
        if (fixed !== null) return done(fixed, 2, true)
      }
      throw error
    }

    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      issues = ['La respuesta no era JSON válido.']
      issueLog.push(issues)
      continue
    }
    const parsed = req.schema.safeParse(json)
    if (!parsed.success) {
      issues = zodIssues(parsed.error)
      issueLog.push(issues)
      continue
    }
    lastValid = parsed.data
    issues = req.check?.(parsed.data) ?? []
    issueLog.push(issues)
    if (issues.length === 0) return done(parsed.data, attempt, false)
  }

  if (lastValid !== null && req.repair) {
    const fixed = req.repair(lastValid)
    if (fixed !== null) return done(fixed, 2, true)
  }
  throw Object.assign(new AiInvalidOutputError(issues), {
    tokensIn,
    tokensOut,
    model,
    raw,
    issueLog,
  })
}
