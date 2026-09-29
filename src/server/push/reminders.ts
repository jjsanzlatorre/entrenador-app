// Recordatorio diario (fase 7B). /api/push/cron lo ejecuta cada 15 min (pg_cron + pg_net): para
// cada usuario con recordatorio o aviso suave activado, si en su zona horaria ya es la hora
// elegida (y no han pasado 2 h), se manda como mucho una notificación al día.
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionMinutes } from '@/lib/progress/adherence'
import { toCommitment } from '@/lib/progress/commitment-row'
import type { ActivityDay, Commitment } from '@/lib/progress/types'
import {
  behindStatus,
  composeDailyPush,
  dailyKey,
  dateKeyInTz,
  isReminderDue,
  localNow,
  weekQueryRange,
} from '@/lib/notifications/reminder'
import type { Database, SessionType } from '@/types/database'
import type { PushMessage, SendResult } from './send'

export type ReminderUser = {
  userId: string
  reminderTime: string
  tz: string
  planReminder: boolean
  behindNudge: boolean
}

type SessionLite = {
  sessionType: SessionType
  startedAt: string
  endedAt: string
  durationMin: number | null
}

export type ReminderData = {
  users(): Promise<ReminderUser[]>
  alreadySent(userId: string, key: string): Promise<boolean>
  plannedToday(userId: string, date: string): Promise<{ title: string } | null>
  commitments(userId: string): Promise<Commitment[]>
  sessions(userId: string, from: string, to: string): Promise<SessionLite[]>
}

export type ReminderRun = { checked: number; due: number; sent: number; skipped: number }

export async function runDailyReminders(opts: {
  data: ReminderData
  send: (userId: string, message: PushMessage, key: string) => Promise<SendResult>
  now?: Date
}): Promise<ReminderRun> {
  const now = opts.now ?? new Date()
  const users = await opts.data.users()
  const run: ReminderRun = { checked: users.length, due: 0, sent: 0, skipped: 0 }
  for (const user of users) {
    try {
      let local
      try {
        local = localNow(now, user.tz)
      } catch {
        local = localNow(now, 'Europe/Madrid')
      }
      if (!isReminderDue(user.reminderTime, local)) continue
      const key = dailyKey(local.date)
      if (await opts.data.alreadySent(user.userId, key)) continue
      run.due++

      const planned = user.planReminder
        ? await opts.data.plannedToday(user.userId, local.date)
        : null
      let behind = null
      if (user.behindNudge) {
        const commitments = await opts.data.commitments(user.userId)
        if (commitments.length > 0) {
          const range = weekQueryRange(local.date)
          const sessions = await opts.data.sessions(user.userId, range.from, range.to)
          const days: ActivityDay[] = sessions.map((s) => ({
            day: dateKeyInTz(s.startedAt, user.tz),
            sessionType: s.sessionType,
            minutes: sessionMinutes(s),
          }))
          behind = behindStatus(commitments, days, local.date)
        }
      }
      const message = composeDailyPush({ planned, behind })
      if (!message) {
        run.skipped++
        continue
      }
      const result = await opts.send(user.userId, { ...message, tag: 'daily' }, key)
      if (result.sent > 0) run.sent++
      else run.skipped++
    } catch (error) {
      console.error('[push] recordatorio', user.userId, error)
      run.skipped++
    }
  }
  return run
}

export function supabaseReminderData(admin: SupabaseClient<Database>): ReminderData {
  return {
    async users() {
      const { data, error } = await admin
        .from('notification_settings')
        .select('user_id, reminder_time, tz, plan_reminder, behind_nudge')
        .or('plan_reminder.eq.true,behind_nudge.eq.true')
      if (error) throw new Error(error.message)
      if (data.length === 0) return []
      // Solo usuarios activos.
      const { data: active, error: profileError } = await admin
        .from('profiles')
        .select('id')
        .eq('active', true)
        .in(
          'id',
          data.map((r) => r.user_id),
        )
      if (profileError) throw new Error(profileError.message)
      const ok = new Set(active.map((p) => p.id))
      return data
        .filter((r) => ok.has(r.user_id))
        .map((r) => ({
          userId: r.user_id,
          reminderTime: r.reminder_time,
          tz: r.tz,
          planReminder: r.plan_reminder,
          behindNudge: r.behind_nudge,
        }))
    },
    async alreadySent(userId, key) {
      const { data, error } = await admin
        .from('push_log')
        .select('key')
        .eq('user_id', userId)
        .eq('key', key)
        .limit(1)
      if (error) throw new Error(error.message)
      return data.length > 0
    },
    async plannedToday(userId, date) {
      const { data: plans, error: planError } = await admin
        .from('user_plans')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
      if (planError) throw new Error(planError.message)
      if (plans.length === 0) return null
      const { data, error } = await admin
        .from('planned_sessions')
        .select('title')
        .eq('user_id', userId)
        .in(
          'user_plan_id',
          plans.map((p) => p.id),
        )
        .eq('date', date)
        .in('status', ['planned', 'moved'])
        .order('created_at')
        .limit(1)
      if (error) throw new Error(error.message)
      return data[0] ? { title: data[0].title } : null
    },
    async commitments(userId) {
      const { data, error } = await admin
        .from('commitments')
        .select(
          'id, valid_from, valid_to, sessions_per_week, minutes_per_week, by_type, counts_free_activities',
        )
        .eq('user_id', userId)
      if (error) throw new Error(error.message)
      return data.map(toCommitment)
    },
    async sessions(userId, from, to) {
      const { data, error } = await admin
        .from('workout_sessions')
        .select('session_type, started_at, ended_at, duration_min')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .gte('started_at', from)
        .lt('started_at', to)
      if (error) throw new Error(error.message)
      return data.map((s) => ({
        sessionType: s.session_type,
        startedAt: s.started_at,
        endedAt: s.ended_at ?? s.started_at,
        durationMin: s.duration_min,
      }))
    },
  }
}

// Limpieza: registros de envío de más de 60 días.
export async function cleanupPushLog(admin: SupabaseClient<Database>, now = new Date()) {
  const before = new Date(now.getTime() - 60 * 86_400_000).toISOString()
  await admin.from('push_log').delete().lt('sent_at', before)
}
