// Operaciones puras sobre la sesión local. Cada una devuelve una sesión nueva con `rev` actualizado.
import type { WeightSuggestion } from './suggestion'
import { finalizeTimedBlock, isTimedBlock, settleFinishedTimers } from './timed-blocks'
import type {
  BlockExercise,
  Exercise,
  LastPerformance,
  LocalBlock,
  LocalSession,
  SetEntry,
} from './types'

export type IdFn = () => string
const defaultId: IdFn = () => crypto.randomUUID()

const DEFAULT_SETS = 3

function bump(session: LocalSession, now: number): LocalSession {
  return { ...session, rev: Math.max(session.rev + 1, now) }
}

function reindexBlocks(blocks: LocalBlock[]) {
  return blocks.map((b, i) => (b.order === i ? b : { ...b, order: i }))
}

function reindexSets(sets: SetEntry[]) {
  const counters = new Map<string, number>()
  return sets.map((s) => {
    const index = counters.get(s.exerciseId) ?? 0
    counters.set(s.exerciseId, index + 1)
    return s.setIndex === index ? s : { ...s, setIndex: index }
  })
}

function mapBlock(
  session: LocalSession,
  blockId: string,
  fn: (block: LocalBlock) => LocalBlock | null,
  now: number,
): LocalSession {
  const blocks = session.blocks.flatMap((b) => {
    if (b.id !== blockId) return [b]
    const next = fn(b)
    return next ? [next] : []
  })
  return bump({ ...session, blocks: reindexBlocks(blocks) }, now)
}

// Un circuito sigue siéndolo; si no, 1 ejercicio = series normales y varios = superserie.
function groupedType(block: LocalBlock, exerciseCount: number): LocalBlock['blockType'] {
  if (block.blockType === 'circuit') return 'circuit'
  return exerciseCount > 1 ? 'superset' : 'straight'
}

function emptySet(exerciseId: string, setIndex: number, id: string): SetEntry {
  return {
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
}

// Series iniciales precargadas con los valores de la última vez (peso, reps, etc.).
export function prefillSets(
  exerciseId: string,
  last: LastPerformance | null | undefined,
  newId: IdFn = defaultId,
): SetEntry[] {
  if (!last || last.sets.length === 0) {
    return Array.from({ length: DEFAULT_SETS }, (_, i) => emptySet(exerciseId, i, newId()))
  }
  return last.sets.map((s, i) => ({
    ...emptySet(exerciseId, i, newId()),
    isWarmup: s.isWarmup,
    weightKg: s.weightKg,
    reps: s.reps,
    durationS: s.durationS,
    distanceM: s.distanceM,
    calories: s.calories,
  }))
}

export function createSession(
  userId: string,
  now: number,
  newId: IdFn = defaultId,
  title = 'Entreno libre',
  sessionType: LocalSession['sessionType'] = 'strength',
  location: LocalSession['location'] = 'gym',
): LocalSession {
  return {
    id: newId(),
    userId,
    mode: 'live',
    sessionType,
    title,
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    durationMin: null,
    rpe: null,
    avgHr: null,
    maxHr: null,
    calories: null,
    location,
    notes: null,
    distanceM: null,
    blocks: [],
    rest: null,
    rev: now,
  }
}

export function addExerciseBlock(
  session: LocalSession,
  exercise: Pick<Exercise, 'id' | 'defaultRestS'>,
  last: LastPerformance | null | undefined,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  const block: LocalBlock = {
    id: newId(),
    order: session.blocks.length,
    blockType: 'straight',
    exercises: [{ exerciseId: exercise.id, restS: exercise.defaultRestS }],
    sets: prefillSets(exercise.id, last, newId),
  }
  return bump({ ...session, blocks: [...session.blocks, block] }, now)
}

// Añade un ejercicio al bloque y lo convierte en superserie.
export function addToSuperset(
  session: LocalSession,
  blockId: string,
  exercise: Pick<Exercise, 'id' | 'defaultRestS'>,
  last: LastPerformance | null | undefined,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      if (b.exercises.some((e) => e.exerciseId === exercise.id)) return b
      return {
        ...b,
        blockType: 'superset',
        exercises: [...b.exercises, { exerciseId: exercise.id, restS: exercise.defaultRestS }],
        sets: [...b.sets, ...prefillSets(exercise.id, last, newId)],
      }
    },
    now,
  )
}

