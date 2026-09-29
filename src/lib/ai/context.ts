// Context builder del entrenador IA (CLAUDE.md §11): resume los datos del usuario en un JSON
// compacto. Solo lo necesario para entrenar: nunca nombre, email, fotos, notas de sesiones ni
// medidas corporales (peso, perímetros). Del perfil solo sexo (estándares de competición) y edad.
// Función pura: los datos los carga el servidor (src/server/ai/load-context.ts).
import { activityKey, DEFAULT_ACTIVITY_TYPES, type ActivityType } from '@/lib/activities/catalog'
import type { Commitment } from '@/lib/progress/types'
import { acuteChronicRatio, weeklyLoads } from '@/lib/progress/load'
import { addDays, daysBetween, isoWeekday, weekStartOf, type DateKey } from '@/lib/progress/dates'
import { muscleVolume, MUSCLE_IDS, type ExerciseSetCount } from '@/lib/progress/muscle-volume'
import { WEEKDAY_LONG, WEEKDAY_SHORT, type TrainingProfileData } from '@/lib/plan/profile'
import type { PlanBlock, PlanStructure } from '@/lib/plan/types'
import type {
  MuscleRole,
  PlannedStatus,
  PrType,
  SessionIntensity,
  SessionType,
  Sex,
} from '@/types/database'

export type ContextSession = {
  id: string
  // Día local (en la zona horaria del usuario).
  date: DateKey
  sessionType: SessionType
  // Actividad personalizada (session_type custom).
  activityTypeId?: string | null
  title: string | null
  durationMin: number | null
  rpe: number | null
  distanceM: number | null
}

// Plantilla de plan disponible (el chat elige una para create_plan).
export type ContextTemplate = {
  id: string
  family: string
  level: string
  name: string
  daysPerWeek: number
}

export type ContextPlanned = {
  id: string
  date: DateKey
  week: number
  sessionType: SessionType
  title: string
  intensity: SessionIntensity
  heavyLegs: boolean
  durationMin: number | null
  notes: string | null
  status: PlannedStatus
  blocks: PlanBlock[]
}

export type ContextExercise = {
  id: string
  name: string
  category: string
  equipment: string[]
  muscles: { muscleId: string; role: MuscleRole }[]
  isCompound?: boolean
}

export type ContextCheckin = {
  date: DateKey
  sleep: number | null
  energy: number | null
  soreness: number | null
  stress: number | null
}

export type ContextPr = {
  exerciseId: string
  prType: PrType
  value: number
  unit: string
  date: DateKey
}

export type AiContextInput = {
  today: DateKey
  sex: Sex | null
  birthYear: number | null
  training: TrainingProfileData | null
  commitment: Commitment | null
  // Historial de compromisos (revisión semanal: el de la semana revisada).
  commitments?: Commitment[]
  plan: { name: string; startDate: DateKey; sessions: ContextPlanned[] } | null
  // Sesiones terminadas de las últimas ~6 semanas.
  sessions: ContextSession[]
  // Series efectivas por sesión y ejercicio (session_exercise_sets) de las últimas 2 semanas.
  setCounts: ExerciseSetCount[]
  exercises: ContextExercise[]
  prs: ContextPr[]
  checkins: ContextCheckin[]
  // Tipos de actividad del usuario: globales y sus personalizadas (sin archivar), con su
  // aproximación muscular. Sin ellos se usan los globales de la semilla.
  activityTypes?: ActivityType[]
  templates?: ContextTemplate[]
}

export type AiContextOptions = {
  // Lista de ejercicios permitidos (para planes y ajustes).
  includeExercises?: boolean
  // Plantilla base del plan (generar plan).
  baseTemplate?: { id: string; name: string; structure: PlanStructure } | null
  // Sesión planificada de hoy completa (ajuste del día).
  todaySession?: ContextPlanned | null
  // Sesiones pendientes del plan entre dos días, con su id (cambios propuestos).
  upcoming?: { from: DateKey; to: DateKey } | null
  // Datos calculados de la semana revisada (revisión semanal).
  reviewWeek?: unknown
  // Últimos mensajes del chat (los más antiguos primero) y el mensaje nuevo.
  conversation?: { role: 'user' | 'assistant'; text: string }[] | null
  message?: string | null
  // Plantillas de plan disponibles (chat: create_plan).
  includeTemplates?: boolean
}

