// Formulario de la herramienta «Cronómetro»: los campos como texto (parser único de cantidades)
// ⇄ configuración del temporizador. También las favoritas y la ejecución en curso, guardadas en
// el dispositivo.
import { formatDurationInput, parseCount, parseDuration } from '@/lib/input/quantity'
import {
  MAX_ROUNDS,
  MAX_SEQUENCE_STEPS,
  type SequenceStep,
  type ToolRun,
  type ToolTimerConfig,
  type ToolTimerKind,
} from './tool-timer'

export type StepForm = { kind: 'work' | 'rest'; label: string; duration: string }

export type ToolForm = {
  kind: ToolTimerKind
  countdown: string
  emomMinutes: string
  emomEvery: string
  amrap: string
  tabataWork: string
  tabataRest: string
  tabataRounds: string
  rounds: string
  steps: StepForm[]
}

export const DEFAULT_TOOL_FORM: ToolForm = {
  kind: 'emom',
  countdown: '5',
  emomMinutes: '10',
  emomEvery: '60',
  amrap: '12',
  tabataWork: '20',
  tabataRest: '10',
  tabataRounds: '8',
  rounds: '5',
  steps: [
    { kind: 'work', label: 'Trabajo', duration: '40' },
    { kind: 'rest', label: 'Descanso', duration: '20' },
  ],
}

// Números sueltos: minutos en la cuenta atrás y el AMRAP; segundos en EMOM («cada»), Tabata e
// intervalos.
export function formToConfig(form: ToolForm): ToolTimerConfig | null {
  const min = (v: string) => parseDuration(v, 'min')
  const sec = (v: string) => parseDuration(v, 's')
  switch (form.kind) {
    case 'free':
      return { kind: 'free' }
    case 'countdown': {
      const d = min(form.countdown)
      return d ? { kind: 'countdown', durationS: d } : null
    }
    case 'emom': {
      const minutes = parseCount(form.emomMinutes)
      const every = sec(form.emomEvery)
      return minutes && every && minutes <= 120 ? { kind: 'emom', minutes, intervalS: every } : null
    }
    case 'amrap': {
      const d = min(form.amrap)
      return d ? { kind: 'amrap', durationS: d } : null
    }
    case 'tabata': {
      const workS = sec(form.tabataWork)
      const restS = sec(form.tabataRest)
      const rounds = parseCount(form.tabataRounds)
      return workS && restS !== null && rounds && rounds <= MAX_ROUNDS
        ? { kind: 'tabata', workS, restS, rounds }
        : null
    }
    case 'sequence': {
      const rounds = parseCount(form.rounds)
      if (!rounds || rounds > MAX_ROUNDS) return null
      const steps: SequenceStep[] = []
      for (const s of form.steps.slice(0, MAX_SEQUENCE_STEPS)) {
        const d = sec(s.duration)
        if (!d) return null
        steps.push({ kind: s.kind, durationS: d, label: s.label.trim().slice(0, 40) })
      }
      return steps.length > 0 ? { kind: 'sequence', rounds, steps } : null
    }
  }
}

export function configToForm(config: ToolTimerConfig, base: ToolForm = DEFAULT_TOOL_FORM) {
  const min = (s: number) => formatDurationInput(s, 'min')
  const sec = (s: number) => formatDurationInput(s, 's')
  switch (config.kind) {
    case 'free':
      return { ...base, kind: 'free' as const }
    case 'countdown':
      return { ...base, kind: 'countdown' as const, countdown: min(config.durationS) }
    case 'emom':
      return {
        ...base,
        kind: 'emom' as const,
        emomMinutes: String(config.minutes),
        emomEvery: sec(config.intervalS),
      }
    case 'amrap':
      return { ...base, kind: 'amrap' as const, amrap: min(config.durationS) }
    case 'tabata':
      return {
        ...base,
        kind: 'tabata' as const,
        tabataWork: sec(config.workS),
        tabataRest: sec(config.restS),
        tabataRounds: String(config.rounds),
      }
    case 'sequence':
      return {
        ...base,
        kind: 'sequence' as const,
        rounds: String(config.rounds),
        steps: config.steps.map((s) => ({
          kind: s.kind,
          label: s.label,
          duration: sec(s.durationS),
        })),
      }
    default:
      return base
  }
}

// ── En el dispositivo ───────────────────────────────────────

export type TimerFavorite = { id: string; name: string; config: ToolTimerConfig }

const favoritesKey = (userId: string) => `entrenador:timer-favorites:${userId}`
const runKey = (userId: string) => `entrenador:tool-run:${userId}`

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sin almacenamiento: solo dura mientras la pantalla está abierta
  }
}

export function loadFavorites(userId: string): TimerFavorite[] {
  const list = readJson<TimerFavorite[]>(favoritesKey(userId))
  return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string' && f.config) : []
}

export function saveFavorites(userId: string, list: TimerFavorite[]) {
  writeJson(favoritesKey(userId), list.slice(0, 30))
}

// La ejecución en curso sobrevive a recargar o cerrar la app (todo son timestamps).
export function loadToolRun(userId: string): ToolRun | null {
  const run = readJson<ToolRun>(runKey(userId))
  return run && run.config && run.timer ? run : null
}

export function saveToolRun(userId: string, run: ToolRun | null) {
  writeJson(runKey(userId), run)
}