export function removeExercise(
  session: LocalSession,
  blockId: string,
  exerciseId: string,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const exercises = b.exercises.filter((e) => e.exerciseId !== exerciseId)
      if (exercises.length === 0) return null
      return {
        ...b,
        blockType: groupedType(b, exercises.length),
        exercises,
        sets: b.sets.filter((s) => s.exerciseId !== exerciseId),
      }
    },
    now,
  )
}

// Sustituye un ejercicio. Las series ya completadas se conservan con el ejercicio original;
// las pendientes pasan al nuevo, precargadas con su última vez.
export function substituteExercise(
  session: LocalSession,
  blockId: string,
  oldExerciseId: string,
  exercise: Pick<Exercise, 'id' | 'defaultRestS'>,
  last: LastPerformance | null | undefined,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const oldSets = b.sets.filter((s) => s.exerciseId === oldExerciseId)
      const done = oldSets.filter((s) => s.completed)
      const pendingCount = Math.max(1, oldSets.length - done.length)
      const prefilled = prefillSets(exercise.id, last, newId)
      const newSets = Array.from({ length: pendingCount }, (_, i) => {
        const template = prefilled[Math.min(i, prefilled.length - 1)]
        return { ...(template ?? emptySet(exercise.id, i, '')), id: newId(), setIndex: i }
      })

      const replacement: BlockExercise = { exerciseId: exercise.id, restS: exercise.defaultRestS }
      const exercises = b.exercises.flatMap((e) => {
        if (e.exerciseId !== oldExerciseId) return [e]
        return done.length > 0 ? [e, replacement] : [replacement]
      })
      const sets = [
        ...b.sets.filter((s) => s.exerciseId !== oldExerciseId || s.completed),
        ...newSets,
      ]
      return {
        ...b,
        blockType: groupedType(b, exercises.length),
        exercises,
        sets: reindexSets(sets),
      }
    },
    now,
  )
}

export function moveBlock(
  session: LocalSession,
  blockId: string,
  direction: -1 | 1,
  now: number,
): LocalSession {
  const index = session.blocks.findIndex((b) => b.id === blockId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= session.blocks.length) return session
  const blocks = [...session.blocks]
  const [moved] = blocks.splice(index, 1)
  if (!moved) return session
  blocks.splice(target, 0, moved)
  return bump({ ...session, blocks: reindexBlocks(blocks) }, now)
}

// Nueva serie al final del ejercicio, copiando los valores de la última.
export function addSet(
  session: LocalSession,
  blockId: string,
  exerciseId: string,
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const own = b.sets.filter((s) => s.exerciseId === exerciseId)
      const lastSet = own[own.length - 1]
      const set: SetEntry = {
        ...(lastSet ?? emptySet(exerciseId, 0, '')),
        id: newId(),
        setIndex: own.length,
        isWarmup: false,
        rir: null,
        completed: false,
        completedAt: null,
      }
      return { ...b, sets: [...b.sets, set] }
    },
    now,
  )
}

export function removeSet(session: LocalSession, setId: string, now: number): LocalSession {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  if (!block) return session
  return mapBlock(
    session,
    block.id,
    (b) => ({ ...b, sets: reindexSets(b.sets.filter((s) => s.id !== setId)) }),
    now,
  )
}

export type SetPatch = Partial<
  Pick<SetEntry, 'weightKg' | 'reps' | 'rir' | 'durationS' | 'distanceM' | 'calories' | 'isWarmup'>
>

export function updateSet(
  session: LocalSession,
  setId: string,
  patch: SetPatch,
  now: number,
): LocalSession {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  if (!block) return session
  return mapBlock(
    session,
    block.id,
    (b) => ({ ...b, sets: b.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }),
    now,
  )
}

