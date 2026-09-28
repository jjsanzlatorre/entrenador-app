import { describe, expect, it } from 'vitest'
import { formatClock, formatKg, parseClock, parseDecimal } from './format'

describe('formato', () => {
  it('acepta coma decimal', () => {
    expect(parseDecimal('62,5')).toBe(62.5)
    expect(parseDecimal(' 80 ')).toBe(80)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('-5')).toBeNull()
  })
  it('muestra kg en formato español', () => {
    expect(formatKg(62.5)).toBe('62,5')
    expect(formatKg(null)).toBe('—')
  })
  it('reloj', () => {
    expect(formatClock(95)).toBe('1:35')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(parseClock('1:30')).toBe(90)
    expect(parseClock('45')).toBe(45)
  })
})
