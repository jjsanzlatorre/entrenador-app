// Textos de la prescripción de una sesión planificada.
import type { SessionIntensity } from '@/types/database'
import type { PlanBlock, PlanExercise } from './types'

const km = (m: number) =>
  m >= 1000 ? `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km` : `${m} m`

const time = (s: number) =>
  s >= 60 ? `${Math.round((s / 60) * 10) / 10} min`.replace('.', ',') : `${s} s`

// «8-10 reps», «400 m», «30 s», «10 cal».
export function describeAmount(e: PlanExercise) {
  if (e.reps) return `${e.reps} reps`
  if (e.distance_m) return km(e.distance_m)
  if (e.duration_s) return time(e.duration_s)
  if (e.calories) return `${e.calories} cal`
  return ''
}

export function describeExercise(e: PlanExercise, name: (id: string) => string) {
  const parts = [name(e.exercise_id)]
  const amount = describeAmount(e)
  if (e.sets && amount) parts.push(`${e.sets} × ${amount}`)
  else if (e.sets) parts.push(`${e.sets} series`)
  else if (amount) parts.push(amount)
  if (e.rir !== undefined) parts.push(`RIR ${e.rir}`)
  if (e.rest_s) parts.push(`desc. ${time(e.rest_s)}`)
  return parts.join(' · ')
}

export function describeBlock(b: PlanBlock, name: (id: string) => string) {
  const list = b.exercises.map((e) => describeExercise(e, name))
  switch (b.block_type) {
    case 'emom':
      return { title: `EMOM ${b.minutes ?? 10} min`, lines: list }
    case 'amrap':
      return { title: `AMRAP ${b.minutes ?? 10} min`, lines: list }
    case 'circuit':
      return {
        title: `Circuito · ${b.rounds ?? 3} rondas${b.rest_s ? ` · desc. ${time(b.rest_s)} entre rondas` : ''}`,
        lines: list,
      }
    case 'intervals': {
      const e = b.exercises[0]!
      return {
        title: 'Series',
        lines: [
          `${name(e.exercise_id)} · ${e.sets ?? 1} × ${describeAmount(e)}${e.rest_s ? ` · rec. ${time(e.rest_s)}` : ''}`,
        ],
      }
    }
    case 'free':
      return { title: null, lines: list }
    default:
      return { title: null, lines: list }
  }
}

export const INTENSITY_LABELS: Record<SessionIntensity, string> = {
  easy: 'Suave',
  moderate: 'Media',
  hard: 'Intensa',
}