// Si una serie cambia de peso/reps, las siguientes pendientes del mismo ejercicio que tenían
// los mismos valores heredan el cambio (así no hay que ajustar cada serie).
export function updateSetAndFollowing(
  session: LocalSession,
  setId: string,
  patch: SetPatch,
  now: number,
): LocalSession {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  const set = block?.sets.find((s) => s.id === setId)
  if (!block || !set) return session
  const keys = Object.keys(patch) as (keyof SetPatch)[]
  return mapBlock(
    session,
    block.id,
    (b) => ({
      ...b,
      sets: b.sets.map((s) => {
        if (s.id === setId) return { ...s, ...patch }
        const follows =
          s.exerciseId === set.exerciseId &&
          s.setIndex > set.setIndex &&
          !s.completed &&
          !s.isWarmup &&
          !set.isWarmup &&
          keys.every((k) => k !== 'isWarmup' && s[k] === set[k])
        return follows ? { ...s, ...patch } : s
      }),
    }),
    now,
  )
}

export function toggleWarmup(session: LocalSession, setId: string, now: number) {
  const set = session.blocks.flatMap((b) => b.sets).find((s) => s.id === setId)
  return set ? updateSet(session, setId, { isWarmup: !set.isWarmup }, now) : session
}

// Marca/desmarca una serie. Al completarla arranca el descanso si toca:
// en superseries, solo al terminar la ronda (último ejercicio del bloque).
export function toggleSetComplete(session: LocalSession, setId: string, now: number) {
  const block = session.blocks.find((b) => b.sets.some((s) => s.id === setId))
  const set = block?.sets.find((s) => s.id === setId)
  if (!block || !set) return session

  const completed = !set.completed
  let next = mapBlock(
    session,
    block.id,
    (b) => ({
      ...b,
      sets: b.sets.map((s) =>
        s.id === setId
          ? { ...s, completed, completedAt: completed ? new Date(now).toISOString() : null }
          : s,
      ),
    }),
    now,
  )

  if (completed && session.mode === 'live' && !isTimedBlock(block)) {
    const lastExercise = block.exercises[block.exercises.length - 1]
    const startsRest = block.exercises.length === 1 || lastExercise?.exerciseId === set.exerciseId
    const restS = block.exercises.find((e) => e.exerciseId === set.exerciseId)?.restS ?? 90
    if (startsRest && restS > 0) {
      next = {
        ...next,
        rest: {
          startedAt: now,
          endsAt: now + restS * 1000,
          exerciseId: set.exerciseId,
          pausedRemainingMs: null,
        },
      }
    }
  }
  return next
}

export function nextPendingSetId(session: Pick<LocalSession, 'blocks'>) {
  for (const block of session.blocks) {
    // Los bloques con temporizador se registran con sus propios controles.
    if (isTimedBlock(block)) continue
    // En superseries se alterna: primera serie pendiente por índice y luego por ejercicio.
    const pending = block.sets
      .filter((s) => !s.completed)
      .sort(
        (a, b) =>
          a.setIndex - b.setIndex ||
          block.exercises.findIndex((e) => e.exerciseId === a.exerciseId) -
            block.exercises.findIndex((e) => e.exerciseId === b.exerciseId),
      )
    if (pending[0]) return pending[0].id
  }
  return null
}

// ── Descanso ────────────────────────────────────────────────

export function restRemainingMs(rest: LocalSession['rest'], now: number) {
  if (!rest) return 0
  if (rest.pausedRemainingMs !== null) return rest.pausedRemainingMs
  return Math.max(0, rest.endsAt - now)
}

// ±15 s sobre el descanso en curso; también ajusta el descanso de ese ejercicio en el bloque.
export function adjustRest(session: LocalSession, deltaS: number, now: number): LocalSession {
  const rest = session.rest
  if (!rest) return session
  const remaining = restRemainingMs(rest, now) + deltaS * 1000
  const newRest =
    rest.pausedRemainingMs !== null
      ? { ...rest, pausedRemainingMs: Math.max(0, remaining) }
      : { ...rest, endsAt: now + Math.max(0, remaining) }
  const blocks = session.blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e) =>
      e.exerciseId === rest.exerciseId
        ? { ...e, restS: Math.min(600, Math.max(0, e.restS + deltaS)) }
        : e,
    ),
  }))
  return bump({ ...session, blocks, rest: newRest }, now)
}

