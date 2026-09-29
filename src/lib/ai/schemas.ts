// Formatos de las respuestas del entrenador IA (CLAUDE.md §11). Se usan en el servidor para
// validar lo que devuelve el proveedor y en el cliente para mostrar la propuesta.
//
// Solo campos opcionales (nunca null) y sin uniones: así el JSON Schema que se envía al
// proveedor es sencillo y lo aceptan Gemini y Anthropic. Los límites (mínimos, máximos) solo
// los comprueba Zod: si no se cumplen, se reintenta una vez con los errores.
import { z } from 'zod'
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

// ── Resultado de las funciones de servidor ─────────────────

export const AI_ERROR_CODES = [
  'not_configured',
  'daily_limit',
  'provider_quota',
  'provider_auth',
  'provider_unavailable',
  'invalid_output',
  'no_planned_session',
  'failed',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

export type AiFailure = { ok: false; code: AiErrorCode; message: string }
export type AiSuccess<T> = { ok: true; interactionId: string; remaining: number } & T
export type AiResult<T> = AiSuccess<T> | AiFailure

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  not_configured:
    'El entrenador IA no está configurado (falta la clave del proveedor). La app funciona igual sin IA.',
  daily_limit: 'Has llegado al límite de consultas a la IA de hoy. Mañana podrás seguir.',
  provider_quota:
    'El proveedor de IA ha agotado su cuota gratuita por ahora. Prueba dentro de un rato.',
  provider_auth: 'La clave del proveedor de IA no es válida. Revisa la configuración en Vercel.',
  provider_unavailable: 'La IA no responde ahora mismo. Prueba de nuevo en unos minutos.',
  invalid_output:
    'La IA ha devuelto una propuesta que no se puede usar. Prueba de nuevo; tu plan no ha cambiado.',
  no_planned_session: 'Hoy no tienes ninguna sesión pendiente en el plan.',
  failed: 'No se ha podido completar la consulta a la IA. Prueba de nuevo.',
}

export function aiFailure(code: AiErrorCode, message = AI_ERROR_MESSAGES[code]): AiFailure {
  return { ok: false, code, message }
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

export type AdjustProposal = {
  plannedSessionId: string
  adjust: DailyAdjust
  dropped: string[]
}
