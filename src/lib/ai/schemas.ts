// Formatos de las respuestas del entrenador IA (CLAUDE.md §11). Se usan en el servidor para
// validar lo que devuelve el proveedor y en el cliente para mostrar la propuesta.
//
// Solo campos opcionales (nunca null) y sin uniones: así el JSON Schema que se envía al
// proveedor es sencillo y lo aceptan Gemini y Anthropic. Los límites (mínimos, máximos) solo
// los comprueba Zod: si no se cumplen, se reintenta una vez con los errores.
import { z } from 'zod'
import type { ReviewFacts } from './review'
import type { PlanBlock, PlanExercise, PlanSession, PlanStructure } from '@/lib/plan/types'

const SESSION_TYPES = [
  'strength',
  'functional',
  'running',
  'swimming',
  'cycling',
  'spinning',
  'yoga',
] as const

const BLOCK_TYPES = [
  'straight',
  'superset',
  'circuit',
  'emom',
  'amrap',
  'tabata',
  'for_time',
  'intervals',
  'free',
] as const

export const aiExerciseSchema = z.object({
  exercise_id: z.string().min(1).describe('id exacto de la lista de ejercicios'),
  sets: z.number().int().min(1).max(30).optional(),
  reps: z
    .string()
    .regex(/^\d{1,3}(-\d{1,3})?$/, 'reps debe ser «8» o «8-10»')
    .optional()
    .describe('repeticiones: «8» o rango «8-10»'),
  rir: z.number().int().min(0).max(5).optional(),
  rest_s: z.number().int().min(0).max(600).optional(),
  distance_m: z.number().positive().max(50_000).optional(),
  duration_s: z.number().int().positive().max(14_400).optional(),
  calories: z.number().int().positive().max(1000).optional(),
  note: z.string().max(200).optional(),
})

export const aiBlockSchema = z.object({
  block_type: z.enum(BLOCK_TYPES),
  exercises: z.array(aiExerciseSchema).min(1).max(12),
  minutes: z.number().int().positive().max(90).optional().describe('EMOM/AMRAP: minutos'),
  rounds: z.number().int().positive().max(20).optional().describe('circuito: rondas'),
  rest_s: z.number().int().min(0).max(600).optional(),
  note: z.string().max(200).optional(),
})

export const aiSessionSchema = z.object({
  day_hint: z.number().int().min(1).max(7).describe('orden dentro de la semana (1 = primera)'),
  session_type: z.enum(SESSION_TYPES),
  title: z.string().min(1).max(80),
  intensity: z.enum(['easy', 'moderate', 'hard']),
  heavy_legs: z.boolean().describe('true si es una sesión pesada de pierna'),
  duration_min: z.number().int().min(10).max(240),
  notes: z.string().max(300).optional(),
  blocks: z.array(aiBlockSchema).min(1).max(10),
})

export const AI_PLAN_WEEKS = 4

// Plan de 4 semanas en el formato de las plantillas (§9) + nombre y resumen para la vista previa.
export const aiPlanSchema = z
  .object({
    name: z.string().min(1).max(80),
    summary: z.string().min(1).max(600).describe('por qué este plan, 2–4 frases'),
    progression_rules: z.string().min(1).max(400),
    weeks: z
      .array(
        z.object({
          week: z.number().int().min(1).max(AI_PLAN_WEEKS),
          deload: z.boolean(),
          sessions: z.array(aiSessionSchema).min(1).max(7),
        }),
      )
      .length(AI_PLAN_WEEKS),
  })
  .superRefine((plan, ctx) => {
    plan.weeks.forEach((w, i) => {
      if (w.week !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['weeks', i, 'week'],
          message: `las semanas deben ir en orden 1–${AI_PLAN_WEEKS}`,
        })
      }
    })
    const last = plan.weeks[AI_PLAN_WEEKS - 1]
    if (last && !last.deload) {
      ctx.addIssue({
        code: 'custom',
        path: ['weeks', AI_PLAN_WEEKS - 1, 'deload'],
        message: 'la semana 4 debe ser de descarga (deload: true)',
      })
    }
  })

