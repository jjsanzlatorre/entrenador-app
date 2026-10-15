// Entrenos con fecha pasada: selector de fecha, modo «entreno pasado», cambio de fecha y su
// efecto en cumplimiento, racha, adherencia al plan y la cola sin conexión.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/offline/sync-engine', () => ({ requestSync: vi.fn() }))
vi.mock('./api', () => ({ rememberLastPerformance: vi.fn() }))

import { __resetIdbForTests } from '@/lib/offline/idb'
import { listOutbox } from '@/lib/offline/outbox'
import { activityDaysFromSessions, streaks, weekAdherence } from '@/lib/progress/adherence'
import { logEntryFromLocal } from '@/lib/progress/session-log'
import type { Commitment, SessionLogEntry } from '@/lib/progress/types'
import { planAdherence } from '@/lib/plan/calendar'
import { pastStartFor } from '@/lib/plan/start'
import {
  __resetActiveSessionForTests,
  __waitForWrites,
  asPastSession,
  applyStart,
  finishActiveSession,
  getActiveSession,
  rescheduleSession,
  startPreparedSession,
  updateActiveSession,
} from './active-session'
import {
  addExerciseBlock,
  completeFilledSets,
  createSession,
  finishSession,
  updateSet,
} from './session-ops'
import type { LocalSession } from './types'
import {
  endFor,
  formatWhen,
  retimeSession,
  startKind,
  whenFromInstant,
  whenProblem,
  whenToMs,
} from './when'

// «Hoy» = jueves 15 oct 2026, 12:00 (hora local).
const NOW = new Date(2026, 9, 15, 12, 0).getTime()
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

let n = 0
const newId = () => `id-${++n}`

// Sesión de fuerza con un ejercicio y 3 series hechas (60 kg × 8).
function strengthSession(mode: LocalSession['mode'] = 'live', startMs = NOW): LocalSession {
  let s = { ...createSession('u1', startMs, newId), mode }
  s = addExerciseBlock(s, { id: 'bench_press', defaultRestS: 120 }, null, startMs, newId)
  for (const set of s.blocks[0]!.sets) s = updateSet(s, set.id, { weightKg: 60, reps: 8 }, startMs)
  return completeFilledSets(s, startMs)
}

function finishedLog(s: LocalSession) {
  return logEntryFromLocal({ ...s, endedAt: s.endedAt! })
}

const commitment: Commitment = {
  validFrom: '2026-09-07',
  validTo: null,
  sessionsPerWeek: 1,
  minutesPerWeek: null,
  byType: null,
  countsFreeActivities: true,
}

describe('selector de fecha y hora', () => {
  it('convierte día + hora local y rechaza el futuro', () => {
    expect(whenToMs({ date: '2026-10-14', time: '18:30' })).toBe(at(14, 18, 30))
    expect(whenToMs({ date: '2026-10-14', time: '25:00' })).toBeNull()
    expect(whenToMs({ date: '2026-02-31', time: '10:00' })).toBeNull()
    expect(whenFromInstant(at(13, 7, 5))).toEqual({ date: '2026-10-13', time: '07:05' })
    expect(whenProblem({ date: '2026-10-14', time: '18:30' }, NOW)).toBeNull()
    expect(whenProblem({ date: '2026-10-15', time: '12:00' }, NOW)).toBeNull()
    expect(whenProblem({ date: '2026-10-15', time: '13:00' }, NOW)).toMatch(/futuro/)
    expect(whenProblem({ date: '2026-10-16', time: '08:00' }, NOW)).toMatch(/futuro/)
  })

  it('ahora → en directo; hace un rato hoy → en directo con esa hora; antes → entreno pasado', () => {
    expect(startKind(NOW - 30_000, NOW)).toEqual({ kind: 'now' })
    expect(startKind(at(15, 11, 15), NOW)).toEqual({ kind: 'live', startedAt: at(15, 11, 15) })
    expect(startKind(at(15, 7), NOW)).toEqual({ kind: 'past', startedAt: at(15, 7) })
    expect(startKind(at(14, 23), NOW)).toEqual({ kind: 'past', startedAt: at(14, 23) })
  })

  it('textos: hoy, ayer, anteayer y otro día', () => {
    expect(formatWhen(at(15, 9), NOW)).toBe('hoy, 09:00')
    expect(formatWhen(at(14, 18, 30), NOW)).toBe('ayer, 18:30')
    expect(formatWhen(at(13, 18, 30), NOW)).toBe('anteayer, 18:30')
    expect(formatWhen(at(12, 18, 30), NOW)).toMatch(/^lunes 12 oct, 18:30$/)
  })

  it('el fin de un entreno pasado es inicio + duración, sin pasar de ahora', () => {
    expect(endFor(at(14, 18), 60, NOW)).toBe(at(14, 19))
    expect(endFor(at(15, 11, 30), 60, NOW)).toBe(NOW)
  })

  it('una planificada se registra a las 18:00 de su día', () => {
    expect(pastStartFor('2026-10-13', NOW)).toBe(at(13, 18))
    expect(pastStartFor('2026-10-15', NOW)).toBe(NOW)
  })
})

