import { describe, expect, it } from 'vitest'
import { thirdPerson } from '@/lib/progress/equivalences'
import { toPayload } from '@/lib/workout/payload'
import {
  addExerciseBlock,
  createSession,
  toggleSetComplete,
  updateSet,
} from '@/lib/workout/session-ops'
import { addTimedBlock } from '@/lib/workout/timed-blocks'
import { sequentialIds } from '@/lib/workout/test-helpers'
import type { LastPerformance, LocalSession } from '@/lib/workout/types'
import { createActivitySession } from '@/lib/workout/session-kinds'
import {
  activityNameKey,
  comparePairSessions,
  matchPairActivity,
  pairTemplateFromSession,
  parsePairTemplate,
  sessionFromPairTemplate,
  templateExerciseCount,
} from './pair'

const T0 = Date.parse('2026-09-28T10:00:00Z')

function initiatorSession() {
  const id = sequentialIds('a')
  let s = createSession('ana', T0, id, 'Pierna', 'strength', 'gym')
  s = addExerciseBlock(s, { id: 'back_squat', defaultRestS: 150 }, null, T0, id)
  s = addExerciseBlock(s, { id: 'u_ana_press', defaultRestS: 90 }, null, T0, id)
  s = addTimedBlock(
    s,
    { kind: 'emom', minutes: 10, intervalS: 60 },
    [{ exercise: { id: 'kb_swing', defaultRestS: 0 }, targetReps: 12 }],
    T0,
    id,
  )
  // Ana apunta sus pesos y reps: los pesos nunca viajan.
  for (const set of s.blocks[0]!.sets) s = updateSet(s, set.id, { weightKg: 100, reps: 5 }, T0)
  s = updateSet(s, s.blocks[0]!.sets[0]!.id, { reps: 8 }, T0)
  return { ...s, pairGroupId: 'group-1' }
}

describe('entreno en pareja: plantilla', () => {
  it('lleva la estructura sin pesos ni ejercicios propios', () => {
    const { template, skipped } = pairTemplateFromSession(
      initiatorSession(),
      (e) => !e.startsWith('u_'),
    )
    expect(skipped).toBe(1)
    expect(template.title).toBe('Pierna')
    expect(template.blocks.map((b) => b.block_type)).toEqual(['straight', 'emom'])
    expect(template.blocks[0]!.sets.map((s) => s.reps)).toEqual([8, 5, 5])
    expect(JSON.stringify(template)).not.toContain('weight')
    expect(JSON.stringify(template)).not.toContain('u_ana_press')
    expect(template.blocks[1]!.settings).toMatchObject({ kind: 'emom', minutes: 10 })
    expect(templateExerciseCount(template)).toBe(2)
    // Pasa la validación del lado que la recibe (ida y vuelta por JSON).
    expect(parsePairTemplate(JSON.parse(JSON.stringify(template)))).toEqual(template)
  })

  it('rechaza plantillas mal formadas', () => {
    expect(parsePairTemplate({ v: 1, blocks: 'x' })).toBeNull()
    expect(parsePairTemplate(null)).toBeNull()
  })

  it('quien se une recibe la misma estructura con SUS pesos y el mismo pair_group_id', () => {
    const { template } = pairTemplateFromSession(initiatorSession(), (e) => !e.startsWith('u_'))
    const last = new Map<string, LastPerformance>([
      [
        'back_squat',
        {
          exerciseId: 'back_squat',
          endedAt: '2026-09-20T10:00:00Z',
          sets: [
            {
              setIndex: 0,
              isWarmup: false,
              weightKg: 60,
              reps: 6,
              rir: null,
              durationS: null,
              distanceM: null,
              calories: null,
            },
            {
              setIndex: 1,
              isWarmup: false,
              weightKg: 62.5,
              reps: 6,
              rir: null,
              durationS: null,
              distanceM: null,
              calories: null,
            },
          ],
        },
      ],
    ])
    const s = sessionFromPairTemplate(template, {
      userId: 'bea',
      pairGroupId: 'group-1',
      now: T0 + 60_000,
      known: () => true,
      last,
      newId: sequentialIds('b'),
    })
    expect(s.userId).toBe('bea')
    expect(s.pairGroupId).toBe('group-1')
    expect(s.mode).toBe('live')
    expect(s.blocks.map((b) => b.blockType)).toEqual(['straight', 'emom'])
    // Pesos de su última vez (la 3.ª serie repite el último peso), reps de la plantilla.
    expect(s.blocks[0]!.sets.map((x) => [x.weightKg, x.reps, x.completed])).toEqual([
      [60, 8, false],
      [62.5, 5, false],
      [62.5, 5, false],
    ])
    expect(s.blocks[1]!.exercises[0]).toMatchObject({ exerciseId: 'kb_swing', targetReps: 12 })
    expect(s.blocks[1]!.settings).toMatchObject({ kind: 'emom', minutes: 10 })
    // El pair_group_id viaja al servidor con la sesión.
    expect(toPayload(s).session.pair_group_id).toBe('group-1')
  })

  it('quita los ejercicios que quien se une no tiene en su biblioteca', () => {
    const { template } = pairTemplateFromSession(initiatorSession(), () => true)
    const s = sessionFromPairTemplate(template, {
      userId: 'bea',
      pairGroupId: 'g',
      now: T0,
      known: (e) => e !== 'u_ana_press',
      newId: sequentialIds('c'),
    })
    expect(s.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId))).toEqual([
      'back_squat',
      'kb_swing',
    ])
    expect(s.blocks.map((b) => b.order)).toEqual([0, 1])
  })
})

