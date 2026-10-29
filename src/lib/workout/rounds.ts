// Bloques por rondas (superseries y circuitos): crear con N rondas precargadas, «+1 ronda»,
// «Quitar ronda», «✓ Ronda», «Aplicar a las rondas siguientes», editar el bloque, duplicarlo y
// copiarlo de otra sesión. Funciones puras sobre la sesión local, como session-ops.
//
// Una ronda es el conjunto de series con el mismo setIndex (una por ejercicio): el formato de
// las superseries de siempre, así que las sesiones antiguas, el volumen muscular y el servidor no
// cambian. El descanso entre rondas es el `restS` del último ejercicio (como en las superseries
// antiguas); el de entre ejercicios va en settings.restBetweenExercisesS.
import { toggleSetComplete, type IdFn, type SetPatch } from './session-ops'
import { isTimedBlock, resetTimedBlock } from './timed-blocks'
import type { CircuitConfig, Exercise, LocalBlock, LocalSession, SetEntry } from './types'

const defaultId: IdFn = () => crypto.randomUUID()

export const DEFAULT_ROUNDS = 3
export const DEFAULT_ROUND_REST_S = 90
export const MAX_ROUNDS = 20
export const ROUND_CHIPS = [2, 3, 4, 5]

const VALUE_FIELDS = ['weightKg', 'reps', 'durationS', 'distanceM', 'calories'] as const
type ValueField = (typeof VALUE_FIELDS)[number]

export type RoundTarget = Partial<Record<ValueField, number | null>>

export type RoundExerciseInput = {
  exercise: Pick<Exercise, 'id' | 'defaultRestS'>
  target: RoundTarget
  perSide?: boolean
}

export type RoundBlockInput = {
  exercises: RoundExerciseInput[]
  rounds: number
  restBetweenExercisesS: number
  restBetweenRoundsS: number
}

function bump(session: LocalSession, now: number): LocalSession {
  return { ...session, rev: Math.max(session.rev + 1, now) }
}

function reindex(blocks: LocalBlock[]) {
  return blocks.map((b, i) => (b.order === i ? b : { ...b, order: i }))
}

function mapBlock(
  session: LocalSession,
  blockId: string,
  fn: (block: LocalBlock) => LocalBlock,
  now: number,
): LocalSession {
  let changed = false
  const blocks = session.blocks.map((b) => {
    if (b.id !== blockId) return b
    const next = fn(b)
    changed ||= next !== b
    return next
  })
  return changed ? bump({ ...session, blocks }, now) : session
}

function pendingSet(exerciseId: string, setIndex: number, id: string, values: RoundTarget) {
  const set: SetEntry = {
    id,
    exerciseId,
    setIndex,
    isWarmup: false,
    weightKg: null,
    reps: null,
    rir: null,
    durationS: null,
    distanceM: null,
    calories: null,
    completed: false,
    completedAt: null,
  }
  for (const f of VALUE_FIELDS) if (values[f] !== undefined) set[f] = values[f] ?? null
  return set
}

function valuesOf(set: SetEntry): RoundTarget {
  return Object.fromEntries(VALUE_FIELDS.map((f) => [f, set[f]]))
}

function clampRounds(n: number) {
  return Math.min(MAX_ROUNDS, Math.max(1, Math.round(n) || 1))
}

// Superserie o circuito sin temporizador: se registra por rondas.
export function isRoundBlock(block: Pick<LocalBlock, 'blockType' | 'settings' | 'exercises'>) {
  return (
    !isTimedBlock(block) &&
    (block.blockType === 'superset' || block.blockType === 'circuit') &&
    block.exercises.length > 0
  )
}

// «Superserie» con 2 ejercicios; «Circuito» con 3 o más (o si ya era un circuito).
export function roundBlockLabel(block: Pick<LocalBlock, 'blockType' | 'exercises'>) {
  return block.blockType === 'circuit' || block.exercises.length >= 3 ? 'Circuito' : 'Superserie'
}

// Nº de rondas: las series del ejercicio que más tiene.
export function roundCount(block: Pick<LocalBlock, 'sets' | 'exercises'>) {
  let max = 0
  for (const e of block.exercises) {
    const n = block.sets.filter((s) => s.exerciseId === e.exerciseId).length
    if (n > max) max = n
  }
  return max
}