describe('modo «entreno pasado»', () => {
  it('al guardar: fecha elegida, fin = inicio + duración y series dentro de la sesión', () => {
    const past = asPastSession(strengthSession('live'), at(14, 18))
    expect(past.mode).toBe('past')
    const saved = finishSession(past, { rpe: 8, durationMin: 50 }, NOW)
    expect(saved.mode).toBe('live')
    expect(saved.startedAt).toBe(iso(at(14, 18)))
    expect(saved.endedAt).toBe(iso(at(14, 18, 50)))
    expect(saved.durationMin).toBe(50)
    for (const set of saved.blocks[0]!.sets) {
      expect(set.completed).toBe(true)
      expect(set.completedAt).toBe(iso(at(14, 18, 50)))
    }
  })

  it('cambiar la fecha al terminar una sesión en directo la guarda en ese día', () => {
    const live = strengthSession('live', NOW - 60 * 60_000)
    const saved = finishSession(live, { rpe: 7, durationMin: 45, startedAt: iso(at(13, 9)) }, NOW)
    expect(saved.startedAt).toBe(iso(at(13, 9)))
    expect(saved.endedAt).toBe(iso(at(13, 9, 45)))
  })

  it('sin cambiar la fecha, terminar en directo sigue igual (fin = ahora)', () => {
    const live = strengthSession('live', NOW - 60 * 60_000)
    const saved = finishSession(live, { rpe: 7, durationMin: 60 }, NOW)
    expect(saved.startedAt).toBe(live.startedAt)
    expect(saved.endedAt).toBe(iso(NOW))
  })

  it('«Marcar todas como hechas» solo marca las series con datos', () => {
    let s: LocalSession = { ...createSession('u1', NOW, newId), mode: 'past' }
    s = addExerciseBlock(s, { id: 'squat', defaultRestS: 120 }, null, NOW, newId)
    const [a, b] = s.blocks[0]!.sets
    s = updateSet(s, a!.id, { weightKg: 80, reps: 5 }, NOW)
    s = updateSet(s, b!.id, { weightKg: 80, reps: 5 }, NOW)
    const done = completeFilledSets(s, NOW)
    expect(done.blocks[0]!.sets.map((x) => x.completed)).toEqual([true, true, false])
    expect(done.rest).toBeNull()
  })

  it('applyStart: ahora, hace un rato o entreno pasado', () => {
    const s = createSession('u1', NOW, newId)
    expect(applyStart(s, { kind: 'now' })).toBe(s)
    expect(applyStart(s, { kind: 'live', startedAt: at(15, 11) })).toMatchObject({
      mode: 'live',
      startedAt: iso(at(15, 11)),
    })
    expect(applyStart(s, { kind: 'past', startedAt: at(12, 19) })).toMatchObject({
      mode: 'past',
      startedAt: iso(at(12, 19)),
    })
  })
})

describe('cambiar la fecha de una sesión registrada', () => {
  it('desplaza inicio, fin y series la misma diferencia', () => {
    const saved = finishSession(
      strengthSession('live', at(13, 18)),
      { rpe: 7, durationMin: 60 },
      at(13, 19),
    )
    const moved = retimeSession({ ...saved, mode: 'edit' }, iso(at(9, 18)), 60, NOW)
    expect(moved.startedAt).toBe(iso(at(9, 18)))
    expect(moved.endedAt).toBe(iso(at(9, 19)))
    expect(moved.blocks[0]!.sets[0]!.completedAt).toBe(iso(at(9, 18)))
    expect(moved.rev).toBeGreaterThan(saved.rev)
  })
})