describe('entreno en pareja: actividades personalizadas', () => {
  const escalada = { name: 'Escalada', emoji: '🧗', muscles: ['lats', 'forearms', 'biceps'] }

  function customSession() {
    const s = createActivitySession('ana', 'other', T0, sequentialIds('c'))
    return {
      ...s,
      sessionType: 'custom' as const,
      activityTypeId: 'a_ana_escalada',
      title: 'Rocódromo',
    }
  }

  it('la invitación lleva su nombre, emoji y músculos (y «other» para versiones antiguas)', () => {
    const { template } = pairTemplateFromSession(
      customSession(),
      () => true,
      (id) => (id === 'a_ana_escalada' ? escalada : undefined),
    )
    expect(template.session_type).toBe('other')
    expect(template.activity).toEqual(escalada)
    expect(parsePairTemplate(JSON.parse(JSON.stringify(template)))).toEqual(template)
    // Una invitación sin actividad (versión anterior) sigue valiendo.
    const { activity: _a, ...old } = template
    void _a
    expect(parsePairTemplate(old)?.activity).toBeUndefined()
  })

  it('quien se une la guarda como su actividad personalizada', () => {
    const { template } = pairTemplateFromSession(
      customSession(),
      () => true,
      () => escalada,
    )
    const joined = sessionFromPairTemplate(template, {
      userId: 'bea',
      pairGroupId: 'g',
      now: T0,
      known: () => true,
      newId: sequentialIds('b'),
      activityTypeId: 'a_bea_escalada',
    })
    expect(joined.sessionType).toBe('custom')
    expect(joined.activityTypeId).toBe('a_bea_escalada')
    expect(toPayload(joined).session).toMatchObject({
      session_type: 'custom',
      activity_type_id: 'a_bea_escalada',
    })
    // Sin actividad propia (no se pudo crear): «otra», como antes.
    const fallback = sessionFromPairTemplate(template, {
      userId: 'bea',
      pairGroupId: 'g',
      now: T0,
      known: () => true,
    })
    expect(fallback.sessionType).toBe('other')
    expect(fallback.activityTypeId).toBeUndefined()
  })

  it('reutiliza la actividad propia con el mismo nombre (sin mayúsculas ni acentos)', () => {
    const mine = [
      { id: 'a_1', name: 'Pádel playa', archived: false },
      { id: 'a_2', name: 'ESCALADA ', archived: true },
      { id: 'a_3', name: 'escalada', archived: false },
    ]
    expect(matchPairActivity(escalada, mine)?.id).toBe('a_3')
    expect(matchPairActivity({ ...escalada, name: 'Surf skate' }, mine)).toBeUndefined()
    expect(activityNameKey('  Pádel   Playa ')).toBe('padel playa')
  })

  it('las globales viajan por su tipo (sin datos de actividad)', () => {
    const s = createActivitySession('ana', 'padel', T0, sequentialIds('p'))
    const { template } = pairTemplateFromSession(s, () => true)
    expect(template.session_type).toBe('padel')
    expect(template.activity).toBeUndefined()
    expect(s.blocks[0]!.exercises[0]!.exerciseId).toBe('padel')
  })
})

describe('entreno en pareja: comparación', () => {
  it('mejor serie, series y tonelaje por ejercicio de cada uno', () => {
    const complete = (s: LocalSession) =>
      s.blocks[0]!.sets.reduce((acc, set) => toggleSetComplete(acc, set.id, T0), s)
    const mine = complete(initiatorSession())
    const { template } = pairTemplateFromSession(mine, (e) => !e.startsWith('u_'))
    let theirs = sessionFromPairTemplate(template, {
      userId: 'bea',
      pairGroupId: 'group-1',
      now: T0,
      known: () => true,
      newId: sequentialIds('d'),
    })
    for (const set of theirs.blocks[0]!.sets)
      theirs = updateSet(theirs, set.id, { weightKg: 60, reps: 10 }, T0)
    theirs = complete(theirs)

    const rows = comparePairSessions(mine, theirs)
    const squat = rows.find((r) => r.exerciseId === 'back_squat')!
    expect(squat.mine).toEqual({ sets: 3, bestKg: 100, bestReps: 8, tonnageKg: 1800 })
    expect(squat.theirs).toEqual({ sets: 3, bestKg: 60, bestReps: 10, tonnageKg: 1800 })
    const own = rows.find((r) => r.exerciseId === 'u_ana_press')!
    expect(own.theirs.sets).toBe(0)
  })
})

describe('frases de logros en tercera persona', () => {
  it('«Has corrido…» → «Ha corrido…»', () => {
    expect(thirdPerson('Este mes has corrido la distancia de tu ciudad a Huesca')).toBe(
      'Este mes ha corrido la distancia de su ciudad a Huesca',
    )
    expect(thirdPerson('Llevas el 12 % de la Torre Eiffel')).toBe(
      'Lleva el 12 % de la Torre Eiffel',
    )
  })
})

describe('pairTemplateSignature (sincronización automática, 7B)', () => {
  it('no depende del orden de las claves (jsonb las reordena)', async () => {
    const { pairTemplateSignature } = await import('./pair')
    const a = { v: 1, title: 'x', blocks: [{ block_type: 'straight', exercises: [] }] }
    const b = { blocks: [{ exercises: [], block_type: 'straight' }], title: 'x', v: 1 }
    expect(pairTemplateSignature(a)).toBe(pairTemplateSignature(b))
    expect(pairTemplateSignature({ ...a, title: 'y' })).not.toBe(pairTemplateSignature(a))
  })
})
