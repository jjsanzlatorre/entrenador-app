// Herramienta «Cronómetro» (sin sesión): los temporizadores de los bloques (EMOM, AMRAP, Tabata,
// cronómetro…) más cuenta atrás e intervalos personalizados con varias fases. Usa el mismo motor
// basado en timestamps (timer.ts).
import type { SessionType } from '@/types/database'
import { formatClock } from './format'
import { createSession, type IdFn } from './session-ops'
import {
  buildSchedule,
  elapsedMs,
  PREP_MS,
  timerView,
  workElapsedMs,
  type Phase,
  type TimerConfig,
  type TimerState,
} from './timer'
import type { BlockResult, LocalBlock, LocalSession } from './types'

export type SequenceStep = { kind: 'work' | 'rest'; durationS: number; label: string }

export type ToolTimerConfig =
  | TimerConfig
  | { kind: 'countdown'; durationS: number }
  | { kind: 'sequence'; rounds: number; steps: SequenceStep[] }

export type ToolTimerKind = 'free' | 'countdown' | 'emom' | 'amrap' | 'tabata' | 'sequence'

export const TOOL_KIND_LABELS: Record<ToolTimerKind, string> = {
  free: 'Cronómetro',
  countdown: 'Cuenta atrás',
  emom: 'EMOM',
  amrap: 'AMRAP',
  tabata: 'Tabata',
  sequence: 'Intervalos',
}

export const MAX_SEQUENCE_STEPS = 12
export const MAX_ROUNDS = 99

// Fase con su nombre (en los intervalos personalizados) e índice del paso.
export type ToolPhase = Phase & { label?: string; step?: number }

export function buildToolSchedule(config: ToolTimerConfig): ToolPhase[] {
  const prep: ToolPhase = { kind: 'prep', durationMs: PREP_MS, round: 0 }
  switch (config.kind) {
    case 'countdown':
      return [prep, { kind: 'work', durationMs: config.durationS * 1000, round: 1 }]
    case 'sequence': {
      const phases: ToolPhase[] = []
      for (let r = 1; r <= config.rounds; r++)
        config.steps.forEach((step, i) =>
          phases.push({
            kind: step.kind,
            durationMs: step.durationS * 1000,
            round: r,
            label: step.label,
            step: i,
          }),
        )
      // Un descanso al final no sirve de nada.
      while (phases.length > 0 && phases.at(-1)!.kind === 'rest') phases.pop()
      return [prep, ...phases]
    }
    default:
      return buildSchedule(config)
  }
}

export function describeToolTimer(config: ToolTimerConfig) {
  switch (config.kind) {
    case 'free':
      return 'Cronómetro'
    case 'countdown':
      return `Cuenta atrás de ${formatClock(config.durationS)}`
    case 'emom':
      return config.intervalS === 60
        ? `EMOM ${config.minutes} min`
        : `EMOM ${config.minutes} × ${formatClock(config.intervalS)}`
    case 'amrap':
      return `AMRAP ${formatClock(config.durationS)}`
    case 'tabata':
      return `Tabata ${config.workS}/${config.restS} s × ${config.rounds}`
    case 'for_time':
      return config.capS ? `For Time (cap ${formatClock(config.capS)})` : 'For Time'
    case 'intervals':
      return `Intervalos × ${config.reps}`
    case 'sequence':
      return `Intervalos: ${config.steps
        .map(
          (s) =>
            `${s.label || (s.kind === 'work' ? 'trabajo' : 'descanso')} ${formatClock(s.durationS)}`,
        )
        .join(' + ')} × ${config.rounds}`
  }
}

// Comprueba que la configuración se puede poner en marcha.
export function toolConfigProblem(config: ToolTimerConfig): string | null {
  switch (config.kind) {
    case 'countdown':
      return config.durationS > 0 ? null : 'Pon cuánto dura la cuenta atrás.'
    case 'emom':
      return config.minutes > 0 && config.intervalS > 0 ? null : 'Pon minutos y cada cuánto.'
    case 'amrap':
      return config.durationS > 0 ? null : 'Pon cuánto dura el AMRAP.'
    case 'tabata':
      return config.workS > 0 && config.rounds > 0 ? null : 'Pon trabajo y rondas.'
    case 'sequence':
      if (config.rounds < 1 || config.rounds > MAX_ROUNDS) return 'Pon entre 1 y 99 rondas.'
      if (config.steps.length === 0) return 'Añade al menos una fase.'
      if (config.steps.some((s) => !(s.durationS > 0))) return 'Cada fase necesita una duración.'
      if (!config.steps.some((s) => s.kind === 'work')) return 'Añade al menos una fase de trabajo.'
      return null
    default:
      return null
  }
}

