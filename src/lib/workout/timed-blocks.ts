// Bloques con temporizador (EMOM, AMRAP, Tabata, For Time, intervalos, cronómetro) y circuitos.
// Funciones puras sobre la sesión local, como session-ops.
import {
  addTime,
  buildSchedule,
  createTimerState,
  endCurrentPhase,
  finishTimer,
  startTimer,
  timerView,
  togglePause,
  workElapsedMs,
  type Phase,
  type TimerConfig,
} from './timer'
import type {
  BlockExercise,
  BlockResult,
  CircuitConfig,
  Exercise,
  LastPerformance,
  LocalBlock,
  LocalSession,
  SetEntry,
} from './types'

type IdFn = () => string
const defaultId: IdFn = () => crypto.randomUUID()

const TIMER_KINDS = new Set(['emom', 'amrap', 'tabata', 'for_time', 'intervals', 'free'])

export function isTimedBlock(
  block: Pick<LocalBlock, 'settings'>,
): block is LocalBlock & { settings: TimerConfig } {
  return Boolean(block.settings && TIMER_KINDS.has(block.settings.kind))
}

export function blockSchedule(block: LocalBlock): Phase[] {
  return isTimedBlock(block) ? buildSchedule(block.settings) : []
}

function bump(session: LocalSession, now: number): LocalSession {
  return { ...session, rev: Math.max(session.rev + 1, now) }
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

function newSet(exerciseId: string, setIndex: number, id: string, patch: Partial<SetEntry> = {}): SetEntry {
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
    ...patch,
  }
}

export type TimedExerciseInput = {
  exercise: Pick<Exercise, 'id' | 'defaultRestS'>
  targetReps: number | null
  // Peso de la última vez (precarga) si lo hay.
  weightKg?: number | null
}

function initialResult(config: TimerConfig): BlockResult {
  switch (config.kind) {
    case 'emom':
      return { kind: 'emom', minutes: config.minutes, minutesCompleted: 0 }
    case 'amrap':
      return { kind: 'amrap', durationS: config.durationS, rounds: 0, extraReps: 0 }
    case 'tabata':
      return { kind: 'tabata', rounds: config.rounds, roundsCompleted: 0 }
    case 'for_time':
      return { kind: 'for_time', timeS: null, capped: false }
    case 'intervals':
      return { kind: 'intervals', splits: [] }
    case 'free':
      return { kind: 'free', elapsedS: 0 }
  }
}

function initialSets(config: TimerConfig, inputs: TimedExerciseInput[], newId: IdFn): SetEntry[] {
  const counters = new Map<string, number>()
  const make = (input: TimedExerciseInput, patch: Partial<SetEntry> = {}) => {
    const index = counters.get(input.exercise.id) ?? 0
    counters.set(input.exercise.id, index + 1)
    return newSet(input.exercise.id, index, newId(), {
      reps: input.targetReps,
      weightKg: input.weightKg ?? null,
      ...patch,
    })
  }
  if (inputs.length === 0) return []
  switch (config.kind) {
    case 'emom':
      // Minuto i → ejercicio i % n (rotación).
      return Array.from({ length: config.minutes }, (_, i) => make(inputs[i % inputs.length]!))
    case 'tabata':
      return Array.from({ length: config.rounds }, (_, i) =>
        make(inputs[i % inputs.length]!, { reps: null }),
      )
    case 'for_time':
      return inputs.map((input) => make(input))
    case 'intervals':
      return Array.from({ length: config.reps }, () =>
        make(inputs[0]!, {
          reps: null,
          distanceM: config.workDistanceM,
          durationS: config.workDistanceM ? null : config.workS,
        }),
      )
    case 'free':
      return [make(inputs[0]!, { reps: null })]
    case 'amrap':
      // Las series se generan al terminar, una por ejercicio y ronda completada.
      return []
  }
}

export function addTimedBlock(
  session: LocalSession,
  config: TimerConfig,
  inputs: TimedExerciseInput[],
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  const exercises: BlockExercise[] = inputs.map((i) => ({
    exerciseId: i.exercise.id,
    restS: 0,
    targetReps: i.targetReps,
  }))
  const block: LocalBlock = {
    id: newId(),
    order: session.blocks.length,
    blockType: config.kind,
    exercises,
    sets: initialSets(config, inputs, newId),
    settings: config,
    result: initialResult(config),
    timer: createTimerState(),
  }
  return bump({ ...session, blocks: [...session.blocks, block] }, now)
}

