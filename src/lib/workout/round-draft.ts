// Borrador del editor de bloques por rondas (crear, editar y la vista previa de «Escribir
// entreno»): textos tal y como los escribe el usuario, convertidos con el parser único
// (src/lib/input/quantity.ts) al aplicar. Lógica pura, con tests.
import {
  describeDuration,
  formatDurationInput,
  formatQuantityInput,
  parseDuration,
  parseCount,
  parseQuantity,
} from '@/lib/input/quantity'
import { fieldSpecs, type SetField } from './fields'
import {
  DEFAULT_ROUND_REST_S,
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  roundSettings,
  roundTargets,
  type RoundBlockInput,
  type RoundTarget,
} from './rounds'
import type { ParsedBlock, ParsedItem, MatchKind } from './text-parse'
import type { Exercise, LastPerformance, LocalBlock } from './types'

export type DraftItem = {
  key: string
  exerciseId: string | null
  // Lo escrito (para buscar o crear el ejercicio si no se reconoce).
  name: string
  match: MatchKind | null
  values: Partial<Record<SetField, string>>
  perSide: boolean
}

export type RoundDraft = {
  rounds: string
  restBetweenExercisesS: string
  restBetweenRoundsS: string
  items: DraftItem[]
}

let counter = 0
const nextKey = () => `d${++counter}`

const seconds = (s: number) => formatDurationInput(s, 's')

export function emptyDraft(): RoundDraft {
  return {
    rounds: String(DEFAULT_ROUNDS),
    restBetweenExercisesS: '0',
    restBetweenRoundsS: seconds(DEFAULT_ROUND_REST_S),
    items: [],
  }
}

// ¿Se ofrece «cada lado»? Unilaterales e isométricos (plancha lateral, búlgara, farmer…).
export function canBePerSide(exercise: Pick<Exercise, 'isUnilateral' | 'trackingType'>) {
  return exercise.isUnilateral || exercise.trackingType === 'time'
}

function textValues(exercise: Exercise | undefined, values: RoundTarget) {
  const out: Partial<Record<SetField, string>> = {}
  for (const spec of fieldSpecs(exercise)) {
    const v = values[spec.field]
    out[spec.field] = v === null || v === undefined ? '' : formatQuantityInput(v, spec.quantity)
  }
  return out
}

// Ejercicio nuevo en el borrador: valores de la última vez (primera serie de trabajo) y
// «cada lado» marcado en los unilaterales.
export function draftItemFor(exercise: Exercise, last?: LastPerformance | null): DraftItem {
  const ref = last?.sets.find((s) => !s.isWarmup) ?? last?.sets[0]
  return {
    key: nextKey(),
    exerciseId: exercise.id,
    name: exercise.name,
    match: null,
    values: textValues(exercise, ref ?? {}),
    perSide: exercise.isUnilateral,
  }
}

function itemFromParsed(item: ParsedItem, byId: Map<string, Exercise>): DraftItem {
  const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
  return {
    key: nextKey(),
    exerciseId: exercise ? exercise.id : null,
    name: exercise?.name ?? item.name,
    match: exercise ? item.match : null,
    values: exercise
      ? textValues(exercise, item)
      : // Sin ejercicio: se guardan para cuando se elija (se vuelven a formatear entonces).
        {
          reps: item.reps === null ? '' : String(item.reps),
          durationS: item.durationS === null ? '' : `${item.durationS} s`,
          weightKg: item.weightKg === null ? '' : String(item.weightKg).replace('.', ','),
          distanceM: item.distanceM === null ? '' : `${item.distanceM} m`,
          calories: item.calories === null ? '' : String(item.calories),
        },
    perSide: item.perSide,
  }
}

export function draftFromParsed(block: ParsedBlock, byId: Map<string, Exercise>): RoundDraft {
  return {
    rounds: String(block.rounds),
    restBetweenExercisesS: '0',
    restBetweenRoundsS: seconds(block.restBetweenRoundsS ?? DEFAULT_ROUND_REST_S),
    items: block.items.map((i) => itemFromParsed(i, byId)),
  }
}