// ── Resultado y «Guardar como sesión» ───────────────────────

export type ToolRun = {
  config: ToolTimerConfig
  timer: TimerState
  // AMRAP: rondas y reps sueltas apuntadas.
  amrap: { rounds: number; extraReps: number }
}

// Tiempo real del ejercicio (sin la cuenta atrás inicial) e inicio real.
export function toolRunTimes(run: ToolRun, now: number) {
  const schedule = buildToolSchedule(run.config)
  const elapsed = elapsedMs(run.timer, now)
  const prepUsed =
    schedule[0]?.kind === 'prep' ? Math.min(elapsed, run.timer.overrides[0] ?? PREP_MS) : 0
  const durationS = Math.max(0, Math.round((elapsed - prepUsed) / 1000))
  const startedAt = (run.timer.startedAt ?? now) + prepUsed
  return { durationS, startedAt, workS: Math.round(workElapsedMs(schedule, run.timer, now) / 1000) }
}

export function toolResult(run: ToolRun, now: number): BlockResult {
  const schedule = buildToolSchedule(run.config)
  const view = timerView(schedule, run.timer, now)
  const { durationS, workS } = toolRunTimes(run, now)
  const c = run.config
  switch (c.kind) {
    case 'emom':
      return { kind: 'emom', minutes: c.minutes, minutesCompleted: view.completedWorkPhases }
    case 'tabata':
      return { kind: 'tabata', rounds: c.rounds, roundsCompleted: view.completedWorkPhases }
    case 'amrap':
      return {
        kind: 'amrap',
        durationS: c.durationS,
        rounds: run.amrap.rounds,
        extraReps: run.amrap.extraReps,
      }
    case 'free':
    case 'countdown':
      return { kind: 'free', elapsedS: workS }
    default:
      return { kind: 'free', elapsedS: durationS }
  }
}

export function toolResultText(run: ToolRun, now: number) {
  const r = toolResult(run, now)
  const { durationS } = toolRunTimes(run, now)
  switch (r.kind) {
    case 'emom':
      return `${r.minutesCompleted} de ${r.minutes} minutos`
    case 'tabata':
      return `${r.roundsCompleted} de ${r.rounds} rondas`
    case 'amrap':
      return `${r.rounds} rondas${r.extraReps ? ` + ${r.extraReps} reps` : ''}`
    default:
      return formatClock(r.kind === 'free' ? r.elapsedS : durationS)
  }
}

export type ToolSessionInput = {
  sessionType: SessionType
  title: string
  rpe: number | null
  notes: string | null
}

// Sesión ya terminada con un bloque del temporizador (EMOM, AMRAP y Tabata con su resultado; el
// resto como cronómetro con el tiempo), lista para guardar y sincronizar.
export function createToolSession(
  userId: string,
  run: ToolRun,
  input: ToolSessionInput,
  now: number,
  newId: IdFn = () => crypto.randomUUID(),
): LocalSession {
  const { durationS, startedAt } = toolRunTimes(run, now)
  const result = toolResult(run, now)
  const settings: TimerConfig =
    run.config.kind === 'emom' || run.config.kind === 'amrap' || run.config.kind === 'tabata'
      ? run.config
      : { kind: 'free' }
  const block: LocalBlock = {
    id: newId(),
    order: 0,
    blockType: settings.kind,
    exercises: [],
    sets: [],
    settings,
    result,
  }
  const durationMin = Math.max(1, Math.round(durationS / 60))
  const base = createSession(
    userId,
    now,
    newId,
    input.title.trim() || describeToolTimer(run.config),
    input.sessionType,
    input.sessionType === 'swimming'
      ? 'pool'
      : ['running', 'cycling'].includes(input.sessionType)
        ? 'outdoor'
        : 'gym',
  )
  return {
    ...base,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + durationS * 1000).toISOString(),
    durationMin,
    rpe: input.rpe,
    notes: input.notes?.trim() || describeToolTimer(run.config),
    blocks: [block],
  }
}