// Circuito: rondas × ejercicios; descanso solo al acabar cada ronda (como una superserie).
export function addCircuitBlock(
  session: LocalSession,
  config: CircuitConfig,
  inputs: { exercise: Pick<Exercise, 'id' | 'defaultRestS'>; last: LastPerformance | null | undefined }[],
  now: number,
  newId: IdFn = defaultId,
): LocalSession {
  const exercises: BlockExercise[] = inputs.map((input, i) => ({
    exerciseId: input.exercise.id,
    restS: i === inputs.length - 1 ? config.restBetweenRoundsS : 0,
  }))
  const sets = inputs.flatMap(({ exercise, last }) => {
    const template = last?.sets.filter((s) => !s.isWarmup) ?? []
    return Array.from({ length: config.rounds }, (_, r) => {
      const t = template[Math.min(r, template.length - 1)]
      return newSet(exercise.id, r, newId(), {
        weightKg: t?.weightKg ?? null,
        reps: t?.reps ?? null,
        durationS: t?.durationS ?? null,
        distanceM: t?.distanceM ?? null,
        calories: t?.calories ?? null,
      })
    })
  })
  const block: LocalBlock = {
    id: newId(),
    order: session.blocks.length,
    blockType: 'circuit',
    exercises,
    sets,
    settings: config,
    result: null,
  }
  return bump({ ...session, blocks: [...session.blocks, block] }, now)
}

// ── Control del temporizador ────────────────────────────────

export type TimerAction =
  | 'start'
  | 'start-now'
  | 'toggle-pause'
  | 'add-15'
  | 'sub-15'
  | 'skip'
  | 'finish'

export function applyTimerAction(
  session: LocalSession,
  blockId: string,
  action: TimerAction,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (block) => {
      if (!isTimedBlock(block)) return block
      const schedule = buildSchedule(block.settings)
      const timer = block.timer ?? createTimerState()
      switch (action) {
        case 'start':
          return { ...block, timer: startTimer(timer, now) }
        case 'start-now':
          return { ...block, timer: startTimer(timer, now, true) }
        case 'toggle-pause':
          return { ...block, timer: togglePause(timer, now) }
        case 'add-15':
          return { ...block, timer: addTime(schedule, timer, 15_000, now) }
        case 'sub-15':
          return { ...block, timer: addTime(schedule, timer, -15_000, now) }
        case 'skip': {
          const ended = endCurrentPhase(schedule, timer, now)
          let next: LocalBlock = { ...block, timer: ended.state }
          // Intervalos por distancia: cerrar la fase de trabajo es «vuelta hecha».
          if (block.settings.kind === 'intervals' && ended.phase?.kind === 'work') {
            next = recordIntervalSplit(next, ended.phase.round, ended.durationMs, now)
          }
          return ended.state.finishedAt !== null ? finalizeTimedBlock(next, now) : next
        }
        case 'finish':
          return finalizeTimedBlock({ ...block, timer: finishTimer(timer, now) }, now)
      }
    },
    now,
  )
}

function recordIntervalSplit(block: LocalBlock, round: number, durationMs: number, now: number): LocalBlock {
  if (block.settings?.kind !== 'intervals') return block
  const durationS = Math.round(durationMs / 1000)
  const distanceM = block.settings.workDistanceM
  const splits = block.result?.kind === 'intervals' ? [...block.result.splits] : []
  splits[round - 1] = { distanceM, durationS }
  return {
    ...block,
    result: { kind: 'intervals', splits },
    sets: block.sets.map((s) =>
      s.setIndex === round - 1
        ? { ...s, durationS, distanceM: s.distanceM ?? distanceM, completed: true, completedAt: new Date(now).toISOString() }
        : s,
    ),
  }
}

// AMRAP: +1 ronda / reps sueltas.
export function amrapAdd(
  session: LocalSession,
  blockId: string,
  field: 'rounds' | 'extraReps',
  delta: number,
  now: number,
): LocalSession {
  return mapBlock(
    session,
    blockId,
    (block) => {
      if (block.result?.kind !== 'amrap') return block
      const value = Math.max(0, block.result[field] + delta)
      return { ...block, result: { ...block.result, [field]: value } }
    },
    now,
  )
}