export type AiPlan = z.infer<typeof aiPlanSchema>

export const ADJUST_DECISIONS = ['keep', 'reduce', 'change', 'rest'] as const
export type AdjustDecision = (typeof ADJUST_DECISIONS)[number]

export const ADJUST_LABELS: Record<AdjustDecision, { label: string; emoji: string }> = {
  keep: { label: 'Mantener la sesión', emoji: '✅' },
  reduce: { label: 'Reducir la sesión', emoji: '🔽' },
  change: { label: 'Cambiar la sesión', emoji: '🔄' },
  rest: { label: 'Descansar hoy', emoji: '🛌' },
}

// Ajuste del día (§11.3): mantener, reducir, cambiar o descansar, con el motivo en 1–2 frases.
export const dailyAdjustSchema = z
  .object({
    decision: z.enum(ADJUST_DECISIONS),
    reason: z.string().min(1).max(300).describe('motivo en 1–2 frases'),
    session: z
      .object({
        title: z.string().min(1).max(80),
        intensity: z.enum(['easy', 'moderate', 'hard']),
        heavy_legs: z.boolean(),
        duration_min: z.number().int().min(10).max(240),
        notes: z.string().max(300).optional(),
        blocks: z.array(aiBlockSchema).min(1).max(10),
      })
      .optional()
      .describe('solo con decision reduce o change: la sesión ajustada completa'),
  })
  .superRefine((value, ctx) => {
    const needsSession = value.decision === 'reduce' || value.decision === 'change'
    if (needsSession && !value.session) {
      ctx.addIssue({
        code: 'custom',
        path: ['session'],
        message: 'con reduce o change hay que incluir la sesión ajustada',
      })
    }
  })

export type DailyAdjust = z.infer<typeof dailyAdjustSchema>

// ── Cambios del plan (revisión semanal y chat) ──────────────
// Se aplican en la base de datos (respond_ai_change, 0025) leyendo la propuesta guardada.

export const PLAN_CHANGE_ACTIONS = ['modify', 'move', 'skip', 'add'] as const
export type PlanChangeAction = (typeof PLAN_CHANGE_ACTIONS)[number]

export const CHANGE_LABELS: Record<PlanChangeAction, { label: string; emoji: string }> = {
  modify: { label: 'Cambiar sesión', emoji: '🔄' },
  move: { label: 'Mover sesión', emoji: '📅' },
  skip: { label: 'Descanso en vez de sesión', emoji: '🛌' },
  add: { label: 'Añadir sesión', emoji: '➕' },
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const aiChangeSessionSchema = z.object({
  session_type: z
    .enum(SESSION_TYPES)
    .optional()
    .describe('obligatorio con add; con modify, solo si cambia'),
  title: z.string().min(1).max(80),
  intensity: z.enum(['easy', 'moderate', 'hard']),
  heavy_legs: z.boolean(),
  duration_min: z.number().int().min(10).max(240),
  notes: z.string().max(300).optional(),
  blocks: z.array(aiBlockSchema).min(1).max(10),
})

export const planChangeSchema = z
  .object({
    action: z.enum(PLAN_CHANGE_ACTIONS),
    planned_session_id: z
      .string()
      .optional()
      .describe('id de la sesión planificada (modify, move y skip), de upcoming_sessions'),
    date: z
      .string()
      .regex(ISO_DATE, 'date debe ser AAAA-MM-DD')
      .optional()
      .describe('AAAA-MM-DD: nuevo día (move) o día de la sesión nueva (add)'),
    title: z.string().min(1).max(100).describe('qué cambia, en pocas palabras'),
    reason: z.string().min(1).max(300).describe('por qué, en 1 frase'),
    session: aiChangeSessionSchema
      .optional()
      .describe('modify y add: la sesión completa; move y skip: no'),
  })
  .superRefine((c, ctx) => {
    if (c.action !== 'add' && !c.planned_session_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['planned_session_id'],
        message: `con ${c.action} hay que indicar planned_session_id`,
      })
    }
    if ((c.action === 'move' || c.action === 'add') && !c.date) {
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: `con ${c.action} hay que indicar date`,
      })
    }
    if ((c.action === 'modify' || c.action === 'add') && !c.session) {
      ctx.addIssue({
        code: 'custom',
        path: ['session'],
        message: `con ${c.action} hay que incluir la sesión completa`,
      })
    }
    if (c.action === 'add' && c.session && !c.session.session_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['session', 'session_type'],
        message: 'con add hay que indicar session_type',
      })
    }
  })