export function roundSettings(block: LocalBlock) {
  const settings = block.settings?.kind === 'circuit' ? block.settings : null
  const last = block.exercises.at(-1)
  return {
    rounds: roundCount(block),
    restBetweenExercisesS: settings?.restBetweenExercisesS ?? 0,
    restBetweenRoundsS: last?.restS ?? settings?.restBetweenRoundsS ?? DEFAULT_ROUND_REST_S,
  }
}

export type Round = {
  index: number
  // Una entrada por ejercicio del bloque (en su orden); null si ese ejercicio no la tiene.
  sets: (SetEntry | null)[]
  complete: boolean
}

export function blockRounds(block: LocalBlock): Round[] {
  return Array.from({ length: roundCount(block) }, (_, index) => {
    const sets = block.exercises.map(
      (e) => block.sets.find((s) => s.exerciseId === e.exerciseId && s.setIndex === index) ?? null,
    )
    const present = sets.filter((s): s is SetEntry => s !== null)
    return { index, sets, complete: present.length > 0 && present.every((s) => s.completed) }
  })
}

// Primera ronda sin terminar (la que se enseña abierta); -1 si están todas hechas.
export function currentRoundIndex(block: LocalBlock) {
  return blockRounds(block).find((r) => !r.complete)?.index ?? -1
}

// Ajustes guardados en el bloque (las rondas salen de las series; se copian para el servidor).
function withSettings(block: LocalBlock, patch: Partial<CircuitConfig> = {}): LocalBlock {
  if (block.exercises.length < 2) return block
  const current = roundSettings(block)
  const settings: CircuitConfig = {
    kind: 'circuit',
    rounds: roundCount(block),
    restBetweenRoundsS: current.restBetweenRoundsS,
    restBetweenExercisesS: current.restBetweenExercisesS,
    ...patch,
  }
  return { ...block, settings }
}

// Bloque nuevo con N rondas precargadas. 1 ejercicio: series normales (N series).
export function buildRoundBlock(
  input: RoundBlockInput,
  order: number,
  newId: IdFn = defaultId,
): LocalBlock {
  const rounds = clampRounds(input.rounds)
  const multi = input.exercises.length > 1
  const block: LocalBlock = {
    id: newId(),
    order,
    blockType: multi ? 'superset' : 'straight',
    exercises: input.exercises.map((e, i) => ({
      exerciseId: e.exercise.id,
      restS: multi
        ? i === input.exercises.length - 1
          ? Math.max(0, input.restBetweenRoundsS)
          : e.exercise.defaultRestS
        : Math.max(0, input.restBetweenRoundsS),
      ...(e.perSide ? { perSide: true } : {}),
    })),
    sets: input.exercises.flatMap((e) =>
      Array.from({ length: rounds }, (_, r) => pendingSet(e.exercise.id, r, newId(), e.target)),
    ),
  }
  return multi
    ? withSettings(block, {
        rounds,
        restBetweenRoundsS: Math.max(0, input.restBetweenRoundsS),
        restBetweenExercisesS: Math.max(0, input.restBetweenExercisesS),
      })
    : block
}

export function addRoundBlock(
  session: LocalSession,
  input: RoundBlockInput,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  if (input.exercises.length === 0) return session
  const block = buildRoundBlock(input, session.blocks.length, newId)
  return bump({ ...session, blocks: [...session.blocks, block] }, now)
}

// «+1 ronda»: copia los valores de la última serie de cada ejercicio.
export function addRound(
  session: LocalSession,
  blockId: string,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const n = roundCount(b)
      if (n >= MAX_ROUNDS) return b
      const added = b.exercises.map((e) => {
        const last = b.sets.filter((s) => s.exerciseId === e.exerciseId).at(-1)
        return pendingSet(e.exerciseId, n, newId(), last ? valuesOf(last) : {})
      })
      return withSettings({ ...b, sets: [...b.sets, ...added] }, { rounds: n + 1 })
    },
    now,
  )
}

