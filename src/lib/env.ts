// Variables públicas de Supabase.
//
// No dependemos solo de que Vite las incruste en el build: si en Vercel no estaban
// disponibles al compilar, el servidor las lee en tiempo de ejecución (process.env)
// y se las pasa al navegador con window.__PUBLIC_ENV__ (ver __root.tsx).

export type PublicEnv = { supabaseUrl: string; supabaseAnonKey: string }

export const PUBLIC_ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

declare global {
  interface Window {
    __PUBLIC_ENV__?: Partial<PublicEnv>
  }
}

// Valores incrustados por Vite en el build (undefined si no existían al compilar).
const BUILD_ENV = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
}

function clean(value: string | undefined) {
  // Quita espacios y comillas pegadas por error al copiar el valor en Vercel.
  const v = value?.trim().replace(/^['"]|['"]$/g, '')
  return v ? v : undefined
}

function runtimeEnv(): Partial<PublicEnv> {
  if (typeof window === 'undefined') {
    return {
      supabaseUrl: process.env.VITE_SUPABASE_URL,
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY,
    }
  }
  return window.__PUBLIC_ENV__ ?? {}
}

export function isValidHttpUrl(value: string | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

// Nunca lanza: devuelve la configuración o la lista de problemas.
export function readPublicEnv(): { env: PublicEnv | null; problems: string[] } {
  const runtime = runtimeEnv()
  const supabaseUrl = clean(runtime.supabaseUrl) ?? clean(BUILD_ENV.supabaseUrl)
  const supabaseAnonKey = clean(runtime.supabaseAnonKey) ?? clean(BUILD_ENV.supabaseAnonKey)

  const problems: string[] = []
  if (!supabaseUrl) problems.push('Falta VITE_SUPABASE_URL')
  else if (!isValidHttpUrl(supabaseUrl))
    problems.push('VITE_SUPABASE_URL no es una URL válida (debe empezar por https://)')
  if (!supabaseAnonKey) problems.push('Falta VITE_SUPABASE_ANON_KEY')

  if (problems.length > 0 || !supabaseUrl || !supabaseAnonKey) return { env: null, problems }
  return { env: { supabaseUrl, supabaseAnonKey }, problems }
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `Configuración incompleta: ${problems.join('. ')}. Revisa las variables de entorno en Vercel.`,
    )
    this.name = 'ConfigError'
  }
}

export function getPublicEnv(): PublicEnv {
  const { env, problems } = readPublicEnv()
  if (!env) throw new ConfigError(problems)
  return env
}

// Estado de las variables para /api/health (solo booleanos, nunca valores).
export function describeEnv() {
  return {
    runtime: {
      VITE_SUPABASE_URL: Boolean(clean(process.env.VITE_SUPABASE_URL)),
      VITE_SUPABASE_ANON_KEY: Boolean(clean(process.env.VITE_SUPABASE_ANON_KEY)),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(clean(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    },
    build: {
      VITE_SUPABASE_URL: Boolean(clean(BUILD_ENV.supabaseUrl)),
      VITE_SUPABASE_ANON_KEY: Boolean(clean(BUILD_ENV.supabaseAnonKey)),
    },
    supabaseUrlValid: isValidHttpUrl(
      clean(process.env.VITE_SUPABASE_URL) ?? clean(BUILD_ENV.supabaseUrl),
    ),
  }
}
