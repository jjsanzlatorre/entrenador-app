// Carga (con la sesión del usuario, respetando RLS) los datos que resume el context builder.
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AiContextInput,
  ContextExercise,
  ContextPlanned,
  ContextSession,
} from '@/lib/ai/context'
import { currentCommitment } from '@/lib/progress/adherence'
import { addDays, type DateKey } from '@/lib/progress/dates'
import type { Commitment } from '@/lib/progress/types'
import { fromRow } from '@/lib/plan/profile'
import { parseBlocks } from '@/lib/plan/schema'
import type { Database, MuscleRole, Profile, SessionType } from '@/types/database'

type Db = SupabaseClient<Database>

// Día en la zona horaria del usuario de un instante ISO.
export function dateInTimeZone(iso: string, timeZone: string): DateKey {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

// Listas: null → [].
function check<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message)
  return res.data ?? []
}

// Una fila (maybeSingle): null si no hay.
function single<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(res.error.message)
  return res.data ?? null
}

const num = (v: number | string | null) => (v === null ? null : Number(v))

export async function loadAiContextInput(
  supabase: Db,
  opts: {
    userId: string
    profile: Pick<Profile, 'sex' | 'birth_year'>
    today: DateKey
    tz: string
  },
): Promise<AiContextInput & { planned: ContextPlanned[] }> {
  const { userId, today, tz } = opts
  // Día anterior de margen por las zonas horarias.
  const since = `${addDays(today, -42)}T00:00:00Z`
  const [training, commitments, plan, sessions, sets, exercises, prs, checkins] = await Promise.all(
    [
      supabase.from('training_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('commitments')
        .select(
          'id, valid_from, valid_to, sessions_per_week, minutes_per_week, by_type, counts_free_activities',
        )
        .eq('user_id', userId),
      supabase
        .from('user_plans')
        .select('id, name, start_date')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle(),
      supabase
        .from('workout_sessions')
        .select('id, session_type, title, started_at, duration_min, rpe, distance_m')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .gte('started_at', since)
        .order('started_at'),
      supabase.rpc('session_exercise_sets', {
        // 3 semanas: la revisión semanal compara la semana revisada con la anterior.
        p_from: `${addDays(today, -22)}T00:00:00Z`,
        p_to: `${addDays(today, 2)}T00:00:00Z`,
      }),
      supabase
        .from('exercises')
        .select('id, name, category, equipment, is_compound, exercise_muscles(muscle_id, role)'),
      supabase
        .from('personal_records')
        .select('exercise_id, pr_type, value, unit, achieved_at')
        .eq('user_id', userId)
        .not('previous_value', 'is', null)
        .gte('achieved_at', `${addDays(today, -29)}T00:00:00Z`)
        .order('achieved_at', { ascending: false })
        .limit(10),
      supabase
        .from('daily_checkins')
        .select('date, sleep, energy, soreness, stress')
        .eq('user_id', userId)
        .gte('date', addDays(today, -6))
        .lte('date', today),
    ],
  )

  const trainingRow = single(training)
  const planRow = single(plan)

  let planned: ContextPlanned[] = []
  if (planRow) {
    const rows = check(
      await supabase
        .from('planned_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('user_plan_id', planRow.id)
        .order('date'),
    )
    planned = rows.map((r) => ({
      id: r.id,
      date: r.date,
      week: r.week,
      sessionType: r.session_type,
      title: r.title,
      intensity: r.intensity,
      heavyLegs: r.heavy_legs,
      durationMin: r.duration_min,
      notes: r.notes,
      status: r.status,
      blocks: parseBlocks(r.blocks),
    }))
  }

  const commitmentList: Commitment[] = check(commitments).map((r) => ({
    id: r.id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    sessionsPerWeek: r.sessions_per_week,
    minutesPerWeek: r.minutes_per_week,
    byType:
      r.by_type && typeof r.by_type === 'object' && !Array.isArray(r.by_type)
        ? (r.by_type as Partial<Record<SessionType, number>>)
        : null,
    countsFreeActivities: r.counts_free_activities,
  }))

  const sessionList: ContextSession[] = check(sessions).map((r) => ({
    id: r.id,
    date: dateInTimeZone(r.started_at, tz),
    sessionType: r.session_type,
    title: r.title,
    durationMin: r.duration_min,
    rpe: r.rpe,
    distanceM: num(r.distance_m),
  }))

  const exerciseList: ContextExercise[] = (
    check(exercises) as unknown as {
      id: string
      name: string
      category: string
      equipment: string[] | null
      is_compound: boolean
      exercise_muscles: { muscle_id: string; role: MuscleRole }[] | null
    }[]
  ).map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    equipment: e.equipment ?? [],
    isCompound: e.is_compound,
    muscles: (e.exercise_muscles ?? []).map((m) => ({ muscleId: m.muscle_id, role: m.role })),
  }))

  return {
    today,
    sex: opts.profile.sex,
    birthYear: opts.profile.birth_year,
    training: trainingRow ? fromRow(trainingRow) : null,
    commitment: currentCommitment(commitmentList, today),
    commitments: commitmentList,
    plan: planRow ? { name: planRow.name, startDate: planRow.start_date, sessions: planned } : null,
    planned,
    sessions: sessionList,
    setCounts: check(sets).map((r) => ({
      sessionId: r.session_id,
      exerciseId: r.exercise_id,
      sets: r.sets,
    })),
    exercises: exerciseList,
    prs: check(prs).map((r) => ({
      exerciseId: r.exercise_id,
      prType: r.pr_type,
      value: Number(r.value),
      unit: r.unit,
      date: dateInTimeZone(r.achieved_at, tz),
    })),
    checkins: check(checkins),
  }
}
