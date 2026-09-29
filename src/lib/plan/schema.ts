// Validación del formato de plantillas y sesiones planificadas (CLAUDE.md §9).
import { z } from 'zod'
import type { PlanBlock, PlanStructure } from './types'

const exerciseSchema = z.object({
  exercise_id: z.string().min(1),
  sets: z.number().int().min(1).max(50).optional(),
  reps: z.string().min(1).optional(),
  rir: z.number().int().min(0).max(5).optional(),
  rest_s: z.number().int().min(0).max(600).optional(),
  distance_m: z.number().positive().optional(),
  duration_s: z.number().int().positive().optional(),
  calories: z.number().int().positive().optional(),
  note: z.string().optional(),
  standard: z.object({ men: z.string(), women: z.string() }).optional(),
})

export const planBlockSchema = z.object({
  block_type: z.enum([
    'straight',
    'superset',
    'circuit',
    'emom',
    'amrap',
    'tabata',
    'for_time',
    'intervals',
    'free',
  ]),
  exercises: z.array(exerciseSchema).min(1),
  minutes: z.number().int().positive().optional(),
  rounds: z.number().int().positive().optional(),
  rest_s: z.number().int().min(0).optional(),
  note: z.string().optional(),
})

export const planSessionSchema = z.object({
  day_hint: z.number().int().min(1).max(7),
  session_type: z.enum([
    'strength',
    'functional',
    'running',
    'swimming',
    'cycling',
    'spinning',
    'yoga',
  ]),
  title: z.string().min(1),
  intensity: z.enum(['easy', 'moderate', 'hard']),
  heavy_legs: z.boolean(),
  duration_min: z.number().int().positive(),
  notes: z.string().optional(),
  blocks: z.array(planBlockSchema).min(1),
})

export const planStructureSchema = z.object({
  weeks: z
    .array(
      z.object({
        week: z.number().int().min(1),
        deload: z.boolean(),
        sessions: z.array(planSessionSchema).min(1),
      }),
    )
    .min(1),
  progression_rules: z.string(),
})

export function parseStructure(value: unknown): PlanStructure | null {
  const result = planStructureSchema.safeParse(value)
  return result.success ? (result.data as PlanStructure) : null
}

export function parseBlocks(value: unknown): PlanBlock[] {
  const result = z.array(planBlockSchema).safeParse(value)
  return result.success ? (result.data as PlanBlock[]) : []
}
