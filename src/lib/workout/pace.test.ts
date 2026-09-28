import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  formatPace,
  kmPerHour,
  paceKindForExercise,
  paceKindForSession,
  secondsPer100m,
  secondsPerKm,
} from './pace'

describe('ritmos', () => {
  it('carrera en min/km', () => {
    expect(secondsPerKm(10_000, 50 * 60)).toBe(300)
    expect(formatPace('run', 400, 98)).toBe('4:05 min/km')
    expect(formatPace('run', 5000, 25 * 60 + 30)).toBe('5:06 min/km')
  })

  it('natación en min/100 m', () => {
    expect(secondsPer100m(1500, 30 * 60)).toBe(120)
    expect(formatPace('swim', 100, 112)).toBe('1:52 min/100 m')
  })

  it('bici en km/h', () => {
    expect(kmPerHour(30_000, 3600)).toBe(30)
    expect(formatPace('bike', 20_000, 42 * 60)).toBe('28,6 km/h')
  })

  it('sin distancia o tiempo no hay ritmo', () => {
    expect(formatPace('run', null, 100)).toBeNull()
    expect(formatPace('run', 1000, 0)).toBeNull()
    expect(secondsPerKm(0, 100)).toBeNull()
  })

  it('tipo de ritmo por ejercicio y por sesión', () => {
    expect(paceKindForExercise('run')).toBe('run')
    expect(paceKindForExercise('swim_breaststroke')).toBe('swim')
    expect(paceKindForExercise('spinning')).toBe('bike')
    expect(paceKindForExercise('bench_press')).toBeNull()
    expect(paceKindForSession('cycling')).toBe('bike')
    expect(paceKindForSession('strength')).toBeNull()
  })

  it('distancias', () => {
    expect(formatDistance(800)).toBe('800 m')
    expect(formatDistance(5230)).toBe('5,23 km')
    expect(formatDistance(1500, 'swim')).toBe('1500 m')
  })
})
