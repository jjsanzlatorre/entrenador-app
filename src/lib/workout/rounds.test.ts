// Bloques por rondas, «cada lado» y «Escribir entreno» (caso real: circuito de 5 ejercicios × 4).
import { describe, expect, it } from 'vitest'
import { loadAllSeedExercises } from '../../../scripts/seed-exercises'
import type { ExerciseCategory, TrackingType } from '@/types/database'
import { localSetCounts, muscleVolume, setsOf } from '@/lib/progress/muscle-volume'
import { holdView, pressHold, startHold } from './hold'
import { fromServerRows, toPayload } from './payload'
import {
  assignExercise,
  draftFromBlock,
  draftFromParsed,
  draftProblems,
  draftToInput,
} from './round-draft'
import {
  addRound,
  addRoundBlock,
  applyToFollowingRounds,
  blockRounds,
  completeRound,
  copyBlockFrom,
  currentRoundIndex,
  duplicateBlock,
  followingDiffer,
  removeRound,
  roundBlockLabel,
  roundCount,
  roundSettings,
  updateRoundBlock,
  type RoundBlockInput,
} from './rounds'
import { addExerciseBlock, createSession, toggleSetComplete, updateSet } from './session-ops'
import { sessionFromStructure, structureFromSession } from './templates'
import { pairTemplateFromSession, sessionFromPairTemplate } from '@/lib/partners/pair'
import { sequentialIds } from './test-helpers'
import { matchExercise, parseItem, parseWorkoutText } from './text-parse'
import { addTimedBlock } from './timed-blocks'
import type { Exercise, LocalSession } from './types'

const library: Exercise[] = loadAllSeedExercises().exercises.map((e) => ({
  id: e.id,
  name: e.name,
  aliases: e.aliases,
  category: e.category as ExerciseCategory,
  trackingType: e.tracking_type as TrackingType,
  equipment: e.equipment,
  isUnilateral: e.is_unilateral,
  isCompound: e.is_compound,
  defaultRestS: e.default_rest_s,
  techniqueNotes: null,
  techniqueSteps: [],
  techniqueMistakes: [],
  ownerId: null,
  muscles: [
    ...e.primary.map((muscleId) => ({ muscleId, role: 'primary' as const })),
    ...e.secondary.map((muscleId) => ({ muscleId, role: 'secondary' as const })),
  ],
}))
const byId = new Map(library.map((e) => [e.id, e]))
const ex = (id: string) => {
  const e = byId.get(id)
  if (!e) throw new Error(`no existe ${id}`)
  return e
}

const T0 = Date.parse('2026-10-28T18:00:00Z')

// El bloque real: plancha lateral 45 s/lado → hip thrust 20 → dominadas 5 → plancha 45 s →
// flexiones 25, ×4.
function realCircuit(): RoundBlockInput {
  return {
    rounds: 4,
    restBetweenExercisesS: 0,
    restBetweenRoundsS: 90,
    exercises: [
      { exercise: ex('side_plank'), target: { durationS: 45 }, perSide: true },
      { exercise: ex('hip_thrust'), target: { reps: 20, weightKg: 40 } },
      { exercise: ex('pull_up'), target: { reps: 5 } },
      { exercise: ex('plank'), target: { durationS: 45 } },
      { exercise: ex('push_up'), target: { reps: 25 } },
    ],
  }
}

function withCircuit(mode: LocalSession['mode'] = 'live') {
  const ids = sequentialIds('r')
  const s = { ...createSession('ana', T0, ids), mode }
  return { session: addRoundBlock(s, realCircuit(), T0, ids), ids }
}