// Sesiones pendientes que la IA puede cambiar (revisión semanal y chat).
export function upcomingSessions(input: AiContextInput, from: DateKey, to: DateKey) {
  return (input.plan?.sessions ?? []).filter(
    (s) => s.date >= from && s.date <= to && (s.status === 'planned' || s.status === 'moved'),
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10
const dayName = (d: DateKey) => WEEKDAY_LONG[isoWeekday(d) - 1]
const days = (list: number[]) => list.map((d) => WEEKDAY_SHORT[d - 1]).join('')

// Las funciones de carga agrupan por día local de startedAt: mediodía UTC cae en el mismo día
// en cualquier zona horaria de ±11 h.
function asLoadSession(s: ContextSession) {
  const iso = `${s.date}T12:00:00.000Z`
  return {
    id: s.id,
    sessionType: s.sessionType,
    activityTypeId: s.activityTypeId ?? null,
    startedAt: iso,
    endedAt: iso,
    durationMin: s.durationMin ?? 0,
    rpe: s.rpe,
  }
}

// Tipos de actividad del usuario: los globales de la semilla + los de la base de datos.
function activityMap(input: Pick<AiContextInput, 'activityTypes'>) {
  const map = new Map<string, ActivityType>(DEFAULT_ACTIVITY_TYPES.map((a) => [a.id, a]))
  for (const a of input.activityTypes ?? []) map.set(a.id, a)
  return map
}

function approxLookup(map: Map<string, ActivityType>) {
  return (key: string) => {
    const a = map.get(key)
    return a && a.muscles.length > 0 && a.setsPer30Min > 0
      ? { muscles: a.muscles, setsPer30Min: a.setsPer30Min }
      : undefined
  }
}

// Actividades que la IA debe conocer (planes, ajuste del día y chat): id | nombre | emoji |
// músculos aproximados | series equivalentes por 30 min | reglas del planificador.
export function activityLines(input: Pick<AiContextInput, 'activityTypes'>) {
  return [...activityMap(input).values()]
    .filter((a) => !a.archived)
    .map((a) => {
      const flags = [
        a.ownerId !== null ? 'personalizada' : null,
        a.legLoading ? 'carga piernas' : null,
        a.hardLegs ? 'intensa de pierna' : null,
        a.freeActivity ? 'actividad libre' : null,
      ].filter(Boolean)
      const muscles = a.muscles.length ? a.muscles.join(',') : '-'
      return `${a.id} | ${a.name} | ${a.emoji} | ${muscles} | ${a.setsPer30Min} | ${flags.join(', ') || '-'}`
    })
}

function withoutNulls<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  )
}

function athlete(input: AiContextInput) {
  const t = input.training
  const activities = activityMap(input)
  const year = Number(input.today.slice(0, 4))
  return withoutNulls({
    sex: input.sex,
    age: input.birthYear ? year - input.birthYear : null,
    level: t?.level ?? null,
    goals: t ? { main: t.goals.main, selected: t.goals.selected } : null,
    days_per_week: t?.availability.days_per_week ?? null,
    minutes_per_session: t?.availability.minutes_per_session ?? null,
    preferred_days: t?.availability.preferred_days.length
      ? days(t.availability.preferred_days)
      : null,
    places: t?.availability.places.length ? t.availability.places : null,
    equipment: t?.equipment.length ? t.equipment : null,
    limitations: t?.limitations ?? null,
    fixed_activities: t?.fixedActivities.length
      ? t.fixedActivities.map((f) =>
          withoutNulls({
            type: f.type,
            name: activities.get(f.type)?.name ?? null,
            label: f.label,
            days: days(f.days),
            minutes: f.minutes,
          }),
        )
      : null,
    benchmarks: t ? withoutNulls(t.benchmarks) : null,
  })
}

function planSummary(input: AiContextInput) {
  const plan = input.plan
  if (!plan) return null
  const week = Math.floor(daysBetween(plan.startDate, input.today) / 7) + 1
  const weekStart = weekStartOf(input.today)
  const thisWeek = plan.sessions.filter(
    (s) => s.date >= weekStart && s.date <= addDays(weekStart, 6),
  )
  const due = plan.sessions.filter((s) => s.date < input.today || s.status === 'done')
  return {
    name: plan.name,
    week_of_plan: week,
    this_week: thisWeek.map((s) => ({
      date: s.date,
      title: s.title,
      type: s.sessionType,
      intensity: s.intensity,
      status: s.status,
    })),
    adherence: {
      done: due.filter((s) => s.status === 'done').length,
      due: due.length,
    },
  }
}

function recent(input: AiContextInput) {
  const today = input.today
  const activities = activityMap(input)
  const loadSessions = input.sessions.map(asLoadSession)
  const acwr = acuteChronicRatio(loadSessions, today, { hasActivePlan: input.plan !== null })
  const weeks = weeklyLoads(loadSessions, weekStartOf(today), 4).map((w) => {
    const inWeek = input.sessions.filter(
      (s) => s.date >= w.weekStart && s.date <= addDays(w.weekStart, 6),
    )
    return {
      week_start: w.weekStart,
      sessions: w.sessions,
      minutes: inWeek.reduce((sum, s) => sum + (s.durationMin ?? 0), 0),
      load: w.load,
      sessions_without_rpe: w.missingRpe,
    }
  })

  const catalog = new Map(input.exercises.map((e) => [e.id, { muscles: e.muscles }]))
  const volumeFor = (from: DateKey) =>
    muscleVolume(
      loadSessions.filter(
        (s) => s.startedAt.slice(0, 10) >= from && s.startedAt.slice(0, 10) <= today,
      ),
      input.setCounts,
      catalog,
      approxLookup(activities),
    )
  const last7 = volumeFor(addDays(today, -6))
  const last14 = volumeFor(addDays(today, -13))
  const muscleSets: Record<string, number> = {}
  for (const id of MUSCLE_IDS) {
    const sets = last7.get(id)?.sets ?? 0
    if (sets > 0) muscleSets[id] = round1(sets)
  }
  const first = input.sessions.reduce<DateKey | null>(
    (min, s) => (min === null || s.date < min ? s.date : min),
    null,
  )
  const neglected =
    first !== null && first < addDays(today, -13)
      ? MUSCLE_IDS.filter((id) => (last14.get(id)?.sets ?? 0) === 0)
      : []

  const last14Sessions = input.sessions
    .filter((s) => s.date >= addDays(today, -13) && s.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) =>
      withoutNulls({
        date: s.date,
        type: activityKey(s),
        activity: s.sessionType === 'custom' ? (activities.get(activityKey(s))?.name ?? null) : null,
        title: s.title,
        min: s.durationMin,
        rpe: s.rpe,
        km: s.distanceM ? round1(s.distanceM / 1000) : null,
      }),
    )

  return {
    weeks,
    acwr: {
      acute_7d: Math.round(acwr.acute),
      chronic_weekly: Math.round(acwr.chronicWeekly),
      ratio: acwr.ratio === null ? null : Math.round(acwr.ratio * 100) / 100,
      status: acwr.status,
    },
    sessions_last_14d: last14Sessions,
    muscle_sets_7d: muscleSets,
    neglected_muscles_14d: neglected,
  }
}

