import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { getSupabaseAdminClient } from '@/server/supabase.server'
import { getPushConfig } from '@/server/push/config'
import { cleanupPushLog, runDailyReminders, supabaseReminderData } from '@/server/push/reminders'
import { sendToUser, supabasePushStore, webPushTransport } from '@/server/push/send'

function authorized(request: Request, secret: string | null) {
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

// Recordatorios programados: lo llama pg_cron (pg_net) cada 15 min con CRON_SECRET
// (supabase/snippets/push_cron.sql).
export const Route = createFileRoute('/api/push/cron')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getPushConfig()
        if (!authorized(request, config.cronSecret)) return json({ ok: false }, 401)
        if (!config.configured) return json({ ok: false, problem: config.problem }, 503)
        const admin = getSupabaseAdminClient()
        const deps = { transport: webPushTransport(config), store: supabasePushStore(admin) }
        const run = await runDailyReminders({
          data: supabaseReminderData(admin),
          send: (userId, message, key) => sendToUser(deps, userId, message, key),
        })
        // Una vez al día (hacia las 03:00 UTC) se limpian los registros viejos.
        const now = new Date()
        if (now.getUTCHours() === 3 && now.getUTCMinutes() < 15) await cleanupPushLog(admin, now)
        return json({ ok: true, ...run })
      },
    },
  },
})
