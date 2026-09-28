import { describe, expect, it } from 'vitest'
import { finishSession, toggleSetComplete } from './session-ops'
import { createQuickActivity, createSessionOfType } from './session-kinds'
import {
  addCircuitBlock,
  addTimedBlock,
  amrapAdd,
  applyTimerAction,
  runningTimedBlock,
  settleFinishedTimers,
} from './timed-blocks'
import { createSession } from './session-ops'
import { PREP_MS } from './timer'
import { sequentialIds } from './test-helpers'

const T0 = Date.parse('2026-09-28T10:00:00Z')
const S = 1000
const MIN = 60 * S
const swing = { id: 'kettlebell_swing', defaultRestS: 90 }
const burpee = { id: 'burpee', defaultRestS: 60 }
const run = { id: 'run', defaultRestS: 0 }

function base() {
  const id = sequentialIds()
  return { id, s: createSession('u1', T0, id) }
}

describe('EMOM', () => {
  it('rota ejercicios por minuto y marca los minutos hechos al acabar', () => {
    const { id, s } = base()
    let session = addTimedBlock(
      s,
      { kind: 'emom', minutes: 12, intervalS: 60 },
      [
        { exercise: swing, targetReps: 15 },
        { exercise: burpee, targetReps: 10 },
      ],
      T0,
      id,
    )
    const block = session.blocks[0]!
    expect(block.blockType).toBe('emom')
    expect(block.sets.map((x) => x.exerciseId).slice(0, 4)).toEqual([
      'kettlebell_swing',
      'burpee',
      'kettlebell_swing',
      'burpee',
    ])
    expect(block.sets[1]?.reps).toBe(10)

    session = applyTimerAction(session, block.id, 'start', T0)
    expect(runningTimedBlock(session)?.id).toBe(block.id)

    // La app estuvo cerrada: al volver, 13 min después, el bloque se cierra en el momento exacto.
    const back = settleFinishedTimers(session, T0 + PREP_MS + 13 * MIN)
    const done = back.blocks[0]!
    expect(done.result).toEqual({ kind: 'emom', minutes: 12, minutesCompleted: 12 })
    expect(done.sets.every((x) => x.completed)).toBe(true)
    expect(done.timer?.finishedAt).toBe(T0 + PREP_MS + 12 * MIN)
    expect(runningTimedBlock(back)).toBeUndefined()
  })

  it('terminar a mitad cuenta solo los minutos completos', () => {
    const { id, s } = base()
    let session = addTimedBlock(s, { kind: 'emom', minutes: 12, intervalS: 60 }, [{ exercise: swing, targetReps: 15 }], T0, id)
    const blockId = session.blocks[0]!.id
    session = applyTimerAction(session, blockId, 'start', T0)
    session = applyTimerAction(session, blockId, 'finish', T0 + PREP_MS + 4 * MIN + 30 * S)
    const block = session.blocks[0]!
    expect(block.result).toEqual({ kind: 'emom', minutes: 12, minutesCompleted: 4 })
    expect(block.sets.filter((x) => x.completed)).toHaveLength(4)
  })
})

describe('AMRAP', () => {
  it('+1 ronda y reps sueltas; al acabar genera una serie por ejercicio y ronda', () => {
    const { id, s } = base()
    let session = addTimedBlock(
      s,
      { kind: 'amrap', durationS: 600 },
      [
        { exercise: swing, targetReps: 10 },
        { exercise: burpee, targetReps: 5 },
      ],
      T0,
      id,
    )
    const blockId = session.blocks[0]!.id
    session = applyTimerAction(session, blockId, 'start-now', T0)
    for (let i = 0; i < 6; i++) session = amrapAdd(session, blockId, 'rounds', 1, T0 + i * MIN)
    session = amrapAdd(session, blockId, 'extraReps', 7, T0 + 9 * MIN)
    session = amrapAdd(session, blockId, 'rounds', -1, T0 + 9 * MIN)
    session = settleFinishedTimers(session, T0 + 11 * MIN)
    const block = session.blocks[0]!
    expect(block.result).toEqual({ kind: 'amrap', durationS: 600, rounds: 5, extraReps: 7 })
    expect(block.sets).toHaveLength(10)
    expect(block.sets.every((x) => x.completed)).toBe(true)
    expect(block.sets.filter((x) => x.exerciseId === 'burpee').every((x) => x.reps === 5)).toBe(true)
  })
})

