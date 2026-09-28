// Temporizadores de bloque basados en timestamps (CLAUDE.md §8).
//
// El estado solo guarda instantes (inicio, pausa, fin) y ajustes de duración por fase; el
// tiempo transcurrido siempre se calcula como `ahora − inicio − pausas`. Así, si la app se
// cierra, se bloquea la pantalla o se recarga, al volver el estado es el correcto.

export type TimerConfig =
  | { kind: 'emom'; minutes: number; intervalS: number }
  | { kind: 'amrap'; durationS: number }
  | { kind: 'tabata'; workS: number; restS: number; rounds: number }
  | { kind: 'for_time'; capS: number | null }
  | {
      kind: 'intervals'
      reps: number
      // Trabajo por distancia (se cierra con «Vuelta hecha») o por tiempo.
      workDistanceM: number | null
      workS: number | null
      recoveryS: number
    }
  | { kind: 'free' }

export type TimerState = {
  startedAt: number | null
  pausedAt: number | null
  pausedMs: number
  finishedAt: number | null
  // Duración real (ms) de fases ajustadas con +15 s, «saltar» o «vuelta hecha».
  overrides: Record<number, number>
}

export type PhaseKind = 'prep' | 'work' | 'rest'

export type Phase = {
  kind: PhaseKind
  // Duración prevista en ms (Infinity = abierta: cronómetro ascendente).
  durationMs: number
  // Ronda (1..n) a la que pertenece; 0 en la preparación.
  round: number
}

export const PREP_MS = 10_000

export function createTimerState(): TimerState {
  return { startedAt: null, pausedAt: null, pausedMs: 0, finishedAt: null, overrides: {} }
}

// Fases de cada tipo de bloque.
export function buildSchedule(config: TimerConfig): Phase[] {
  const prep: Phase = { kind: 'prep', durationMs: PREP_MS, round: 0 }
  switch (config.kind) {
    case 'emom':
      return [
        prep,
        ...Array.from({ length: config.minutes }, (_, i) => ({
          kind: 'work' as const,
          durationMs: config.intervalS * 1000,
          round: i + 1,
        })),
      ]
    case 'amrap':
      return [prep, { kind: 'work', durationMs: config.durationS * 1000, round: 1 }]
    case 'tabata':
      return [
        prep,
        ...Array.from({ length: config.rounds }, (_, i) => {
          const work: Phase = { kind: 'work', durationMs: config.workS * 1000, round: i + 1 }
          const rest: Phase = { kind: 'rest', durationMs: config.restS * 1000, round: i + 1 }
          return i === config.rounds - 1 ? [work] : [work, rest]
        }).flat(),
      ]
    case 'for_time':
      return [
        prep,
        {
          kind: 'work',
          durationMs: config.capS ? config.capS * 1000 : Number.POSITIVE_INFINITY,
          round: 1,
        },
      ]
    case 'intervals':
      return [
        prep,
        ...Array.from({ length: config.reps }, (_, i) => {
          const work: Phase = {
            kind: 'work',
            durationMs:
              config.workDistanceM || !config.workS
                ? Number.POSITIVE_INFINITY
                : config.workS * 1000,
            round: i + 1,
          }
          const rest: Phase = { kind: 'rest', durationMs: config.recoveryS * 1000, round: i + 1 }
          return i === config.reps - 1 || config.recoveryS <= 0 ? [work] : [work, rest]
        }).flat(),
      ]
    case 'free':
      return [{ kind: 'work', durationMs: Number.POSITIVE_INFINITY, round: 1 }]
  }
}

function phaseDurations(schedule: Phase[], state: TimerState) {
  return schedule.map((p, i) => state.overrides[i] ?? p.durationMs)
}

export function elapsedMs(state: TimerState, now: number) {
  if (state.startedAt === null) return 0
  const end = state.finishedAt ?? state.pausedAt ?? now
  return Math.max(0, end - state.startedAt - state.pausedMs)
}

export type TimerView = {
  status: 'idle' | 'running' | 'paused' | 'done'
  elapsedMs: number
  phaseIndex: number
  phase: Phase | null
  // Tiempo de la fase actual: transcurrido y restante (Infinity si es abierta).
  phaseElapsedMs: number
  phaseRemainingMs: number
  // Duración total prevista (Infinity si hay fases abiertas) y restante.
  totalMs: number
  totalRemainingMs: number
  // Fases de trabajo terminadas por completo.
  completedWorkPhases: number
  totalWorkPhases: number
}

