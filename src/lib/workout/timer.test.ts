import { describe, expect, it } from 'vitest'
import {
  PREP_MS,
  addTime,
  buildSchedule,
  createTimerState,
  endCurrentPhase,
  finishTimer,
  pauseTimer,
  resumeTimer,
  secondsLeftInPhase,
  startTimer,
  timerView,
  workElapsedMs,
  type TimerConfig,
} from './timer'

const T0 = 1_000_000
const S = 1000
const MIN = 60 * S

const emom12: TimerConfig = { kind: 'emom', minutes: 12, intervalS: 60 }

describe('buildSchedule', () => {
  it('EMOM: preparación + un minuto por ronda', () => {
    const s = buildSchedule(emom12)
    expect(s).toHaveLength(13)
    expect(s[0]).toEqual({ kind: 'prep', durationMs: PREP_MS, round: 0 })
    expect(s[12]).toEqual({ kind: 'work', durationMs: MIN, round: 12 })
  })

  it('Tabata por defecto 20/10 × 8 (sin descanso tras la última ronda)', () => {
    const s = buildSchedule({ kind: 'tabata', workS: 20, restS: 10, rounds: 8 })
    expect(s.filter((p) => p.kind === 'work')).toHaveLength(8)
    expect(s.filter((p) => p.kind === 'rest')).toHaveLength(7)
    expect(s.reduce((a, p) => a + p.durationMs, 0)).toBe(PREP_MS + (8 * 20 + 7 * 10) * S)
  })

  it('Intervalos por distancia: trabajo abierto y recuperación fija', () => {
    const s = buildSchedule({
      kind: 'intervals',
      reps: 6,
      workDistanceM: 400,
      workS: null,
      recoveryS: 90,
    })
    expect(s).toHaveLength(1 + 6 + 5)
    expect(s[1]?.durationMs).toBe(Number.POSITIVE_INFINITY)
    expect(s[2]).toEqual({ kind: 'rest', durationMs: 90 * S, round: 1 })
  })

  it('For Time sin cap es abierto', () => {
    expect(buildSchedule({ kind: 'for_time', capS: null })[1]?.durationMs).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('timerView', () => {
  const schedule = buildSchedule(emom12)

  it('sin empezar está parado', () => {
    const v = timerView(schedule, createTimerState(), T0)
    expect(v.status).toBe('idle')
    expect(v.elapsedMs).toBe(0)
  })

  it('calcula la fase y el tiempo restante a partir del inicio', () => {
    const state = startTimer(createTimerState(), T0)
    const v = timerView(schedule, state, T0 + PREP_MS + 3 * MIN + 45 * S)
    expect(v.status).toBe('running')
    expect(v.phase?.round).toBe(4)
    expect(v.phaseRemainingMs).toBe(15 * S)
    expect(v.completedWorkPhases).toBe(3)
    expect(secondsLeftInPhase(v)).toBe(15)
  })

  it('reanudar desde timestamps: tras 5 min con la pantalla bloqueada, el estado es exacto', () => {
    const state = startTimer(createTimerState(), T0)
    // Estado guardado en IndexedDB; se vuelve a la app mucho después.
    const restored = JSON.parse(JSON.stringify(state))
    const v = timerView(schedule, restored, T0 + PREP_MS + 5 * MIN + 2 * S)
    expect(v.phase?.round).toBe(6)
    expect(v.phaseElapsedMs).toBe(2 * S)
    expect(v.totalRemainingMs).toBe(12 * MIN - 5 * MIN - 2 * S)
  })

  it('al pasarse del total queda terminado aunque nadie lo pare', () => {
    const state = startTimer(createTimerState(), T0)
    const v = timerView(schedule, state, T0 + PREP_MS + 13 * MIN)
    expect(v.status).toBe('done')
    expect(v.completedWorkPhases).toBe(12)
    expect(v.phase).toBeNull()
  })

  it('la pausa congela el tiempo y reanudar descuenta lo pausado', () => {
    let state = startTimer(createTimerState(), T0)
    state = pauseTimer(state, T0 + PREP_MS + 30 * S)
    expect(timerView(schedule, state, T0 + 10 * MIN).phaseElapsedMs).toBe(30 * S)
    expect(timerView(schedule, state, T0 + 10 * MIN).status).toBe('paused')
    state = resumeTimer(state, T0 + 10 * MIN)
    const v = timerView(schedule, state, T0 + 10 * MIN + 10 * S)
    expect(v.status).toBe('running')
    expect(v.phase?.round).toBe(1)
    expect(v.phaseElapsedMs).toBe(40 * S)
  })

  it('la pausa sobrevive a recargar la app', () => {
    const paused = pauseTimer(startTimer(createTimerState(), T0), T0 + 20 * S)
    const restored = JSON.parse(JSON.stringify(paused))
    expect(timerView(schedule, restored, T0 + 999 * MIN).elapsedMs).toBe(20 * S)
  })
})

describe('acciones', () => {
  const schedule = buildSchedule({ kind: 'amrap', durationS: 600 })

  it('empezar sin cuenta atrás salta la preparación', () => {
    const state = startTimer(createTimerState(), T0, true)
    const v = timerView(schedule, state, T0)
    expect(v.phase?.kind).toBe('work')
    expect(v.phaseRemainingMs).toBe(600 * S)
  })

  it('+15 s alarga la fase en curso', () => {
    let state = startTimer(createTimerState(), T0, true)
    state = addTime(schedule, state, 15 * S, T0 + 100 * S)
    expect(timerView(schedule, state, T0 + 100 * S).phaseRemainingMs).toBe(515 * S)
  })

  it('saltar cierra la fase en curso ahora', () => {
    const tabata = buildSchedule({ kind: 'tabata', workS: 20, restS: 10, rounds: 8 })
    let state = startTimer(createTimerState(), T0, true)
    const ended = endCurrentPhase(tabata, state, T0 + 5 * S)
    state = ended.state
    expect(ended.durationMs).toBe(5 * S)
    const v = timerView(tabata, state, T0 + 5 * S)
    expect(v.phase?.kind).toBe('rest')
    expect(v.phaseRemainingMs).toBe(10 * S)
  })

  it('vuelta hecha en intervalos por distancia registra el parcial y pasa a recuperación', () => {
    const intervals = buildSchedule({
      kind: 'intervals',
      reps: 6,
      workDistanceM: 400,
      workS: null,
      recoveryS: 90,
    })
    const state = startTimer(createTimerState(), T0, true)
    const lap = endCurrentPhase(intervals, state, T0 + 95 * S)
    expect(lap.durationMs).toBe(95 * S)
    const v = timerView(intervals, lap.state, T0 + 125 * S)
    expect(v.phase).toMatchObject({ kind: 'rest', round: 1 })
    expect(v.phaseRemainingMs).toBe(60 * S)
  })

  it('terminar fija el tiempo de trabajo (For Time)', () => {
    const forTime = buildSchedule({ kind: 'for_time', capS: 900 })
    let state = startTimer(createTimerState(), T0)
    state = finishTimer(state, T0 + PREP_MS + 7 * MIN + 12 * S)
    expect(workElapsedMs(forTime, state, T0 + 99 * MIN)).toBe(7 * MIN + 12 * S)
    expect(timerView(forTime, state, T0 + 99 * MIN).status).toBe('done')
  })
})