describe('cumplimiento, racha y plan con fechas pasadas', () => {
  it('una sesión registrada ayer cuenta en su semana y completa la racha', () => {
    // Semanas del 28 sept y del 5 oct completas; la del 12 oct, sin nada hasta registrar la de
    // ayer (miércoles 14).
    const earlier: SessionLogEntry[] = [
      finishedLog(
        finishSession(strengthSession('live', at(1, 18)), { rpe: 7, durationMin: 60 }, at(1, 19)),
      ),
      finishedLog(
        finishSession(strengthSession('live', at(7, 18)), { rpe: 7, durationMin: 60 }, at(7, 19)),
      ),
    ]
    const before = activityDaysFromSessions(earlier)
    expect(weekAdherence([commitment], before, '2026-10-12').pct).toBe(0)
    expect(streaks([commitment], before, '2026-10-15').current).toBe(2)

    const yesterday = finishSession(
      asPastSession(strengthSession('live'), at(14, 18)),
      { rpe: 8, durationMin: 50 },
      NOW,
    )
    const entry = finishedLog(yesterday)
    expect(entry.startedAt).toBe(iso(at(14, 18)))
    expect(entry.tonnageKg).toBe(60 * 8 * 3)
    const after = activityDaysFromSessions([...earlier, entry])
    expect(after.at(-1)?.day).toBe('2026-10-14')
    expect(weekAdherence([commitment], after, '2026-10-12').pct).toBe(1)
    expect(weekAdherence([commitment], after, '2026-10-05').counted).toBe(1)
    expect(streaks([commitment], after, '2026-10-15')).toEqual({ current: 3, best: 3 })
  })

  it('mover una sesión de una semana a otra recalcula las dos', () => {
    const c2 = { ...commitment, sessionsPerWeek: 2 }
    const a = finishSession(
      strengthSession('live', at(6, 18)),
      { rpe: 7, durationMin: 60 },
      at(6, 19),
    )
    const b = finishSession(
      strengthSession('live', at(8, 18)),
      { rpe: 7, durationMin: 60 },
      at(8, 19),
    )
    const days = activityDaysFromSessions([finishedLog(a), finishedLog(b)])
    expect(weekAdherence([c2], days, '2026-10-05').pct).toBe(1)
    expect(weekAdherence([c2], days, '2026-10-12').pct).toBe(0)

    const moved = retimeSession({ ...b, mode: 'edit' }, iso(at(13, 18)), b.durationMin, NOW)
    const next = activityDaysFromSessions([finishedLog(a), finishedLog({ ...moved, mode: 'live' })])
    expect(weekAdherence([c2], next, '2026-10-05').pct).toBe(0.5)
    expect(weekAdherence([c2], next, '2026-10-12').pct).toBe(0.5)
  })

  it('«Registrar como hecha» enlaza la planificada pasada y sube la adherencia al plan', () => {
    const planned = [
      { id: 'p1', date: '2026-10-12', status: 'done' as const },
      { id: 'p2', date: '2026-10-13', status: 'planned' as const },
      { id: 'p3', date: '2026-10-17', status: 'planned' as const },
    ]
    expect(planAdherence(planned, [], '2026-10-15')).toMatchObject({ done: 1, due: 2, pct: 50 })
    const session = finishSession(
      asPastSession(
        { ...strengthSession('live'), plannedSessionId: 'p2' },
        pastStartFor('2026-10-13', NOW),
      ),
      { rpe: 7, durationMin: 55 },
      NOW,
    )
    const entry = finishedLog(session)
    expect(entry.plannedSessionId).toBe('p2')
    expect(entry.startedAt).toBe(iso(at(13, 18)))
    expect(planAdherence(planned, [entry], '2026-10-15')).toMatchObject({
      done: 2,
      due: 2,
      pct: 100,
    })
  })
})

describe('sin conexión: la cola conserva la fecha elegida', () => {
  beforeEach(async () => {
    await __resetIdbForTests()
    __resetActiveSessionForTests()
  })

  it('entreno pasado → guardar → la cola lleva su fecha y la planificada', async () => {
    const prepared = asPastSession(
      { ...strengthSession('live'), plannedSessionId: 'p2' },
      at(13, 18),
    )
    const { started } = await startPreparedSession(prepared)
    expect(started).toBe(true)
    expect(getActiveSession()?.mode).toBe('past')
    updateActiveSession((s) => s)
    const saved = await finishActiveSession({ rpe: 7, durationMin: 40 })
    await __waitForWrites()
    expect(saved?.startedAt).toBe(iso(at(13, 18)))
    const [item] = await listOutbox('u1')
    expect(item?.kind).toBe('save')
    if (item?.kind !== 'save') return
    expect(item.payload.session.started_at).toBe(iso(at(13, 18)))
    expect(item.payload.session.ended_at).toBe(iso(at(13, 18, 40)))
    expect(item.payload.session.planned_session_id).toBe('p2')
  })

  it('cambiar la fecha encola la sesión con la nueva fecha y otra versión', async () => {
    const saved = finishSession(
      strengthSession('live', at(8, 18)),
      { rpe: 7, durationMin: 60 },
      at(8, 19),
    )
    const moved = await rescheduleSession(saved, iso(at(13, 7, 30)))
    await __waitForWrites()
    const [item] = await listOutbox('u1')
    if (item?.kind !== 'save') throw new Error('sin guardado en la cola')
    expect(item.payload.session.started_at).toBe(iso(at(13, 7, 30)))
    expect(item.payload.session.ended_at).toBe(iso(at(13, 8, 30)))
    expect(item.rev).toBe(moved.rev)
    expect(moved.rev).toBeGreaterThan(saved.rev)
  })
})