describe('bloque por rondas: crear', () => {
  it('5 ejercicios × 4 rondas → 20 series precargadas con su objetivo', () => {
    const { session } = withCircuit()
    const block = session.blocks[0]!
    expect(block.blockType).toBe('superset')
    expect(roundBlockLabel(block)).toBe('Circuito')
    expect(block.sets).toHaveLength(20)
    expect(roundCount(block)).toBe(4)
    expect(roundSettings(block)).toEqual({
      rounds: 4,
      restBetweenExercisesS: 0,
      restBetweenRoundsS: 90,
    })
    for (const round of blockRounds(block)) {
      expect(round.sets.map((s) => s?.exerciseId)).toEqual([
        'side_plank',
        'hip_thrust',
        'pull_up',
        'plank',
        'push_up',
      ])
      expect(round.sets[0]).toMatchObject({ durationS: 45, completed: false })
      expect(round.sets[1]).toMatchObject({ reps: 20, weightKg: 40 })
    }
    expect(block.exercises[0]!.perSide).toBe(true)
    expect(block.exercises[1]!.perSide).toBeUndefined()
  })

  it('un solo ejercicio: series normales', () => {
    const ids = sequentialIds()
    const s = addRoundBlock(
      createSession('ana', T0, ids),
      { ...realCircuit(), exercises: realCircuit().exercises.slice(1, 2) },
      T0,
      ids,
    )
    expect(s.blocks[0]).toMatchObject({ blockType: 'straight' })
    expect(s.blocks[0]!.sets).toHaveLength(4)
    expect(s.blocks[0]!.exercises[0]!.restS).toBe(90)
  })
})

describe('bloque por rondas: registrar', () => {
  it('«✓ Ronda» ×4 → 20 series hechas, guardadas y con el volumen muscular correcto', () => {
    let { session } = withCircuit()
    const blockId = session.blocks[0]!.id
    for (let r = 0; r < 4; r++) {
      expect(currentRoundIndex(session.blocks[0]!)).toBe(r)
      session = completeRound(session, blockId, r, T0 + (r + 1) * 60_000)
    }
    const block = session.blocks[0]!
    expect(currentRoundIndex(block)).toBe(-1)
    expect(block.sets.filter((s) => s.completed)).toHaveLength(20)

    // Lo que se manda al servidor: 20 series completadas, «cada lado» en la config.
    const payload = toPayload({ ...session, endedAt: new Date(T0 + 3_600_000).toISOString() })
    expect(payload.sets).toHaveLength(20)
    expect(payload.sets.every((s) => s.completed)).toBe(true)
    expect(payload.blocks[0]!.config.exercises[0]).toMatchObject({ per_side: true })
    expect(payload.blocks[0]!.config.settings).toMatchObject({ rounds: 4 })

    // Volumen: 4 series por ejercicio; los dos lados de la plancha lateral cuentan 1 serie.
    const counts = localSetCounts(session)
    expect(counts).toHaveLength(5)
    expect(counts.every((c) => c.sets === 4)).toBe(true)
    const volume = muscleVolume(
      [
        {
          id: session.id,
          sessionType: 'strength',
          startedAt: session.startedAt,
          endedAt: session.startedAt,
          durationMin: 40,
        },
      ],
      counts,
      byId,
    )
    const expected = new Map<string, number>()
    for (const id of ['side_plank', 'hip_thrust', 'pull_up', 'plank', 'push_up'])
      for (const m of ex(id).muscles)
        expected.set(m.muscleId, (expected.get(m.muscleId) ?? 0) + (m.role === 'primary' ? 4 : 2))
    for (const [muscle, sets] of expected) expect(setsOf(volume, muscle), muscle).toBe(sets)
    // Core: plancha lateral, plancha y flexiones (y lo que aporte cada uno).
    expect(setsOf(volume, 'core')).toBeGreaterThanOrEqual(8)
  })

  it('al completar una ronda, la siguiente queda con los mismos valores y arranca el descanso', () => {
    let { session } = withCircuit()
    const blockId = session.blocks[0]!.id
    // Ronda 1 con más peso en el hip thrust.
    const hip = blockRounds(session.blocks[0]!)[0]!.sets[1]!
    session = updateSet(session, hip.id, { weightKg: 50 }, T0)
    session = completeRound(session, blockId, 0, T0 + 1000)
    expect(session.rest).toMatchObject({ exerciseId: 'push_up' })
    expect(session.rest!.endsAt - session.rest!.startedAt).toBe(90_000)
    const next = blockRounds(session.blocks[0]!)[1]!
    expect(next.complete).toBe(false)
    expect(next.sets[1]).toMatchObject({ reps: 20, weightKg: 40 })
  })

  it('ejercicio a ejercicio: sin descanso entre ejercicios por defecto; el de rondas al cerrarla', () => {
    let { session } = withCircuit()
    const round = blockRounds(session.blocks[0]!)[0]!
    session = toggleSetComplete(session, round.sets[0]!.id, T0)
    expect(session.rest).toBeNull()
    for (const set of round.sets.slice(1, 4)) session = toggleSetComplete(session, set!.id, T0)
    expect(session.rest).toBeNull()
    session = toggleSetComplete(session, round.sets[4]!.id, T0 + 5)
    expect(session.rest).toMatchObject({ startedAt: T0 + 5, endsAt: T0 + 5 + 90_000 })
  })

  it('descanso entre ejercicios configurable', () => {
    const ids = sequentialIds()
    let s = addRoundBlock(
      createSession('ana', T0, ids),
      { ...realCircuit(), restBetweenExercisesS: 15 },
      T0,
      ids,
    )
    const round = blockRounds(s.blocks[0]!)[0]!
    s = toggleSetComplete(s, round.sets[0]!.id, T0)
    expect(s.rest).toMatchObject({ exerciseId: 'side_plank', endsAt: T0 + 15_000 })
  })

  it('cerrar la ronda en otro orden también arranca el descanso entre rondas', () => {
    let { session } = withCircuit()
    const round = blockRounds(session.blocks[0]!)[0]!
    for (const set of [...round.sets].reverse()) session = toggleSetComplete(session, set!.id, T0)
    expect(session.rest!.endsAt - session.rest!.startedAt).toBe(90_000)
  })

  it('en un entreno pasado no hay descanso', () => {
    let { session } = withCircuit('past')
    session = completeRound(session, session.blocks[0]!.id, 0, T0)
    expect(session.rest).toBeNull()
  })
})