// Al terminar (a mano o porque se acaba el tiempo): resultado y series hechas.
export function finalizeTimedBlock(block: LocalBlock, now: number): LocalBlock {
  if (!isTimedBlock(block) || !block.timer) return block
  const config = block.settings
  const schedule = buildSchedule(config)
  const timer = block.timer.finishedAt === null ? finishTimer(block.timer, now) : block.timer
  const view = timerView(schedule, timer, now)
  const doneAt = new Date(timer.finishedAt ?? now).toISOString()
  const workS = Math.round(workElapsedMs(schedule, timer, now) / 1000)
  const complete = (s: SetEntry): SetEntry =>
    s.completed ? s : { ...s, completed: true, completedAt: doneAt }

  switch (config.kind) {
    case 'emom': {
      const minutesCompleted = view.completedWorkPhases
      return {
        ...block,
        timer,
        result: { kind: 'emom', minutes: config.minutes, minutesCompleted },
        sets: block.sets.map((s, i) => (i < minutesCompleted ? complete(s) : s)),
      }
    }
    case 'tabata': {
      const roundsCompleted = view.completedWorkPhases
      return {
        ...block,
        timer,
        result: { kind: 'tabata', rounds: config.rounds, roundsCompleted },
        sets: block.sets.map((s, i) => (i < roundsCompleted ? complete(s) : s)),
      }
    }
    case 'amrap': {
      const rounds = block.result?.kind === 'amrap' ? block.result.rounds : 0
      const extraReps = block.result?.kind === 'amrap' ? block.result.extraReps : 0
      const sets = block.exercises.flatMap((e) =>
        Array.from({ length: rounds }, (_, r) =>
          newSet(e.exerciseId, r, defaultId(), {
            reps: e.targetReps ?? null,
            completed: true,
            completedAt: doneAt,
          }),
        ),
      )
      // Se conservan pesos ya anotados en series anteriores del bloque.
      const previous = new Map(block.sets.map((s) => [`${s.exerciseId}:${s.setIndex}`, s]))
      return {
        ...block,
        timer,
        result: { kind: 'amrap', durationS: config.durationS, rounds, extraReps },
        sets: sets.map((s) => {
          const p = previous.get(`${s.exerciseId}:${s.setIndex}`)
          return p ? { ...s, id: p.id, weightKg: p.weightKg } : s
        }),
      }
    }
    case 'for_time': {
      const capped = config.capS !== null && workS >= config.capS
      return {
        ...block,
        timer,
        result: { kind: 'for_time', timeS: workS, capped },
        sets: block.sets.map(complete),
      }
    }
    case 'intervals': {
      // Por tiempo: cada fase de trabajo terminada es una repetición hecha.
      if (config.workDistanceM) return { ...block, timer }
      const repsDone = view.completedWorkPhases
      const splits = Array.from({ length: repsDone }, () => ({
        distanceM: null,
        durationS: config.workS ?? 0,
      }))
      return {
        ...block,
        timer,
        result: { kind: 'intervals', splits },
        sets: block.sets.map((s, i) =>
          i < repsDone ? complete({ ...s, durationS: s.durationS ?? config.workS }) : s,
        ),
      }
    }
    case 'free':
      return {
        ...block,
        timer,
        result: { kind: 'free', elapsedS: workS },
        sets: block.sets.map((s, i) =>
          i === 0 ? complete({ ...s, durationS: s.durationS ?? workS }) : s,
        ),
      }
  }
}

// Si el tiempo se acabó mientras la app estaba cerrada o en segundo plano, se cierra el bloque.
export function settleFinishedTimers(session: LocalSession, now: number): LocalSession {
  let next = session
  for (const block of session.blocks) {
    if (!isTimedBlock(block) || !block.timer || block.timer.finishedAt !== null) continue
    if (block.timer.startedAt === null) continue
    const schedule = buildSchedule(block.settings)
    const view = timerView(schedule, block.timer, now)
    if (view.status !== 'done') continue
    // Se cierra en el instante exacto en que terminó, no en el de volver a la app.
    const endAt = block.timer.startedAt + block.timer.pausedMs + view.totalMs
    next = mapBlock(next, block.id, (b) => finalizeTimedBlock({ ...b, timer: finishTimer(b.timer!, endAt) }, endAt), now)
  }
  return next
}

export function removeBlock(session: LocalSession, blockId: string, now: number): LocalSession {
  const blocks = session.blocks.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, order: i }))
  return bump({ ...session, blocks }, now)
}

export function runningTimedBlock(session: Pick<LocalSession, 'blocks'>) {
  return session.blocks.find(
    (b) => isTimedBlock(b) && b.timer?.startedAt != null && b.timer.finishedAt === null,
  )
}