export function toggleRestPause(session: LocalSession, now: number): LocalSession {
  const rest = session.rest
  if (!rest) return session
  const newRest =
    rest.pausedRemainingMs === null
      ? { ...rest, pausedRemainingMs: restRemainingMs(rest, now) }
      : { ...rest, endsAt: now + rest.pausedRemainingMs, pausedRemainingMs: null }
  return { ...session, rest: newRest }
}

export function clearRest(session: LocalSession): LocalSession {
  return session.rest ? { ...session, rest: null } : session
}

// ── Cabecera y fin ──────────────────────────────────────────

export type SessionDetailsPatch = Partial<
  Pick<
    LocalSession,
    'title' | 'rpe' | 'durationMin' | 'avgHr' | 'maxHr' | 'calories' | 'notes' | 'location'
  >
>

export function updateDetails(
  session: LocalSession,
  patch: SessionDetailsPatch,
  now: number,
): LocalSession {
  return bump({ ...session, ...patch }, now)
}

// Distancia total de la sesión: suma de las series completadas con distancia.
export function totalDistanceM(session: Pick<LocalSession, 'blocks'>) {
  const total = session.blocks
    .flatMap((b) => b.sets)
    .reduce((acc, s) => (s.completed && s.distanceM ? acc + s.distanceM : acc), 0)
  return total > 0 ? total : null
}

export function finishSession(
  session: LocalSession,
  details: SessionDetailsPatch,
  now: number,
): LocalSession {
  const endedAt = session.endedAt ?? new Date(now).toISOString()
  // Cierra cualquier temporizador que siguiera corriendo.
  const settled = {
    ...settleFinishedTimers(session, now),
  }
  const blocks = settled.blocks.map((b) =>
    isTimedBlock(b) && b.timer?.startedAt != null && b.timer.finishedAt === null
      ? finalizeTimedBlock(b, now)
      : b,
  )
  const closed = { ...settled, blocks }
  return bump(
    { ...closed, ...details, distanceM: totalDistanceM(closed), endedAt, rest: null },
    now,
  )
}

// Sugerencia de peso (§10): precarga el peso en las series de trabajo pendientes del ejercicio
// y guarda la sugerencia (con su motivo) en el bloque para mostrarla.
export function applyWeightSuggestion(
  session: LocalSession,
  blockId: string,
  suggestion: WeightSuggestion,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      if (!b.exercises.some((e) => e.exerciseId === suggestion.exerciseId)) return b
      return {
        ...b,
        exercises: b.exercises.map((e) =>
          e.exerciseId === suggestion.exerciseId ? { ...e, suggestion } : e,
        ),
        sets: b.sets.map((s) =>
          s.exerciseId === suggestion.exerciseId && !s.completed && !s.isWarmup
            ? { ...s, weightKg: suggestion.weightKg }
            : s,
        ),
      }
    },
    now,
  )
}

// «Usar el peso de la última vez»: deshace la sugerencia en las series pendientes.
export function revertWeightSuggestion(
  session: LocalSession,
  blockId: string,
  exerciseId: string,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (b) => {
      const suggestion = b.exercises.find((e) => e.exerciseId === exerciseId)?.suggestion
      if (!suggestion || suggestion.reverted) return b
      return {
        ...b,
        exercises: b.exercises.map((e) =>
          e.exerciseId === exerciseId ? { ...e, suggestion: { ...suggestion, reverted: true } } : e,
        ),
        sets: b.sets.map((s) =>
          s.exerciseId === exerciseId &&
          !s.completed &&
          !s.isWarmup &&
          s.weightKg === suggestion.weightKg
            ? { ...s, weightKg: suggestion.previousKg }
            : s,
        ),
      }
    },
    now,
  )
}
