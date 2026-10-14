import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  createTimerState,
  finishTimer,
  PREP_MS,
  startTimer,
  timerView,
  togglePause,
  workElapsedMs,
} from './timer'
import { timerDisplay } from './timer-display'
import { configToForm, DEFAULT_TOOL_FORM, formToConfig } from './tool-form'
import {
  buildToolSchedule,
  createToolSession,
  describeToolTimer,
  toolConfigProblem,
  toolResultText,
  type ToolTimerConfig,
} from './tool-timer'

const T0 = 1_760_000_000_000

function displayAt(
  config: ToolTimerConfig,
  ms: number,
  exercises = [{ name: 'Swing', targetReps: 15 }],
) {
  const schedule = buildToolSchedule(config)
  const timer = startTimer(createTimerState(), T0)
  const view = timerView(schedule, timer, T0 + ms)
  return timerDisplay({
    config,
    schedule,
    view,
    workElapsedMs: workElapsedMs(schedule, timer, T0 + ms),
    exercises,
  })
}

describe('presentación del temporizador', () => {
  it('EMOM: minuto actual, ejercicio actual y siguiente, progreso', () => {
    const emom: ToolTimerConfig = { kind: 'emom', minutes: 12, intervalS: 60 }
    const ex = [
      { name: 'Swing', targetReps: 15 },
      { name: 'Burpee', targetReps: 10 },
    ]
    const prep = displayAt(emom, 2_000, ex)
    expect(prep).toMatchObject({ phase: 'prep', title: 'Prepárate', clock: '0:08' })
    expect(prep.next).toBe('15 × Swing')

    const d = displayAt(emom, PREP_MS + 4 * 60_000 + 30_000, ex)
    expect(d).toMatchObject({
      phase: 'work',
      title: 'Minuto 5 de 12',
      counter: 'Minuto 5/12',
      clock: '0:30',
      current: '15 × Swing',
      next: '10 × Burpee',
      warn: false,
    })
    expect(d.progress).toBeCloseTo(0.5)
    expect(d.totalProgress).toBeCloseTo((PREP_MS + 270_000) / (PREP_MS + 720_000))
    expect(displayAt(emom, PREP_MS + 58_500, ex).warn).toBe(true)
  })

  it('Tabata: en el descanso enseña el siguiente ejercicio', () => {
    const d = displayAt({ kind: 'tabata', workS: 20, restS: 10, rounds: 8 }, PREP_MS + 25_000)
    expect(d).toMatchObject({
      phase: 'rest',
      counter: 'Ronda 1/8',
      current: null,
      next: '15 × Swing',
    })
  })

  it('AMRAP: tiempo total restante', () => {
    const d = displayAt({ kind: 'amrap', durationS: 600 }, PREP_MS + 60_000)
    expect(d).toMatchObject({ phase: 'work', clock: '9:00', counter: 'AMRAP' })
  })

  it('cronómetro libre: ascendente y sin progreso', () => {
    const schedule = buildSchedule({ kind: 'free' })
    const timer = startTimer(createTimerState(), T0)
    const view = timerView(schedule, timer, T0 + 75_000)
    const d = timerDisplay({
      config: { kind: 'free' },
      schedule,
      view,
      workElapsedMs: workElapsedMs(schedule, timer, T0 + 75_000),
      exercises: [],
    })
    expect(d).toMatchObject({ clock: '1:15', open: true, progress: null, warn: false })
  })

  it('intervalos personalizados: nombre de cada fase y la siguiente', () => {
    const seq: ToolTimerConfig = {
      kind: 'sequence',
      rounds: 3,
      steps: [
        { kind: 'work', durationS: 40, label: 'Sentadilla' },
        { kind: 'rest', durationS: 20, label: '' },
        { kind: 'work', durationS: 30, label: 'Flexiones' },
        { kind: 'rest', durationS: 30, label: 'Descanso largo' },
      ],
    }
    const schedule = buildToolSchedule(seq)
    // prep + 3 × 4 fases − el descanso final.
    expect(schedule).toHaveLength(1 + 12 - 1)
    expect(schedule.at(-1)).toMatchObject({ kind: 'work', label: 'Flexiones', round: 3 })
    const d = displayAt(seq, PREP_MS + 45_000, [])
    expect(d).toMatchObject({
      phase: 'rest',
      title: 'Descanso · ronda 1 de 3',
      current: 'Descanso',
      next: 'Flexiones · 0:30',
      clock: '0:15',
    })
  })

  it('cuenta atrás', () => {
    const d = displayAt({ kind: 'countdown', durationS: 300 }, PREP_MS + 61_000, [])
    expect(d).toMatchObject({ title: 'Cuenta atrás', clock: '3:59' })
  })
})

