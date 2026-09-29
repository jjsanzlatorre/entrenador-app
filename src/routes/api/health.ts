import { createFileRoute } from '@tanstack/react-router'
import { describeEnv } from '@/lib/env'
import { describeAiEnv } from '@/server/ai/config'
import { describePushEnv } from '@/server/push/config'

// Diagnóstico de despliegue: qué variables existen (true/false), nunca sus valores.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => {
        const env = describeEnv()
        const ok =
          env.supabaseUrlValid &&
          env.runtime.SUPABASE_SERVICE_ROLE_KEY &&
          (env.runtime.VITE_SUPABASE_ANON_KEY || env.build.VITE_SUPABASE_ANON_KEY)
        return Response.json(
          // La IA y las notificaciones son opcionales: sin claves no afectan a «ok».
          {
            ok,
            env,
            ai: describeAiEnv(),
            push: describePushEnv(),
            node: process.version,
            time: new Date().toISOString(),
          },
          { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})