describe('+1 ronda, quitar ronda, aplicar a las siguientes, duplicar', () => {
  it('«+1 ronda» copia la última y «Quitar ronda» la quita', () => {
    const circuit = withCircuit()
    const ids = circuit.ids
    let session = circuit.session
    const blockId = session.blocks[0]!.id
    const last = blockRounds(session.blocks[0]!)[3]!.sets[2]!
    session = updateSet(session, last.id, { reps: 6 }, T0)
    session = addRound(session, blockId, T0, ids)
    let block = session.blocks[0]!
    expect(roundCount(block)).toBe(5)
    expect(block.sets).toHaveLength(25)
    expect(blockRounds(block)[4]!.sets[2]).toMatchObject({ reps: 6, completed: false })
    expect(block.settings).toMatchObject({ kind: 'circuit', rounds: 5 })
    session = removeRound(session, blockId, T0)
    session = removeRound(session, blockId, T0)
    block = session.blocks[0]!
    expect(roundCount(block)).toBe(3)
    expect(block.sets).toHaveLength(15)
  })

  it('no se quita la única ronda', () => {
    const ids = sequentialIds()
    let s = addRoundBlock(createSession('ana', T0, ids), { ...realCircuit(), rounds: 1 }, T0, ids)
    s = removeRound(s, s.blocks[0]!.id, T0)
    expect(roundCount(s.blocks[0]!)).toBe(1)
  })

  it('«Aplicar a las rondas siguientes» copia el valor solo a las pendientes posteriores', () => {
    let { session } = withCircuit()
    const blockId = session.blocks[0]!.id
    session = completeRound(session, blockId, 0, T0)
    const r2 = blockRounds(session.blocks[0]!)[1]!.sets[2]!
    // Las dominadas bajan a 4 en la ronda 2 (las siguientes seguían a 5: no se arrastra solo).
    session = updateSet(session, r2.id, { reps: 4 }, T0)
    expect(followingDiffer(session, r2.id)).toBe(2)
    session = applyToFollowingRounds(session, r2.id, T0)
    const reps = blockRounds(session.blocks[0]!).map((r) => r.sets[2]!.reps)
    expect(reps).toEqual([5, 4, 4, 4])
    expect(followingDiffer(session, r2.id)).toBe(0)
  })

  it('«Duplicar bloque» crea una copia pendiente justo después', () => {
    const circuit = withCircuit()
    const ids = circuit.ids
    let session = circuit.session
    session = addExerciseBlock(session, ex('back_squat'), null, T0, ids)
    session = completeRound(session, session.blocks[0]!.id, 0, T0)
    session = duplicateBlock(session, session.blocks[0]!.id, T0, ids)
    expect(session.blocks.map((b) => b.order)).toEqual([0, 1, 2])
    const copy = session.blocks[1]!
    expect(copy.id).not.toBe(session.blocks[0]!.id)
    expect(copy.sets).toHaveLength(20)
    expect(copy.sets.every((s) => !s.completed)).toBe(true)
    expect(copy.exercises[0]!.perSide).toBe(true)
    expect(session.blocks[2]!.exercises[0]!.exerciseId).toBe('back_squat')
  })
})

