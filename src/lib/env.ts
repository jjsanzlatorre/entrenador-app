// Variables públicas (prefijo VITE_). Vite las incrusta en cliente y servidor en el build.
export function getPublicEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !anonKey) {
    throw new Error(
      'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Revisa .env.example y las variables de Vercel.',
    )
  }
  return { url, anonKey }
}