// Editar un bloque que ya está en la sesión: valores de la primera ronda pendiente.
export function draftFromBlock(block: LocalBlock, byId: Map<string, Exercise>): RoundDraft {
  const settings = roundSettings(block)
  const targets = roundTargets(block)
  return {
    rounds: String(settings.rounds),
    restBetweenExercisesS: seconds(settings.restBetweenExercisesS),
    restBetweenRoundsS: seconds(settings.restBetweenRoundsS),
    items: block.exercises.map((e) => {
      const exercise = byId.get(e.exerciseId)
      return {
        key: nextKey(),
        exerciseId: e.exerciseId,
        name: exercise?.name ?? e.exerciseId,
        match: null,
        values: textValues(exercise, targets.get(e.exerciseId) ?? {}),
        perSide: Boolean(e.perSide),
      }
    }),
  }
}

// Elegir (o cambiar) el ejercicio de una fila: los valores ya escritos se reinterpretan con los
// campos y unidades del nuevo ejercicio.
export function assignExercise(item: DraftItem, exercise: Exercise): DraftItem {
  const values: RoundTarget = {}
  for (const spec of fieldSpecs(exercise)) {
    const text = item.values[spec.field]
    values[spec.field] = text ? parseQuantity(text, spec.quantity) : null
  }
  return {
    ...item,
    exerciseId: exercise.id,
    name: exercise.name,
    match: null,
    values: textValues(exercise, values),
    perSide: item.perSide || exercise.isUnilateral,
  }
}

export type DraftProblem = { key: string | null; message: string }

export function draftProblems(draft: RoundDraft, byId: Map<string, Exercise>): DraftProblem[] {
  const problems: DraftProblem[] = []
  if (draft.items.length === 0) problems.push({ key: null, message: 'Añade al menos un ejercicio' })
  const rounds = parseCount(draft.rounds)
  if (rounds === null || rounds < 1 || rounds > MAX_ROUNDS)
    problems.push({ key: null, message: `Rondas: entre 1 y ${MAX_ROUNDS}` })
  if (parseDuration(draft.restBetweenRoundsS || '0', 's') === null)
    problems.push({ key: null, message: 'Revisa el descanso entre rondas' })
  if (parseDuration(draft.restBetweenExercisesS || '0', 's') === null)
    problems.push({ key: null, message: 'Revisa el descanso entre ejercicios' })
  for (const item of draft.items) {
    const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
    if (!exercise) {
      problems.push({ key: item.key, message: `Elige o crea «${item.name || 'ejercicio'}»` })
      continue
    }
    for (const spec of fieldSpecs(exercise)) {
      const text = item.values[spec.field]?.trim()
      if (text && parseQuantity(text, spec.quantity) === null)
        problems.push({ key: item.key, message: `${exercise.name}: revisa ${spec.label}` })
    }
  }
  return problems
}

// Borrador → datos del bloque. Null si tiene problemas.
export function draftToInput(
  draft: RoundDraft,
  byId: Map<string, Exercise>,
): RoundBlockInput | null {
  if (draftProblems(draft, byId).length > 0) return null
  return {
    rounds: parseCount(draft.rounds) ?? DEFAULT_ROUNDS,
    restBetweenExercisesS: parseDuration(draft.restBetweenExercisesS || '0', 's') ?? 0,
    restBetweenRoundsS: parseDuration(draft.restBetweenRoundsS || '0', 's') ?? 0,
    exercises: draft.items.map((item) => {
      const exercise = byId.get(item.exerciseId!)!
      const target: RoundTarget = {}
      for (const spec of fieldSpecs(exercise)) {
        const text = item.values[spec.field]?.trim()
        target[spec.field] = text ? parseQuantity(text, spec.quantity) : null
      }
      return { exercise, target, perSide: item.perSide && canBePerSide(exercise) }
    }),
  }
}

// «Plancha lateral 45 s/lado · Hip thrust 20 reps…» para la vista previa.
export function describeRestS(s: number) {
  return s > 0 ? describeDuration(s) : 'sin descanso'
}