describe('editar el bloque', () => {
  it('cambia rondas, objetivos de las pendientes y descansos sin tocar lo hecho', () => {
    const circuit = withCircuit()
    const ids = circuit.ids
    let session = circuit.session
    const blockId = session.blocks[0]!.id
    session = completeRound(session, blockId, 0, T0)
    const draft = draftFromBlock(session.blocks[0]!, byId)
    expect(draft.rounds).toBe('4')
    expect(draft.items.map((i) => i.values.reps ?? i.values.durationS)).toEqual([
      '45',
      '20',
      '5',
      '45',
      '25',
    ])
    draft.rounds = '5'
    draft.restBetweenRoundsS = '60'
    draft.items[4]!.values.reps = '20'
    const input = draftToInput(draft, byId)!
    session = updateRoundBlock(session, blockId, input, T0, ids)
    const block = session.blocks[0]!
    expect(roundCount(block)).toBe(5)
    const pushUps = blockRounds(block).map((r) => r.sets[4]!.reps)
    expect(pushUps).toEqual([25, 20, 20, 20, 20])
    expect(roundSettings(block).restBetweenRoundsS).toBe(60)
    expect(block.sets.filter((s) => s.completed)).toHaveLength(5)
  })

  it('quitar un ejercicio del bloque quita sus series', () => {
    const circuit = withCircuit()
    const ids = circuit.ids
    let session = circuit.session
    const draft = draftFromBlock(session.blocks[0]!, byId)
    draft.items = draft.items.filter((i) => i.exerciseId !== 'plank')
    session = updateRoundBlock(session, session.blocks[0]!.id, draftToInput(draft, byId)!, T0, ids)
    expect(session.blocks[0]!.sets).toHaveLength(16)
    expect(session.blocks[0]!.exercises).toHaveLength(4)
  })
})

