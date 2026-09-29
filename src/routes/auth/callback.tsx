import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { resetAuthState } from '@/lib/auth'
import { parseAuthCallback } from '@/lib/auth-callback'
import { Screen } from '@/components/layout/safe-area'

// Procesa los enlaces de Supabase: magic link (PKCE ?code=), invitación (#access_token=…)
// y plantillas con token_hash (?token_hash=…&type=…).
export const Route = createFileRoute('/auth/callback')({
  ssr: false,
  component: AuthCallback,
})

function AuthCallback() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function handle() {
      const supabase = getSupabaseBrowserClient()
      const cb = parseAuthCallback(window.location.search, window.location.hash)

      switch (cb.kind) {
        case 'error':
          throw new Error(cb.message)
        case 'invalid':
          throw new Error('Enlace no válido')
        case 'pkce': {
          const { error } = await supabase.auth.exchangeCodeForSession(cb.code)
          if (error) {
            throw new Error(
              'El enlace se abrió en otro navegador o ha caducado. Vuelve a pedirlo o usa el código del email.',
            )
          }
          break
        }
        case 'token_hash': {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: cb.tokenHash,
            type: cb.type,
          })
          if (error) throw new Error(error.message)
          break
        }
        case 'tokens': {
          const { error } = await supabase.auth.setSession({
            access_token: cb.accessToken,
            refresh_token: cb.refreshToken,
          })
          if (error) throw new Error(error.message)
          break
        }
      }

      await resetAuthState(queryClient)
      await router.invalidate()
      // Tras una invitación, al perfil para que pueda poner nombre y contraseña.
      await router.navigate({
        to: 'type' in cb && cb.type === 'invite' ? '/perfil' : '/',
        replace: true,
      })
    }

    handle().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    })
  }, [queryClient, router])

  return (
    <Screen className="items-center gap-4 text-center">
      {error ? (
        <>
          <p className="text-destructive font-medium">{error}</p>
          <Link to="/login" className="text-primary underline">
            Volver a entrar
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground">Entrando…</p>
      )}
    </Screen>
  )
}