// «Quitar ronda»: la última (deja al menos una).
export function removeRound(session: LocalSession, blockId: string, now: number): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const n = roundCount(b)
      if (n <= 1) return b
      return withSettings(
        { ...b, sets: b.sets.filter((s) => s.setIndex < n - 1) },
        { rounds: n - 1 },
      )
    },
    now,
  )
}

// ¿Tiene series hechas la última ronda? (para pedir confirmación antes de quitarla).
export function lastRoundHasDone(block: LocalBlock) {
  const n = roundCount(block)
  return block.sets.some((s) => s.setIndex === n - 1 && s.completed)
}

// «✓ Ronda»: completa las series pendientes de la ronda, ejercicio a ejercicio (así la siguiente
// ronda hereda los valores y, al cerrarla, arranca el descanso entre rondas).
export function completeRound(
  session: LocalSession,
  blockId: string,
  roundIndex: number,
  now: number,
): LocalSession {
  const block = session.blocks.find((b) => b.id === blockId)
  if (!block) return session
  const pending = block.exercises.flatMap((e) =>
    block.sets.filter(
      (s) => s.exerciseId === e.exerciseId && s.setIndex === roundIndex && !s.completed,
    ),
  )
  let next = session
  for (const set of pending) next = toggleSetComplete(next, set.id, now)
  return next
}

// Desmarca una ronda entera.
export function uncompleteRound(
  session: LocalSession,
  blockId: string,
  roundIndex: number,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => ({
      ...b,
      sets: b.sets.map((s) =>
        s.setIndex === roundIndex && s.completed
          ? { ...s, completed: false, completedAt: null }
          : s,
      ),
    }),
    now,
  )
}

// Rondas siguientes (pendientes) del mismo ejercicio que tienen algún valor distinto.
export function followingDiffer(session: Pick<LocalSession, 'blocks'>, setId: string) {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  const set = block?.sets.find((s) => s.id === setId)
  if (!block || !set) return 0
  return block.sets.filter(
    (s) =>
      s.exerciseId === set.exerciseId &&
      s.setIndex > set.setIndex &&
      !s.completed &&
      VALUE_FIELDS.some((f) => s[f] !== set[f]),
  ).length
}

// «Aplicar a las rondas siguientes»: copia los valores de la serie a las pendientes posteriores
// del mismo ejercicio en el bloque.
export function applyToFollowingRounds(
  session: LocalSession,
  setId: string,
  now: number,
): LocalSession {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  const set = block?.sets.find((s) => s.id === setId)
  if (!block || !set) return session
  const values = valuesOf(set)
  return mapBlock(
    session,
    block.id,
    (b) => ({
      ...b,
      sets: b.sets.map((s) =>
        s.exerciseId === set.exerciseId && s.setIndex > set.setIndex && !s.completed
          ? { ...s, ...(values as SetPatch) }
          : s,
      ),
    }),
    now,
  )
}

// Copia de un bloque sin hacer: ids nuevos, series pendientes con los mismos valores. En los
// bloques de series, si `onlyDone` y se hizo alguna serie de un ejercicio, solo esas (lo que se
// hizo, como en «Repetir»). Los bloques con temporizador empiezan de cero.
export function cloneBlock(
  source: LocalBlock,
  order: number,
  newId: IdFn = defaultId,
  onlyDone = false,
): LocalBlock {
  if (isTimedBlock(source)) {
    return resetTimedBlock({ ...source, id: newId(), order }, newId)
  }
  const sets = source.exercises.flatMap((e) => {
    const own = source.sets
      .filter((s) => s.exerciseId === e.exerciseId)
      .sort((a, b) => a.setIndex - b.setIndex)
    const done = own.filter((s) => s.completed)
    return (onlyDone && done.length > 0 ? done : own).map((s, i) => ({
      ...s,
      id: newId(),
      setIndex: i,
      rir: null,
      completed: false,
      completedAt: null,
    }))
  })
  const copy: LocalBlock = {
    id: newId(),
    order,
    blockType: source.blockType,
    exercises: source.exercises.map(({ suggestion: _s, ...e }) => ({ ...e })),
    sets,
    ...(source.settings ? { settings: { ...source.settings } } : {}),
  }
  return isRoundBlock(copy) && copy.exercises.length > 1 ? withSettings(copy) : copy
}