describe('copiar bloque de otra sesión', () => {
  it('se añade con sus ejercicios, valores y nº de rondas (lo hecho)', () => {
    let { session } = withCircuit()
    const blockId = session.blocks[0]!.id
    for (let r = 0; r < 4; r++) session = completeRound(session, blockId, r, T0)
    // Se guarda y se vuelve a leer, como cuando viene del historial.
    const payload = toPayload({ ...session, endedAt: new Date(T0).toISOString() })
    const rows = fromServerRows(
      {
        id: session.id,
        user_id: 'ana',
        session_type: 'strength',
        title: 'x',
        started_at: session.startedAt,
        ended_at: session.startedAt,
        client_rev: 1,
      } as never,
      payload.blocks.map((b) => ({ ...b, session_id: session.id, user_id: 'ana' })) as never,
      payload.sets.map((s) => ({ ...s, session_id: session.id, user_id: 'ana' })) as never,
    )
    expect(rows.blocks[0]!.exercises[0]!.perSide).toBe(true)

    const ids = sequentialIds('c')
    const target = copyBlockFrom(createSession('ana', T0, ids), rows.blocks[0]!, T0, ids)
    const copy = target.blocks[0]!
    expect(roundCount(copy)).toBe(4)
    expect(copy.sets).toHaveLength(20)
    expect(copy.sets.every((s) => !s.completed)).toBe(true)
    expect(blockRounds(copy)[0]!.sets[1]).toMatchObject({ reps: 20, weightKg: 40 })
  })

  it('un bloque con temporizador se copia sin empezar', () => {
    const ids = sequentialIds()
    let s = createSession('ana', T0, ids)
    s = addTimedBlock(
      s,
      { kind: 'emom', minutes: 6, intervalS: 60 },
      [{ exercise: ex('burpee'), targetReps: 10 }],
      T0,
      ids,
    )
    const source = {
      ...s.blocks[0]!,
      timer: { ...s.blocks[0]!.timer!, startedAt: T0, finishedAt: T0 + 1 },
    }
    const copy = copyBlockFrom(createSession('ana', T0, ids), source, T0, ids).blocks[0]!
    expect(copy.timer?.startedAt).toBeNull()
    expect(copy.sets).toHaveLength(6)
    expect(copy.result).toMatchObject({ kind: 'emom', minutesCompleted: 0 })
  })
})

describe('plantillas y entreno en pareja entienden las rondas', () => {
  it('la estructura conserva rondas, descansos y «cada lado»', () => {
    let { session } = withCircuit()
    session = completeRound(session, session.blocks[0]!.id, 0, T0)
    const structure = structureFromSession(session)!
    const rebuilt = sessionFromStructure(structure, {
      userId: 'ana',
      title: 'Circuito',
      sessionType: 'strength',
      catalog: byId,
      newId: sequentialIds('t'),
      now: T0,
    })
    const block = rebuilt.blocks[0]!
    expect(roundSettings(block)).toMatchObject({ restBetweenRoundsS: 90 })
    expect(block.exercises[0]!.perSide).toBe(true)
    expect(block.settings).toMatchObject({ kind: 'circuit' })

    const { template } = pairTemplateFromSession(session, () => true)
    const joined = sessionFromPairTemplate(template, {
      userId: 'luis',
      pairGroupId: 'g',
      known: () => true,
      newId: sequentialIds('p'),
    })
    expect(roundCount(joined.blocks[0]!)).toBe(4)
    expect(joined.blocks[0]!.exercises[0]!.perSide).toBe(true)
  })
})

describe('«cada lado» en el cronómetro de la serie', () => {
  it('cuenta atrás del lado 1, cambio de lado y lado 2; guarda el tiempo por lado', () => {
    const hold = startHold(T0, 45, true)
    expect(holdView(hold, T0 + 10_000)).toMatchObject({ side: 1, clockS: 35, done: false })
    expect(holdView(hold, T0 + 44_100)).toMatchObject({ side: 1, leftS: 1 })
    // A los 45 s cambia de lado solo.
    expect(holdView(hold, T0 + 45_000)).toMatchObject({ side: 2, clockS: 45, done: false })
    expect(holdView(hold, T0 + 80_000)).toMatchObject({ side: 2, clockS: 10 })
    expect(holdView(hold, T0 + 90_000)).toMatchObject({ side: 2, done: true, resultS: 45 })
  })

  it('sin «cada lado» termina al acabar el tiempo', () => {
    const hold = startHold(T0, 45)
    expect(holdView(hold, T0 + 45_000)).toMatchObject({ side: null, done: true, resultS: 45 })
  })

  it('sin objetivo: el primer toque cambia de lado y el segundo para (el lado más corto)', () => {
    let hold = startHold(T0, null, true)
    expect(holdView(hold, T0 + 30_000)).toMatchObject({ side: 1, clockS: 30 })
    const first = pressHold(hold, T0 + 40_000)
    expect(first.resultS).toBeNull()
    hold = first.hold!
    expect(holdView(hold, T0 + 50_000)).toMatchObject({ side: 2, clockS: 10 })
    expect(pressHold(hold, T0 + 75_000)).toEqual({ hold: null, resultS: 35 })
  })

  it('parar antes de tiempo en el lado 2', () => {
    const hold = startHold(T0, 45, true)
    expect(pressHold(hold, T0 + 45_000 + 30_000).resultS).toBe(30)
  })
})

