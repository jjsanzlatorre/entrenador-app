// Convierte un esquema Zod en el JSON Schema que se envía al proveedor, reducido a lo que
// aceptan tanto Gemini (responseJsonSchema) como Anthropic (output_config.format):
// type, properties, required, items, enum, description y additionalProperties: false.
// Los límites (mínimos, máximos, longitudes, patrones) se quitan: los comprueba Zod después.
import { z } from 'zod'

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'description'])

type Schema = Record<string, unknown>

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify)
  if (!node || typeof node !== 'object') return node
  const out: Schema = {}
  for (const [key, value] of Object.entries(node as Schema)) {
    if (!KEEP.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Schema).map(([k, v]) => [k, simplify(v)]),
      )
    } else if (key === 'items') {
      out.items = simplify(value)
    } else {
      out[key] = value
    }
  }
  if (out.type === 'object') out.additionalProperties = false
  return out
}

export function toProviderJsonSchema(schema: z.ZodType): Schema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  return simplify(json) as Schema
}