// «Duplicar bloque»: la copia va justo después.
export function duplicateBlock(
  session: LocalSession,
  blockId: string,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  const index = session.blocks.findIndex((b) => b.id === blockId)
  const source = session.blocks[index]
  if (!source) return session
  const blocks = [...session.blocks]
  blocks.splice(index + 1, 0, cloneBlock(source, index + 1, newId))
  return bump({ ...session, blocks: reindex(blocks) }, now)
}

// «Copiar bloque de otra sesión»: se añade al final con sus ejercicios, valores y rondas.
export function copyBlockFrom(
  session: LocalSession,
  source: LocalBlock,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  if (source.exercises.length === 0) return session
  const block = cloneBlock(source, session.blocks.length, newId, true)
  return bump({ ...session, blocks: [...session.blocks, block] }, now)
}

// Valores de partida del editor: los de la primera ronda pendiente (o la última).
export function roundTargets(block: LocalBlock): Map<string, RoundTarget> {
  const rounds = blockRounds(block)
  const ref = rounds.find((r) => !r.complete) ?? rounds.at(-1)
  return new Map(
    block.exercises.map((e, i) => {
      const set =
        ref?.sets[i] ?? block.sets.filter((s) => s.exerciseId === e.exerciseId).at(-1) ?? null
      return [e.exerciseId, set ? valuesOf(set) : {}]
    }),
  )
}

// Editar el bloque: ejercicios (añadir, quitar, ordenar), objetivo de cada uno (se aplica a las
// series pendientes), «cada lado», nº de rondas y descansos. Lo ya hecho no se toca.
export function updateRoundBlock(
  session: LocalSession,
  blockId: string,
  input: RoundBlockInput,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  if (input.exercises.length === 0) return session
  return mapBlock(
    session,
    blockId,
    (b) => {
      const rounds = clampRounds(input.rounds)
      const multi = input.exercises.length > 1
      const sets = input.exercises.flatMap((e) => {
        const id = e.exercise.id
        const own = b.sets
          .filter((s) => s.exerciseId === id)
          .sort((x, y) => x.setIndex - y.setIndex)
        const out: SetEntry[] = []
        // Las hechas se conservan aunque queden más allá de las rondas pedidas.
        for (let r = 0; r < Math.max(rounds, own.length); r++) {
          const existing = own[r]
          if (existing?.completed) out.push(existing)
          else if (r < rounds)
            out.push(
              existing
                ? { ...existing, ...(e.target as SetPatch) }
                : pendingSet(id, r, newId(), e.target),
            )
        }
        return out.map((s, i) => (s.setIndex === i ? s : { ...s, setIndex: i }))
      })
      const exercises = input.exercises.map((e, i) => {
        const previous = b.exercises.find((x) => x.exerciseId === e.exercise.id)
        const isLast = i === input.exercises.length - 1
        return {
          ...(previous ?? {}),
          exerciseId: e.exercise.id,
          restS:
            isLast || !multi
              ? Math.max(0, input.restBetweenRoundsS)
              : (previous?.restS ?? e.exercise.defaultRestS),
          perSide: e.perSide ? true : undefined,
        }
      })
      const blockType: LocalBlock['blockType'] = multi
        ? b.blockType === 'circuit'
          ? 'circuit'
          : 'superset'
        : 'straight'
      const next: LocalBlock = { ...b, blockType, exercises, sets, settings: null }
      return multi
        ? withSettings(next, {
            rounds: roundCount(next),
            restBetweenRoundsS: Math.max(0, input.restBetweenRoundsS),
            restBetweenExercisesS: Math.max(0, input.restBetweenExercisesS),
          })
        : next
    },
    now,
  )
}

// «Cada lado» de un ejercicio del bloque (menú ⋮).
export function togglePerSide(
  session: LocalSession,
  blockId: string,
  exerciseId: string,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => ({
      ...b,
      exercises: b.exercises.map((e) =>
        e.exerciseId === exerciseId ? { ...e, perSide: e.perSide ? undefined : true } : e,
      ),
    }),
    now,
  )
}
