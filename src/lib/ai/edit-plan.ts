// «Editar» la propuesta de plan antes de aceptarla: quitar sesiones o ejercicios y cambiar
// series y reps. Funciones puras sobre la estructura (§9); nunca dejan una semana vacía.
import type { PlanExercise, PlanStructure } from '@/lib/plan/types'

export type ExercisePath = { week: number; session: number; block: number; exercise: number }

function mapSession(
  plan: PlanStructure,
  week: number,
  session: number,
  fn: (s: PlanStructure['weeks'][number]['sessions'][number]) => typeof s | null,
): PlanStructure {
  return {
    ...plan,
    weeks: plan.weeks.map((w, wi) =>
      wi !== week
        ? w
        : {
            ...w,
            sessions: w.sessions.flatMap((s, si) => {
              if (si !== session) return [s]
              const next = fn(s)
              return next ? [next] : []
            }),
          },
    ),
  }
}

export function canRemoveSession(plan: PlanStructure, week: number) {
  return (plan.weeks[week]?.sessions.length ?? 0) > 1
}

export function removeSession(plan: PlanStructure, week: number, session: number) {
  if (!canRemoveSession(plan, week)) return plan
  return mapSession(plan, week, session, () => null)
}

export function renameSession(plan: PlanStructure, week: number, session: number, title: string) {
  const clean = title.slice(0, 80)
  return mapSession(plan, week, session, (s) => ({ ...s, title: clean }))
}

// Quita un ejercicio; si el bloque se queda vacío se quita el bloque. No deja una sesión sin
// bloques (para eso está quitar la sesión).
export function canRemoveExercise(plan: PlanStructure, p: Omit<ExercisePath, 'exercise'>) {
  const s = plan.weeks[p.week]?.sessions[p.session]
  if (!s) return false
  return s.blocks.length > 1 || (s.blocks[p.block]?.exercises.length ?? 0) > 1
}

export function removeExercise(plan: PlanStructure, p: ExercisePath) {
  if (!canRemoveExercise(plan, p)) return plan
  return mapSession(plan, p.week, p.session, (s) => ({
    ...s,
    blocks: s.blocks.flatMap((b, bi) => {
      if (bi !== p.block) return [b]
      const exercises = b.exercises.filter((_, ei) => ei !== p.exercise)
      return exercises.length > 0 ? [{ ...b, exercises }] : []
    }),
  }))
}

export function updateExercise(
  plan: PlanStructure,
  p: ExercisePath,
  patch: Pick<PlanExercise, 'sets' | 'reps'>,
) {
  return mapSession(plan, p.week, p.session, (s) => ({
    ...s,
    blocks: s.blocks.map((b, bi) =>
      bi !== p.block
        ? b
        : {
            ...b,
            exercises: b.exercises.map((e, ei) => (ei === p.exercise ? { ...e, ...patch } : e)),
          },
    ),
  }))
}

// «8-10» o «12»; cualquier otra cosa no vale.
export function parseRepsInput(value: string) {
  const v = value.replace(/\s/g, '').replace('–', '-')
  return /^\d{1,3}(-\d{1,3})?$/.test(v) ? v : null
}