export type PlanChange = z.infer<typeof planChangeSchema>

// ── Revisión semanal (§11.4) ────────────────────────────────

export const REVIEW_RECOMMENDATIONS = 3
export const MAX_REVIEW_CHANGES = 4

export const weeklyReviewSchema = z.object({
  headline: z.string().min(1).max(120).describe('titular de la semana, con tono de ánimo'),
  summary: z
    .string()
    .min(1)
    .max(800)
    .describe('2–4 frases: adherencia, carga, músculos y récords de la semana revisada'),
  recommendations: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        detail: z.string().min(1).max(300),
      }),
    )
    .length(REVIEW_RECOMMENDATIONS)
    .describe('exactamente 3 recomendaciones concretas y accionables'),
  changes: z
    .array(planChangeSchema)
    .max(MAX_REVIEW_CHANGES)
    .describe('cambios para la semana siguiente (vacío si no hacen falta o no hay plan)'),
})

export type WeeklyReviewAi = z.infer<typeof weeklyReviewSchema>

// ── Chat (§11.5) ────────────────────────────────────────────
// Conjunto cerrado de acciones que el chat puede proponer. Cada una llega al usuario como una
// tarjeta con su botón: nunca se aplica sola. Lo que no está en la lista, la IA lo dice en el
// texto y sugiere lo más parecido que sí puede hacer.

export const CHAT_MAX_MESSAGE = 1000
// Mensajes anteriores que se envían a la IA (para ahorrar tokens).
export const CHAT_HISTORY_MESSAGES = 10
// Tarjetas como máximo en una respuesta (p. ej. una por día de la semana).
export const MAX_CHAT_ACTIONS = 7
// Cambios de sesiones como máximo en una respuesta (compatibilidad con las guardadas antes).
export const MAX_CHAT_CHANGES = MAX_CHAT_ACTIONS
// Días como máximo de un bloque de varios días (add_sessions_range): la ventana del chat.
export const MAX_RANGE_DAYS = 14

export const CHAT_ACTION_TYPES = [
  'create_plan',
  'add_session',
  'move_session',
  'skip_session',
  'modify_session',
  'adjust_today',
  'add_sessions_range',
] as const
export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number]

// Acciones de sesiones del chat → cambios del plan que aplica respond_ai_change (0025).
export const CHAT_SESSION_ACTIONS: Partial<Record<ChatActionType, PlanChangeAction>> = {
  add_session: 'add',
  move_session: 'move',
  skip_session: 'skip',
  modify_session: 'modify',
}

export const PLAN_FAMILIES = ['running', 'swimming', 'strength', 'hyrox', 'deka', 'hybrid'] as const
export type PlanFamilyName = (typeof PLAN_FAMILIES)[number]

// create_plan: qué plan pide el usuario. El plan en sí se genera después con el mismo flujo que
// «Personalizar con IA» (proposePlan), con la plantilla elegida y las mismas validaciones.
export const chatPlanRequestSchema = z.object({
  family: z.enum(PLAN_FAMILIES).describe('familia de plantilla'),
  level: z.enum(['beginner', 'intermediate']).optional(),
  days_per_week: z.number().int().min(1).max(7).describe('sesiones por semana'),
  template_id: z.string().max(80).optional().describe('id exacto de «plan_templates», si encaja'),
  focus: z
    .string()
    .max(300)
    .optional()
    .describe('indicaciones del usuario para el plan (objetivo, material, preferencias)'),
})