describe('formulario y favoritos de la herramienta', () => {
  it('parser único: minutos en cuenta atrás y AMRAP, segundos en EMOM, Tabata e intervalos', () => {
    expect(formToConfig({ ...DEFAULT_TOOL_FORM, kind: 'countdown', countdown: '5' })).toEqual({
      kind: 'countdown',
      durationS: 300,
    })
    expect(formToConfig({ ...DEFAULT_TOOL_FORM, kind: 'amrap', amrap: '12:30' })).toEqual({
      kind: 'amrap',
      durationS: 750,
    })
    expect(
      formToConfig({ ...DEFAULT_TOOL_FORM, kind: 'emom', emomMinutes: '10', emomEvery: '1:30' }),
    ).toEqual({ kind: 'emom', minutes: 10, intervalS: 90 })
    expect(formToConfig({ ...DEFAULT_TOOL_FORM, kind: 'tabata' })).toEqual({
      kind: 'tabata',
      workS: 20,
      restS: 10,
      rounds: 8,
    })
    expect(formToConfig({ ...DEFAULT_TOOL_FORM, kind: 'emom', emomMinutes: 'diez' })).toBeNull()
    expect(
      formToConfig({
        ...DEFAULT_TOOL_FORM,
        kind: 'sequence',
        rounds: '4',
        steps: [
          { kind: 'work', label: 'Remo', duration: '1:00' },
          { kind: 'rest', label: '', duration: '30' },
        ],
      }),
    ).toEqual({
      kind: 'sequence',
      rounds: 4,
      steps: [
        { kind: 'work', durationS: 60, label: 'Remo' },
        { kind: 'rest', durationS: 30, label: '' },
      ],
    })
  })

  it('ida y vuelta configuración ⇄ formulario', () => {
    const configs: ToolTimerConfig[] = [
      { kind: 'free' },
      { kind: 'countdown', durationS: 90 },
      { kind: 'emom', minutes: 12, intervalS: 60 },
      { kind: 'amrap', durationS: 600 },
      { kind: 'tabata', workS: 30, restS: 15, rounds: 6 },
      {
        kind: 'sequence',
        rounds: 2,
        steps: [
          { kind: 'work', durationS: 45, label: 'A' },
          { kind: 'rest', durationS: 15, label: 'B' },
        ],
      },
    ]
    for (const c of configs) expect(formToConfig(configToForm(c))).toEqual(c)
  })

  it('problemas de configuración', () => {
    expect(toolConfigProblem({ kind: 'sequence', rounds: 2, steps: [] })).toBeTruthy()
    expect(
      toolConfigProblem({
        kind: 'sequence',
        rounds: 2,
        steps: [{ kind: 'rest', durationS: 10, label: '' }],
      }),
    ).toMatch(/trabajo/)
    expect(toolConfigProblem({ kind: 'emom', minutes: 10, intervalS: 60 })).toBeNull()
    expect(describeToolTimer({ kind: 'emom', minutes: 10, intervalS: 60 })).toBe('EMOM 10 min')
  })
})

describe('guardar como sesión', () => {
  it('EMOM de 10 min terminado: sesión con su bloque, resultado y duración sin la cuenta atrás', () => {
    const config: ToolTimerConfig = { kind: 'emom', minutes: 10, intervalS: 60 }
    const end = T0 + PREP_MS + 600_000
    let timer = startTimer(createTimerState(), T0)
    timer = finishTimer(timer, end)
    const run = { config, timer, amrap: { rounds: 0, extraReps: 0 } }
    expect(toolResultText(run, end)).toBe('10 de 10 minutos')
    let n = 0
    const s = createToolSession(
      'u1',
      run,
      { sessionType: 'functional', title: '', rpe: 7, notes: null },
      end + 5_000,
      () => `id${n++}`,
    )
    expect(s).toMatchObject({
      sessionType: 'functional',
      title: 'EMOM 10 min',
      durationMin: 10,
      rpe: 7,
      startedAt: new Date(T0 + PREP_MS).toISOString(),
      endedAt: new Date(end).toISOString(),
    })
    expect(s.blocks[0]).toMatchObject({
      blockType: 'emom',
      settings: config,
      result: { kind: 'emom', minutes: 10, minutesCompleted: 10 },
    })
  })

  it('las pausas no cuentan y el AMRAP guarda sus rondas', () => {
    const config: ToolTimerConfig = { kind: 'amrap', durationS: 300 }
    let timer = startTimer(createTimerState(), T0, true)
    timer = togglePause(timer, T0 + 60_000)
    timer = togglePause(timer, T0 + 120_000)
    timer = finishTimer(timer, T0 + 180_000)
    const run = { config, timer, amrap: { rounds: 4, extraReps: 3 } }
    const s = createToolSession(
      'u1',
      run,
      { sessionType: 'other', title: 'Mi AMRAP', rpe: null, notes: 'Burpees y sentadillas' },
      T0 + 200_000,
    )
    expect(s.durationMin).toBe(2)
    expect(s.blocks[0]!.result).toEqual({ kind: 'amrap', durationS: 300, rounds: 4, extraReps: 3 })
    expect(s.notes).toBe('Burpees y sentadillas')
  })

  it('intervalos personalizados y cuenta atrás se guardan como cronómetro con el tiempo', () => {
    const config: ToolTimerConfig = {
      kind: 'sequence',
      rounds: 1,
      steps: [{ kind: 'work', durationS: 90, label: 'A' }],
    }
    const timer = finishTimer(startTimer(createTimerState(), T0, true), T0 + 90_000)
    const s = createToolSession(
      'u1',
      { config, timer, amrap: { rounds: 0, extraReps: 0 } },
      { sessionType: 'other', title: '', rpe: null, notes: null },
      T0 + 95_000,
    )
    expect(s.blocks[0]).toMatchObject({ blockType: 'free', result: { kind: 'free', elapsedS: 90 } })
    expect(s.durationMin).toBe(2)
  })
})