export function timerView(schedule: Phase[], state: TimerState, now: number): TimerView {
  const durations = phaseDurations(schedule, state)
  const totalMs = durations.reduce((a, b) => a + b, 0)
  const elapsed = elapsedMs(state, now)
  const totalWorkPhases = schedule.filter((p) => p.kind === 'work').length

  let acc = 0
  let phaseIndex = schedule.length
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i] ?? 0
    if (elapsed < acc + d) {
      phaseIndex = i
      break
    }
    acc += d
  }
  const finishedBySchedule = phaseIndex >= schedule.length
  const done = state.finishedAt !== null || finishedBySchedule
  const completedWorkPhases = schedule.filter(
    (p, i) => p.kind === 'work' && (i < phaseIndex || (done && finishedBySchedule)),
  ).length

  const currentIndex = Math.min(phaseIndex, schedule.length - 1)
  const phase = done ? null : (schedule[currentIndex] ?? null)
  const phaseDuration = durations[currentIndex] ?? 0
  const phaseElapsed = done ? 0 : elapsed - acc

  return {
    status:
      state.startedAt === null
        ? 'idle'
        : done
          ? 'done'
          : state.pausedAt !== null
            ? 'paused'
            : 'running',
    elapsedMs: elapsed,
    phaseIndex: done ? schedule.length : phaseIndex,
    phase,
    phaseElapsedMs: phaseElapsed,
    phaseRemainingMs: done ? 0 : phaseDuration - phaseElapsed,
    totalMs,
    totalRemainingMs: Math.max(0, totalMs - elapsed),
    completedWorkPhases,
    totalWorkPhases,
  }
}

// Tiempo de trabajo real (sin preparación ni descansos), p. ej. para For Time o el cronómetro.
export function workElapsedMs(schedule: Phase[], state: TimerState, now: number) {
  const durations = phaseDurations(schedule, state)
  let remaining = elapsedMs(state, now)
  let work = 0
  for (let i = 0; i < schedule.length && remaining > 0; i++) {
    const used = Math.min(remaining, durations[i] ?? 0)
    if (schedule[i]?.kind === 'work') work += used
    remaining -= used
  }
  return work
}

// ── Acciones (puras) ────────────────────────────────────────

export function startTimer(state: TimerState, now: number, skipPrep = false): TimerState {
  if (state.startedAt !== null) return state
  // Sin cuenta atrás: se arranca como si la preparación ya hubiera pasado.
  return { ...createTimerState(), startedAt: skipPrep ? now - PREP_MS : now }
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.startedAt === null || state.pausedAt !== null || state.finishedAt !== null) return state
  return { ...state, pausedAt: now }
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.pausedAt === null) return state
  return { ...state, pausedMs: state.pausedMs + (now - state.pausedAt), pausedAt: null }
}

export function togglePause(state: TimerState, now: number) {
  return state.pausedAt === null ? pauseTimer(state, now) : resumeTimer(state, now)
}

// +15 s (o −15 s) a la fase en curso. En una fase abierta no tiene sentido y no hace nada.
export function addTime(
  schedule: Phase[],
  state: TimerState,
  deltaMs: number,
  now: number,
): TimerState {
  const view = timerView(schedule, state, now)
  if (view.status === 'idle' || view.status === 'done' || !view.phase) return state
  const current = state.overrides[view.phaseIndex] ?? view.phase.durationMs
  if (!Number.isFinite(current)) return state
  const next = Math.max(view.phaseElapsedMs + 1000, current + deltaMs)
  return { ...state, overrides: { ...state.overrides, [view.phaseIndex]: next } }
}

// Cierra la fase en curso ahora mismo (saltar, o «vuelta hecha» en intervalos por distancia).
// Devuelve también lo que duró esa fase.
export function endCurrentPhase(schedule: Phase[], state: TimerState, now: number) {
  const view = timerView(schedule, state, now)
  if (view.status === 'idle' || view.status === 'done' || !view.phase) {
    return { state, phaseIndex: -1, phase: null, durationMs: 0 }
  }
  const durationMs = Math.max(0, view.phaseElapsedMs)
  let next: TimerState = {
    ...state,
    overrides: { ...state.overrides, [view.phaseIndex]: durationMs },
  }
  if (view.phaseIndex === schedule.length - 1) next = finishTimer(next, now)
  return { state: next, phaseIndex: view.phaseIndex, phase: view.phase, durationMs }
}

export function finishTimer(state: TimerState, now: number): TimerState {
  if (state.startedAt === null || state.finishedAt !== null) return state
  const resumed = resumeTimer(state, now)
  return { ...resumed, finishedAt: now }
}

export function resetTimer(): TimerState {
  return createTimerState()
}

// Fase cuyo final (o últimos 3 s) toca avisar: devuelve el segundo restante entero.
export function secondsLeftInPhase(view: TimerView) {
  if (!Number.isFinite(view.phaseRemainingMs)) return null
  return Math.ceil(view.phaseRemainingMs / 1000)
}