export type ChatPlanRequest = z.infer<typeof chatPlanRequestSchema>

// Un día de un bloque de varios días (add_sessions_range).
export const chatRangeDaySchema = z.object({
  date: z.string().regex(ISO_DATE, 'date debe ser AAAA-MM-DD').describe('AAAA-MM-DD'),
  session: aiChangeSessionSchema.describe('la sesión de ese día, con session_type'),
})

export type ChatRangeDay = z.infer<typeof chatRangeDaySchema>

// Una acción propuesta. Los campos que necesita cada tipo se comprueban aparte
// (validateChatActions): si falta algo, se reintenta y, si no, se descarta con un aviso.
export const chatActionSchema = z.object({
  type: z.enum(CHAT_ACTION_TYPES),
  title: z.string().min(1).max(100).describe('qué propones, en pocas palabras'),
  reason: z.string().min(1).max(300).describe('por qué, en 1 frase'),
  planned_session_id: z
    .string()
    .optional()
    .describe('move_session, skip_session, modify_session: id de upcoming_sessions'),
  date: z
    .string()
    .regex(ISO_DATE, 'date debe ser AAAA-MM-DD')
    .optional()
    .describe('move_session: nuevo día; add_session: día de la sesión nueva'),
  session: aiChangeSessionSchema
    .optional()
    .describe('add_session y modify_session: la sesión completa'),
  plan: chatPlanRequestSchema.optional().describe('solo create_plan'),
  days: z
    .array(chatRangeDaySchema)
    .max(MAX_RANGE_DAYS)
    .optional()
    .describe('solo add_sessions_range: un elemento por día con sesión (días sin sesión, fuera)'),
})

export type ChatAction = z.infer<typeof chatActionSchema>

export const chatReplySchema = z.object({
  reply: z.string().min(1).max(1500).describe('respuesta al usuario, breve y en español'),
  actions: z
    .array(chatActionSchema)
    .max(MAX_CHAT_ACTIONS)
    .optional()
    .describe('solo si propones algo de la lista: tarjetas que el usuario acepta o descarta'),
})

export type ChatReply = z.infer<typeof chatReplySchema>

// Ajuste del día pedido desde el chat: se genera con el ajuste del día (daily_adjust).
export type ChatAdjustRequest = { title: string; reason: string; planned_session_id: string }

// Bloque de varios días (add_sessions_range): una tarjeta que añade varias sesiones al plan a la
// vez (respond_chat_range, 0034).
export type ChatRange = { title: string; reason: string; days: ChatRangeDay[] }

// Datos para depurar el chat (se guardan en ai_interactions.output; solo se enseñan en modo
// depuración): modelo, respuestas crudas, problemas de cada intento y descartes.
export type ChatDebug = {
  model: string | null
  tier: 'light' | 'heavy'
  attempts: number
  raw: string[]
  issues: string[][]
  discarded: string[]
  // Motivo si la app ha cambiado o completado el texto de la IA.
  text_fix: 'honest' | 'fewer_cards' | null
  original_reply?: string
  // Cadena de modelos: cada intento con su resultado y tiempos; ms = duración total.
  models?: ModelAttempt[]
  ms?: number
}

// Lo que se guarda en ai_interactions.output y llega al cliente. `changes` conserva el formato de
// 0025 (respond_ai_change los aplica por índice).
export type ChatResult = {
  reply: string
  changes: PlanChange[]
  // exercise_id inventados por la IA que se han descartado.
  dropped: string[]
  plan_request?: ChatPlanRequest & { title: string; reason: string }
  adjust_today?: ChatAdjustRequest
  // Acciones descartadas por no poderse aplicar (se avisa en la tarjeta).
  discarded?: string[]
  ranges?: ChatRange[]
  debug?: ChatDebug
}