describe('Tabata y For Time', () => {
  it('Tabata: rondas completadas', () => {
    const { id, s } = base()
    let session = addTimedBlock(s, { kind: 'tabata', workS: 20, restS: 10, rounds: 8 }, [{ exercise: burpee, targetReps: null }], T0, id)
    const blockId = session.blocks[0]!.id
    session = applyTimerAction(session, blockId, 'start-now', T0)
    session = applyTimerAction(session, blockId, 'finish', T0 + 95 * S)
    expect(session.blocks[0]!.result).toEqual({ kind: 'tabata', rounds: 8, roundsCompleted: 3 })
  })

  it('For Time: tiempo final y cap', () => {
    const { id, s } = base()
    let session = addTimedBlock(s, { kind: 'for_time', capS: 600 }, [{ exercise: burpee, targetReps: 50 }], T0, id)
    const blockId = session.blocks[0]!.id
    session = applyTimerAction(session, blockId, 'start', T0)
    session = applyTimerAction(session, blockId, 'finish', T0 + PREP_MS + 6 * MIN + 41 * S)
    expect(session.blocks[0]!.result).toEqual({ kind: 'for_time', timeS: 401, capped: false })
    expect(session.blocks[0]!.sets[0]).toMatchObject({ reps: 50, completed: true })
  })
})

describe('Intervalos 6×400 m rec. 90 s', () => {
  it('cada «vuelta hecha» guarda el parcial en su serie', () => {
    const { id, s } = base()
    let session = addTimedBlock(
      s,
      { kind: 'intervals', reps: 6, workDistanceM: 400, workS: null, recoveryS: 90 },
      [{ exercise: run, targetReps: null }],
      T0,
      id,
    )
    const blockId = session.blocks[0]!.id
    expect(session.blocks[0]!.sets).toHaveLength(6)
    session = applyTimerAction(session, blockId, 'start-now', T0)
    let t = T0
    for (const split of [92, 94, 95, 93, 96, 90]) {
      t += split * S
      session = applyTimerAction(session, blockId, 'skip', t) // vuelta hecha
      t += 90 * S // recuperación completa
    }
    const block = session.blocks[0]!
    expect(block.sets.map((x) => x.durationS)).toEqual([92, 94, 95, 93, 96, 90])
    expect(block.sets.every((x) => x.completed && x.distanceM === 400)).toBe(true)
    expect(block.timer?.finishedAt).not.toBeNull()
    const finished = finishSession(session, { rpe: 8 }, t)
    expect(finished.distanceM).toBe(2400)
  })

  it('intervalos por tiempo: las repeticiones hechas salen del tiempo transcurrido', () => {
    const { id, s } = base()
    let session = addTimedBlock(
      s,
      { kind: 'intervals', reps: 5, workDistanceM: null, workS: 180, recoveryS: 60 },
      [{ exercise: run, targetReps: null }],
      T0,
      id,
    )
    const blockId = session.blocks[0]!.id
    session = applyTimerAction(session, blockId, 'start-now', T0)
    session = applyTimerAction(session, blockId, 'finish', T0 + (3 * 240 + 100) * S)
    const block = session.blocks[0]!
    expect(block.sets.filter((x) => x.completed).map((x) => x.durationS)).toEqual([180, 180, 180])
  })
})

describe('circuito', () => {
  it('rondas × ejercicios con descanso solo al acabar la ronda', () => {
    const { id, s } = base()
    let session = addCircuitBlock(
      s,
      { kind: 'circuit', rounds: 3, restBetweenRoundsS: 120 },
      [
        { exercise: swing, last: null },
        { exercise: burpee, last: null },
      ],
      T0,
      id,
    )
    const block = session.blocks[0]!
    expect(block.blockType).toBe('circuit')
    expect(block.sets).toHaveLength(6)
    const swingSet = block.sets.find((x) => x.exerciseId === 'kettlebell_swing')!
    session = toggleSetComplete(session, swingSet.id, T0)
    expect(session.rest).toBeNull()
    const burpeeSet = block.sets.find((x) => x.exerciseId === 'burpee')!
    session = toggleSetComplete(session, burpeeSet.id, T0 + 30 * S)
    expect(session.rest?.endsAt).toBe(T0 + 30 * S + 120 * S)
  })
})

describe('tipos de sesión', () => {
  it('Carrera empieza con un bloque continuo con cronómetro', () => {
    const session = createSessionOfType('u1', 'running', T0, sequentialIds())
    expect(session.sessionType).toBe('running')
    expect(session.blocks[0]).toMatchObject({ blockType: 'free', settings: { kind: 'free' } })
    expect(session.blocks[0]?.sets[0]?.exerciseId).toBe('run')
  })

  it('Registrar actividad crea una sesión ya terminada', () => {
    const session = createQuickActivity(
      'u1',
      {
        type: 'surf',
        title: '',
        startedAt: '2026-09-28T08:00:00Z',
        durationMin: 90,
        rpe: 6,
        notes: 'Olas de 1 m',
        avgHr: 125,
        maxHr: 160,
        calories: 700,
      },
      T0,
      sequentialIds(),
    )
    expect(session).toMatchObject({
      sessionType: 'surf',
      title: 'Surf',
      durationMin: 90,
      rpe: 6,
      endedAt: '2026-09-28T09:30:00.000Z',
      avgHr: 125,
      maxHr: 160,
      calories: 700,
    })
    expect(session.blocks[0]?.sets[0]).toMatchObject({ exerciseId: 'surf', durationS: 5400, completed: true })
  })
})
