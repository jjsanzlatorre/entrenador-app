// «Editar» la propuesta de plan de la IA antes de aceptarla.
import { describe, expect, it } from 'vitest'
import {
  canRemoveExercise,
  canRemoveSession,
  parseRepsInput,
  removeExercise,
  removeSession,
  renameSession,
  updateExercise,
} from './edit-plan'
import { toPlanStructure } from './schemas'
import { samplePlan } from './test-fixtures'

describe('editar propuesta', () => {
  const plan = toPlanStructure(samplePlan())

  it('quita una sesión de una semana, pero nunca la última', () => {
    const out = removeSession(plan, 0, 1)
    expect(out.weeks[0]!.sessions.map((s) => s.title)).toEqual(['Full body 1', 'Full body 3'])
    expect(out.weeks[1]!.sessions).toHaveLength(3)
    let one = removeSession(removeSession(plan, 0, 0), 0, 0)
    expect(canRemoveSession(one, 0)).toBe(false)
    one = removeSession(one, 0, 0)
    expect(one.weeks[0]!.sessions).toHaveLength(1)
  })

  it('quita ejercicios (y bloques vacíos) sin dejar una sesión vacía', () => {
    const path = { week: 0, session: 0, block: 0, exercise: 0 }
    const out = removeExercise(plan, path)
    expect(out.weeks[0]!.sessions[0]!.blocks).toHaveLength(1)
    expect(out.weeks[0]!.sessions[0]!.blocks[0]!.exercises[0]!.exercise_id).toBe('bench_press')
    expect(canRemoveExercise(out, path)).toBe(false)
    expect(removeExercise(out, path)).toBe(out)
    // El original no cambia.
    expect(plan.weeks[0]!.sessions[0]!.blocks).toHaveLength(2)
  })

  it('cambia series, reps y título', () => {
    const path = { week: 2, session: 1, block: 1, exercise: 0 }
    const out = updateExercise(plan, path, { sets: 4, reps: '6-8' })
    expect(out.weeks[2]!.sessions[1]!.blocks[1]!.exercises[0]).toMatchObject({
      sets: 4,
      reps: '6-8',
    })
    expect(out.weeks[2]!.sessions[0]!.blocks[1]!.exercises[0]).toMatchObject({
      sets: 3,
      reps: '8-10',
    })
    expect(renameSession(plan, 0, 0, 'Pierna').weeks[0]!.sessions[0]!.title).toBe('Pierna')
  })

  it('valida las reps escritas a mano', () => {
    expect(parseRepsInput(' 8 - 10 ')).toBe('8-10')
    expect(parseRepsInput('8–10')).toBe('8-10')
    expect(parseRepsInput('12')).toBe('12')
    expect(parseRepsInput('muchas')).toBeNull()
    expect(parseRepsInput('')).toBeNull()
  })
})
