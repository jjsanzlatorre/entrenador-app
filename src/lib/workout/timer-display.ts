// Qué se enseña de un temporizador en marcha (tarjeta del bloque y pantalla completa): título,
// reloj, ronda o minuto, ejercicio actual y siguiente y progreso. Puro, a partir de la vista del
// motor (timer.ts).
import { formatClock } from './format'
import { formatDistance } from './pace'
import type { TimerView } from './timer'
import type { ToolPhase, ToolTimerConfig } from './tool-timer'

export type DisplayExercise = { name: string; targetReps?: number | null }

export type TimerDisplay = {
  phase: 'prep' | 'work' | 'rest' | 'done'
  // «Minuto 5 de 12», «Trabajo · ronda 3 de 8»…
  title: string
  // Contador grande para la pantalla completa: «Minuto 5/12».
  counter: string | null
  clock: string
  // Fase abierta (cronómetro ascendente): sin +15 s ni barra de fase.
  open: boolean
  // Últimos 3 s de una fase con cuenta atrás.
  warn: boolean
  current: string | null
  next: string | null
  // Progreso de la fase (0–1) y del total; null si no se puede saber.
  progress: number | null
  totalProgress: number | null
}

const exerciseText = (e: DisplayExercise | undefined) =>
  e ? `${e.targetReps ? `${e.targetReps} × ` : ''}${e.name}` : null

const at = (list: DisplayExercise[], round: number) =>
  list.length > 0 ? list[(Math.max(1, round) - 1) % list.length] : undefined

export function timerDisplay({
  config,
  schedule,
  view,
  workElapsedMs,
  exercises,
}: {
  config: ToolTimerConfig
  schedule: ToolPhase[]
  view: TimerView
  workElapsedMs: number
  exercises: DisplayExercise[]
}): TimerDisplay {
  const phase = view.phase
  const kind = view.status === 'done' || !phase ? 'done' : phase.kind
  const prep = kind === 'prep'
  const rest = kind === 'rest'
  const round = phase?.round ?? 0
  const open = !Number.isFinite(view.phaseRemainingMs)
  const phaseDuration = view.phaseElapsedMs + view.phaseRemainingMs
  const progress =
    open || kind === 'done'
      ? null
      : phaseDuration > 0
        ? Math.min(1, Math.max(0, view.phaseElapsedMs / phaseDuration))
        : null
  const totalProgress = Number.isFinite(view.totalMs)
    ? Math.min(1, Math.max(0, view.elapsedMs / view.totalMs))
    : null

  let clock = open
    ? formatClock(view.phaseElapsedMs / 1000)
    : formatClock(Math.ceil(view.phaseRemainingMs / 1000))
  let title = prep ? 'Prepárate' : rest ? 'Descanso' : 'Trabajo'
  let counter: string | null = null
  let current: string | null = null
  let next: string | null = null
  const all = exercises.map(exerciseText).filter(Boolean).join(' · ') || null

  switch (config.kind) {
    case 'emom':
      if (!prep) {
        title = `Minuto ${round} de ${config.minutes}`
        counter = `Minuto ${round}/${config.minutes}`
        current = exerciseText(at(exercises, round))
        if (exercises.length > 1 && round < config.minutes)
          next = exerciseText(at(exercises, round + 1))
      } else next = exerciseText(at(exercises, 1))
      break
    case 'amrap':
      if (!prep) {
        title = 'Tiempo restante'
        counter = 'AMRAP'
        clock = formatClock(Math.ceil(view.totalRemainingMs / 1000))
        current = all
      } else next = all
      break
    case 'tabata':
      if (!prep) {
        title = `${rest ? 'Descanso' : 'Trabajo'} · ronda ${round} de ${config.rounds}`
        counter = `Ronda ${round}/${config.rounds}`
        if (rest) next = round < config.rounds ? exerciseText(at(exercises, round + 1)) : null
        else current = exerciseText(at(exercises, round))
      } else next = exerciseText(at(exercises, 1))
      break
    case 'for_time':
      if (!prep) {
        title = config.capS ? `Tiempo (cap ${formatClock(config.capS)})` : 'Tiempo'
        counter = 'For Time'
        clock = formatClock(workElapsedMs / 1000)
        current = all
      } else next = all
      break
    case 'intervals': {
      const target = config.workDistanceM
        ? formatDistance(config.workDistanceM)
        : formatClock(config.workS ?? 0)
      if (!prep) {
        title = `${rest ? 'Recuperación' : 'Serie'} ${round} de ${config.reps}${rest ? '' : ` · ${target}`}`
        counter = `Serie ${round}/${config.reps}`
        if (rest) next = round < config.reps ? `Serie ${round + 1} · ${target}` : null
        else current = `${target}${exercises[0] ? ` · ${exercises[0].name}` : ''}`
      } else next = `Serie 1 · ${target}`
      break
    }
    case 'free':
      title = 'Cronómetro'
      clock = formatClock(workElapsedMs / 1000)
      current = all
      break
    case 'countdown':
      if (!prep) title = 'Cuenta atrás'
      break
    case 'sequence': {
      const current_ = schedule[view.phaseIndex]
      const following = schedule[view.phaseIndex + 1]
      const name = (p: ToolPhase | undefined) =>
        p ? p.label || (p.kind === 'rest' ? 'Descanso' : 'Trabajo') : null
      if (!prep) {
        title = `${name(current_)} · ronda ${round} de ${config.rounds}`
        counter = `Ronda ${round}/${config.rounds}`
        current = name(current_)
      }
      next = following ? `${name(following)} · ${formatClock(following.durationMs / 1000)}` : null
      break
    }
  }

  return {
    phase: kind,
    title,
    counter,
    clock,
    open,
    warn: !open && kind !== 'done' && view.phaseRemainingMs <= 3000,
    current,
    next,
    progress,
    totalProgress,
  }
}
