// Plantilla recomendada según el onboarding, con reglas simples (sin IA; la IA llega en la fase 6).
import type { Goal, TrainingProfileData } from './profile'
import type { PlanFamily, PlanLevel } from './types'

export type TemplateSummary = {
  id: string
  family: PlanFamily
  level: string
  days_per_week: number
  name: string
}

export const FAMILY_LABELS: Record<PlanFamily, { label: string; emoji: string }> = {
  running: { label: 'Carrera', emoji: '🏃' },
  swimming: { label: 'Natación', emoji: '🏊' },
  strength: { label: 'Fuerza', emoji: '🏋️' },
  hyrox: { label: 'HYROX', emoji: '🏁' },
  deka: { label: 'DEKA', emoji: '🎯' },
  hybrid: { label: 'Híbrido', emoji: '⚡' },
}

const FAMILY_BY_GOAL: Record<Goal, PlanFamily> = {
  strength: 'strength',
  fat_loss: 'hybrid',
  running_event: 'running',
  hyrox_deka: 'hyrox',
  swimming: 'swimming',
  health: 'hybrid',
}

const GOAL_REASON: Record<Goal, string> = {
  strength: 'tu objetivo principal es ganar fuerza',
  fat_loss: 'para perder grasa combina fuerza y cardio',
  running_event: 'tu objetivo principal es la carrera',
  hyrox_deka: 'quieres preparar HYROX o DEKA',
  swimming: 'quieres nadar mejor',
  health: 'para la salud general lo variado funciona muy bien',
}

export function recommendedFamily(profile: TrainingProfileData): PlanFamily {
  const goal = profile.goals.main ?? profile.goals.selected[0] ?? null
  return goal ? FAMILY_BY_GOAL[goal] : 'hybrid'
}

export function recommendedLevel(profile: TrainingProfileData): PlanLevel {
  return profile.level === 'intermediate' || profile.level === 'advanced'
    ? 'intermediate'
    : 'beginner'
}

// Familia por objetivo; nivel por experiencia; si no tiene días para el nivel elegido, la
// variante con menos días de la misma familia.
export function recommendTemplate<T extends TemplateSummary>(
  profile: TrainingProfileData,
  templates: T[],
): { template: T; reason: string } | null {
  if (templates.length === 0) return null
  const family = recommendedFamily(profile)
  const level = recommendedLevel(profile)
  const days = profile.availability.days_per_week
  const inFamily = templates.filter((t) => t.family === family)
  const pool = inFamily.length > 0 ? inFamily : templates
  let template = pool.find((t) => t.level === level) ?? pool[0]!
  let fewerDays = false
  if (days !== null && template.days_per_week > days) {
    const fits = pool
      .filter((t) => t.days_per_week <= days)
      .sort((a, b) => b.days_per_week - a.days_per_week)[0]
    if (fits) {
      template = fits
      fewerDays = true
    }
  }
  const goal = profile.goals.main ?? profile.goals.selected[0] ?? null
  const parts = [
    goal ? GOAL_REASON[goal] : 'no has elegido objetivo y lo variado es buena base',
    fewerDays
      ? `se ajusta a tus ${days} días por semana`
      : template.level === 'beginner'
        ? 'nivel principiante'
        : 'nivel intermedio',
  ]
  return { template, reason: `Porque ${parts.join(' y ')}.` }
}