// Resultado real (de la base de datos, 0033) de las acciones del chat.
export type ChatPlanResult =
  | { status: 'prepared'; interaction_id: string }
  | {
      status: 'accepted'
      interaction_id: string
      plan_id: string
      name: string
      start_date: string
      sessions: number
      weeks: number
      per_week: number
      replaced: string | null
    }
  | { status: 'discarded' }

export type ChatAdjustResult =
  | {
      status: 'accepted'
      interaction_id: string
      decision: AdjustDecision
      planned_session_id: string
      date: string
      title: string
      session_status: string
    }
  | { status: 'discarded' }

export type ChatRangeResult =
  | {
      status: 'accepted'
      created: number
      dates: string[]
      // Días que ya tenían una sesión planificada (el usuario lo aceptó).
      conflicts: string[]
    }
  | { status: 'discarded' }

export type ChatActionResults = {
  plan?: ChatPlanResult
  adjust?: ChatAdjustResult
  // Por índice del bloque en `ranges`.
  ranges?: Record<string, ChatRangeResult>
}

// ── Sustituir ejercicio (§11.6) ─────────────────────────────

export const swapSchema = z.object({
  alternatives: z
    .array(
      z.object({
        exercise_id: z.string().min(1).describe('id exacto de la lista de ejercicios'),
        reason: z.string().min(1).max(200).describe('por qué sirve, en 1 frase'),
      }),
    )
    .min(1)
    .max(3),
})

export type SwapAi = z.infer<typeof swapSchema>

// ── Resultado de las funciones de servidor ─────────────────

// Errores del proveedor de IA:
// quota: cuota o límite de velocidad (429). auth: clave no válida o sin permiso.
// timeout: la llamada ha superado su tiempo máximo. unavailable: caída o error de red.
// bad_request: el proveedor rechaza la petición (modelo inexistente, esquema no aceptado…).
// blocked: se niega a responder (filtros de seguridad). truncated: respuesta cortada por longitud.
export type AiProviderErrorKind =
  'quota' | 'auth' | 'timeout' | 'unavailable' | 'bad_request' | 'blocked' | 'truncated'

// Cuota diaria (RPD: hasta el día siguiente) o por minuto (RPM/TPM: unos segundos).
export type QuotaScope = 'daily' | 'minute'

// Un intento de la cadena de modelos (se guarda en ai_interactions.output.model_log y se enseña
// en el modo depuración).
export type ModelAttempt = {
  model: string
  // heavy = GEMINI_MODEL_HEAVY, light = GEMINI_MODEL (o AI_MODEL), fallback = GEMINI_FALLBACK_MODEL.
  role: 'heavy' | 'light' | 'fallback'
  // ok, el tipo de error o skipped (bloqueado por cuota hasta `blocked_until`, o sin tiempo).
  outcome: 'ok' | AiProviderErrorKind | 'skipped'
  status?: number
  // Solo en cuota: diaria o por minuto (null = no se sabe).
  scope?: QuotaScope | null
  // Duración de la llamada y tiempo máximo que tenía.
  ms: number
  timeout_ms?: number
  detail?: string
  blocked_until?: string
}

// Detalle técnico de un fallo (solo se enseña en el modo depuración).
export type AiFailureDebug = { models: ModelAttempt[]; ms: number; error: string }