describe('«Escribir entreno»: parser de texto', () => {
  const real =
    'plancha lateral 45s/lado + hip thrust 20 + dominadas 5 + plancha 45s + flexiones 25, x4'

  it('el bloque real: 5 ejercicios × 4 rondas', () => {
    const parsed = parseWorkoutText(real, library)
    expect(parsed.understood).toBe(true)
    expect(parsed.blocks).toHaveLength(1)
    const block = parsed.blocks[0]!
    expect(block.rounds).toBe(4)
    expect(block.items.map((i) => i.exerciseId)).toEqual([
      'side_plank',
      'hip_thrust',
      'pull_up',
      'plank',
      'push_up',
    ])
    expect(block.items[0]).toMatchObject({ durationS: 45, perSide: true, reps: null })
    expect(block.items[1]).toMatchObject({ reps: 20, perSide: false })
    expect(block.items[3]).toMatchObject({ durationS: 45, perSide: false })
    expect(block.items[4]).toMatchObject({ reps: 25 })

    // Vista previa → bloque: 20 series.
    const draft = draftFromParsed(block, byId)
    expect(draftProblems(draft, byId)).toEqual([])
    const ids = sequentialIds()
    const s = addRoundBlock(createSession('ana', T0, ids), draftToInput(draft, byId)!, T0, ids)
    expect(s.blocks[0]!.sets).toHaveLength(20)
    expect(s.blocks[0]!.exercises[0]!.perSide).toBe(true)
  })

  it.each([
    [
      '4x (plancha lateral 45s cada lado + hip thrust 20 + dominadas 5 + plancha 45 s + flexiones 25)',
    ],
    [
      '4 rondas: plancha lateral 45" por lado + hip thrust 20 reps + dominadas 5 + plancha isométrica 45s + flexiones 25',
    ],
    ['plancha lateral 45s/lado, hip thrust 20, dominadas 5, plancha 45s, flexiones 25 x4'],
    ['(plancha lateral 0:45 c/l + hip thrust 20 + dominadas 5 + plancha 0:45 + flexiones 25) ×4'],
    [
      'Plancha lateral 45s/lado + Hip thrust 20 + Dominadas 5 + Plancha 45s + Flexiones 25, 4 vueltas',
    ],
  ])('variantes del mismo bloque: %s', (text) => {
    const parsed = parseWorkoutText(text, library)
    expect(parsed.understood).toBe(true)
    const block = parsed.blocks[0]!
    expect(block.rounds).toBe(4)
    expect(block.items.map((i) => i.exerciseId)).toEqual([
      'side_plank',
      'hip_thrust',
      'pull_up',
      'plank',
      'push_up',
    ])
    expect(block.items[0]).toMatchObject({ durationS: 45, perSide: true })
    expect(block.items[3]).toMatchObject({ durationS: 45 })
    expect(block.items.map((i) => i.reps)).toEqual([null, 20, 5, null, 25])
  })

  it('3x10 @20kg, distancias, calorías, descanso y varias líneas', () => {
    const parsed = parseWorkoutText(
      'press banca 3x10 @60kg\nremo ergómetro 500m + burpees 15 + air bike 20 cal, x3, descanso 2 min; zancadas 3x10/lado 20 kg',
      library,
    )
    expect(parsed.blocks).toHaveLength(3)
    const [bench, circuit, lunges] = parsed.blocks
    expect(bench).toMatchObject({ rounds: 3 })
    expect(bench!.items[0]).toMatchObject({ exerciseId: 'bench_press', reps: 10, weightKg: 60 })
    expect(circuit).toMatchObject({ rounds: 3, restBetweenRoundsS: 120 })
    expect(circuit!.items.map((i) => i.exerciseId)).toEqual(['row_erg', 'burpee', 'air_bike'])
    expect(circuit!.items[0]).toMatchObject({ distanceM: 500 })
    expect(circuit!.items[1]).toMatchObject({ reps: 15 })
    expect(circuit!.items[2]).toMatchObject({ calories: 20 })
    expect(lunges!.items[0]).toMatchObject({ reps: 10, perSide: true, weightKg: 20 })
    expect(lunges).toMatchObject({ rounds: 3 })
  })

  it('un número suelto se interpreta según el ejercicio', () => {
    const parsed = parseWorkoutText('plancha 45 + remo ergómetro 500 + hip thrust 12 x3', library)
    const [plank, row, hip] = parsed.blocks[0]!.items
    expect(plank).toMatchObject({ durationS: 45, reps: null })
    expect(row).toMatchObject({ distanceM: 500, reps: null })
    expect(hip).toMatchObject({ reps: 12 })
  })

  it('valores sueltos', () => {
    expect(parseItem('peso muerto 5x5 @100kg')).toMatchObject({
      name: 'peso muerto',
      sets: 5,
      reps: 5,
      weightKg: 100,
    })
    expect(parseItem('sentadilla 4x8-10 80 kg')).toMatchObject({ sets: 4, reps: 8, weightKg: 80 })
    expect(parseItem('dead hang 3x30s')).toMatchObject({ sets: 3, durationS: 30 })
    expect(parseItem('carrera 5 km')).toMatchObject({ distanceM: 5000 })
    expect(parseItem('plancha 1\'30"')).toMatchObject({ durationS: 90 })
    expect(parseItem('curl 12 @ 135 lb').weightKg).toBeCloseTo(61.2, 1)
  })

  it('lo que no se reconoce queda marcado (para elegirlo o crearlo)', () => {
    const parsed = parseWorkoutText('patada voladora 10 + flexiones 20, x3', library)
    expect(parsed.understood).toBe(false)
    const [unknown, known] = parsed.blocks[0]!.items
    expect(unknown).toMatchObject({ name: 'patada voladora', exerciseId: null, reps: 10 })
    expect(known).toMatchObject({ exerciseId: 'push_up' })
    const draft = draftFromParsed(parsed.blocks[0]!, byId)
    expect(draftProblems(draft, byId).map((p) => p.message)).toEqual([
      'Elige o crea «patada voladora»',
    ])
    // Al elegir el ejercicio, los valores escritos se quedan.
    draft.items[0] = assignExercise(draft.items[0]!, ex('burpee'))
    expect(draft.items[0]!.values.reps).toBe('10')
    expect(draftToInput(draft, byId)).not.toBeNull()
  })

  it('texto sin nada útil', () => {
    expect(parseWorkoutText('   \n ; ', library)).toEqual({ blocks: [], understood: false })
  })

  it('buscar el ejercicio: alias, plurales y palabras de más', () => {
    expect(matchExercise('push ups', library)?.exercise.id).toBe('push_up')
    expect(matchExercise('Flexión', library)?.exercise.id).toBe('push_up')
    expect(matchExercise('plancha isométrica', library)?.exercise.id).toBe('plank')
    expect(matchExercise('side plank', library)?.exercise.id).toBe('side_plank')
    expect(matchExercise('patada voladora', library)).toBeNull()
  })
})