export function exerciseLines(input: Pick<AiContextInput, 'exercises'>) {
  return input.exercises.map((e) => {
    const primary = e.muscles.filter((m) => m.role === 'primary').map((m) => m.muscleId)
    const equipment = e.equipment.length ? e.equipment.join('/') : 'sin material'
    return `${e.id} | ${e.name} | ${e.category} | ${equipment} | ${primary.join(',') || '-'}`
  })
}

function plannedDetail(s: ContextPlanned) {
  return {
    date: s.date,
    week: s.week,
    session_type: s.sessionType,
    title: s.title,
    intensity: s.intensity,
    heavy_legs: s.heavyLegs,
    duration_min: s.durationMin,
    notes: s.notes ?? undefined,
    blocks: s.blocks,
  }
}

export function buildAiContext(input: AiContextInput, opts: AiContextOptions = {}) {
  const today = input.today
  const names = new Map(input.exercises.map((e) => [e.id, e.name]))
  const c = input.commitment
  return withoutNulls({
    today,
    weekday: dayName(today),
    athlete: athlete(input),
    commitment: c
      ? withoutNulls({
          sessions_per_week: c.sessionsPerWeek,
          minutes_per_week: c.minutesPerWeek,
          by_type: c.byType,
        })
      : null,
    plan: planSummary(input),
    recent: recent(input),
    recent_prs: input.prs
      .filter((p) => p.date >= addDays(today, -27))
      .slice(0, 10)
      .map((p) => ({
        exercise: names.get(p.exerciseId) ?? p.exerciseId,
        type: p.prType,
        value: round1(p.value),
        unit: p.unit,
        date: p.date,
      })),
    checkins: input.checkins
      .filter((ch) => ch.date >= addDays(today, -6) && ch.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((ch) => withoutNulls({ ...ch })),
    today_checkin: input.checkins.find((ch) => ch.date === today) ?? null,
    today_session: opts.todaySession ? plannedDetail(opts.todaySession) : null,
    review_week: opts.reviewWeek ?? null,
    upcoming_sessions: opts.upcoming
      ? upcomingSessions(input, opts.upcoming.from, opts.upcoming.to).map((s) => ({
          planned_session_id: s.id,
          weekday: dayName(s.date),
          ...plannedDetail(s),
        }))
      : null,
    conversation: opts.conversation?.length ? opts.conversation : null,
    message: opts.message ?? null,
    activity_types: {
      format:
        'id | nombre | emoji | músculos aproximados | series equivalentes por 30 min | reglas',
      list: activityLines(input),
    },
    plan_templates:
      opts.includeTemplates && input.templates?.length
        ? {
            format: 'template_id | familia | nivel | sesiones por semana | nombre',
            list: input.templates.map(
              (t) => `${t.id} | ${t.family} | ${t.level} | ${t.daysPerWeek} | ${t.name}`,
            ),
          }
        : null,
    base_template: opts.baseTemplate
      ? { id: opts.baseTemplate.id, name: opts.baseTemplate.name, ...opts.baseTemplate.structure }
      : null,
    exercises: opts.includeExercises
      ? {
          format: 'exercise_id | nombre | categoría | material | músculos principales',
          list: exerciseLines(input),
        }
      : null,
  })
}

// Resumen de lo que se envió (se guarda en ai_interactions.input_summary; sin la lista de
// ejercicios ni la plantilla para no ocupar espacio).
export function summarizeContext(ctx: ReturnType<typeof buildAiContext>) {
  const {
    exercises: _exercises,
    activity_types: _activities,
    plan_templates: _templates,
    base_template,
    ...rest
  } = ctx as Record<string, unknown>
  void _exercises
  void _activities
  void _templates
  const base = base_template as { id?: string } | undefined
  return { ...rest, base_template: base?.id ?? null }
}
