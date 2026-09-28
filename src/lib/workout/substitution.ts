import type { Exercise } from './types'

// Alternativas basadas en reglas: comparten músculos primarios y usan material disponible.
// Si el usuario no ha indicado su material (onboarding en la Fase 5), no se filtra por material.
export function suggestAlternatives(
  target: Exercise,
  exercises: Exercise[],
  availableEquipment: string[] = [],
  limit = 8,
) {
  const primary = new Set(target.muscles.filter((m) => m.role === 'primary').map((m) => m.muscleId))
  if (primary.size === 0) return []
  const secondary = new Set(
    target.muscles.filter((m) => m.role === 'secondary').map((m) => m.muscleId),
  )
  const available = new Set(availableEquipment)

  return exercises
    .filter((e) => e.id !== target.id && e.category === target.category)
    .filter(
      (e) =>
        available.size === 0 ||
        e.equipment.length === 0 ||
        e.equipment.some((eq) => available.has(eq)),
    )
    .map((e) => {
      const ePrimary = e.muscles.filter((m) => m.role === 'primary').map((m) => m.muscleId)
      const shared = ePrimary.filter((m) => primary.has(m)).length
      const sharedSecondary = e.muscles.filter(
        (m) => m.role === 'secondary' && secondary.has(m.muscleId),
      ).length
      // Penaliza primarios que el original no trabaja.
      const extra = ePrimary.length - shared
      const score =
        shared * 10 + sharedSecondary - extra * 3 + (e.isCompound === target.isCompound ? 2 : 0)
      return { exercise: e, shared, score }
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name, 'es'))
    .slice(0, limit)
    .map((x) => x.exercise)
}