export const AI_ERROR_CODES = [
  'not_configured',
  'daily_limit',
  'provider_quota',
  'provider_auth',
  'provider_unavailable',
  'provider_timeout',
  'invalid_output',
  'no_planned_session',
  'in_progress',
  'rules_available',
  'not_generated',
  'no_data',
  'failed',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export type AiFailure = { ok: false; code: AiErrorCode; message: string; debug?: AiFailureDebug }
export type AiSuccess<T> = { ok: true; interactionId: string; remaining: number } & T
export type AiResult<T> = AiSuccess<T> | AiFailure

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  not_configured:
    'El entrenador IA no está configurado (falta la clave del proveedor). La app funciona igual sin IA.',
  daily_limit: 'Has llegado al límite de consultas a la IA de hoy. Mañana podrás seguir.',
  provider_quota: 'La IA ha llegado a su límite de hoy; mañana vuelve a estar disponible.',
  provider_auth: 'La clave del proveedor de IA no es válida. Revisa la configuración en Vercel.',
  provider_unavailable: 'La IA no está disponible ahora mismo; prueba en unos minutos.',
  provider_timeout: 'Ha tardado demasiado; prueba con una petición más corta.',
  invalid_output:
    'La IA ha devuelto una propuesta que no se puede usar. Prueba de nuevo; tu plan no ha cambiado.',
  no_planned_session: 'Hoy no tienes ninguna sesión pendiente en el plan.',
  not_generated: 'Aún no hay revisión de esta semana.',
  no_data: 'La semana pasada no hubo sesiones ni plan: no hay nada que revisar todavía.',
  in_progress: 'La IA ya está preparando esto. Espera un momento y vuelve a abrirlo.',
  rules_available:
    'Hay alternativas con los mismos músculos y tu material: elige una de la lista sin gastar consultas.',
  failed: 'No se ha podido completar la consulta a la IA. Prueba de nuevo.',
}

// Cuota agotada por minuto (no hasta mañana) o sin saber cuál.
export const QUOTA_MINUTE_MESSAGE =
  'La IA ha llegado a su límite de consultas por minuto; prueba de nuevo en un minuto.'
export const QUOTA_UNKNOWN_MESSAGE =
  'La IA ha agotado su cuota por ahora; prueba de nuevo dentro de un rato.'

export function aiFailure(
  code: AiErrorCode,
  message = AI_ERROR_MESSAGES[code],
  debug?: AiFailureDebug,
): AiFailure {
  return debug ? { ok: false, code, message, debug } : { ok: false, code, message }
}

export type AiStatus = {
  configured: boolean
  provider: string
  model: string
  limit: number
  usedToday: number
}

// ── Conversión a los tipos del plan ─────────────────────────

type AiBlock = z.infer<typeof aiBlockSchema>

export function toPlanBlocks(blocks: AiBlock[]): PlanBlock[] {
  return blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e): PlanExercise => ({ ...e })),
  }))
}

export function toPlanSession(s: AiPlan['weeks'][number]['sessions'][number]): PlanSession {
  return { ...s, blocks: toPlanBlocks(s.blocks) }
}

export function toPlanStructure(plan: AiPlan): PlanStructure {
  return {
    progression_rules: plan.progression_rules,
    weeks: plan.weeks.map((w) => ({ ...w, sessions: w.sessions.map(toPlanSession) })),
  }
}

// Propuesta de plan que llega al cliente (vista previa con Aceptar / Editar / Descartar).
export type PlanProposal = {
  name: string
  summary: string
  baseTemplateId: string | null
  structure: PlanStructure
  // exercise_id inventados por la IA que se han descartado.
  dropped: string[]
}

// Revisión semanal que llega al cliente: datos calculados (no de la IA) + texto de la IA.
export type WeeklyReview = {
  weekStart: string
  facts: ReviewFacts
  review: Omit<WeeklyReviewAi, 'changes'>
  changes: PlanChange[]
  // exercise_id inventados por la IA que se han descartado.
  dropped: string[]
}

export type ChangeResponses = Record<string, 'accepted' | 'discarded'>

export type SwapProposal = {
  exerciseId: string
  alternatives: { exercise_id: string; reason: string }[]
}

export type AdjustProposal = {
  plannedSessionId: string
  adjust: DailyAdjust
  dropped: string[]
}
