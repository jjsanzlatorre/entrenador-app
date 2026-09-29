import { describe, expect, it } from 'vitest'
import { wrapText } from './card'
import { achievementCard, leadingEmoji, recordCard, weekCard } from './cards'
import type { WeekAdherence } from '@/lib/progress/adherence'

const measure = (s: string) => s.length * 10

describe('wrapText', () => {
  it('parte por palabras sin pasarse del ancho', () => {
    expect(wrapText('uno dos tres cuatro', 80, measure)).toEqual(['uno dos', 'tres', 'cuatro'])
  })
  it('recorta con … si hay demasiadas líneas', () => {
    const lines = wrapText('a b c d e f g h', 10, measure, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
  })
})

describe('tarjetas', () => {
  it('logro', () => {
    const c = achievementCard({
      period: 'month',
      title: '🏊 Natación',
      emoji: leadingEmoji('🏊 Natación'),
      value: '12,3 km',
      phrase: null,
    })
    expect(c).toMatchObject({ kind: 'achievement', emoji: '🏊', eyebrow: 'Mis logros · este mes' })
  })
  it('semana completada con extra y racha', () => {
    const week = {
      weekStart: '2026-09-21',
      committed: 3,
      counted: 3,
      extra: 1,
      pct: 1,
    } as WeekAdherence
    const c = weekCard(week, 4)
    expect(c.value).toBe('4 de 3 sesiones')
    expect(c.detail).toBe('Racha de 4 semanas seguidas')
    expect(c.emoji).toBe('🔥')
  })
  it('récord sin datos personales', () => {
    const c = recordCard(
      {
        id: 'r',
        exerciseId: 'bench_press',
        prType: 'max_weight',
        value: 100,
        unit: 'kg',
        weightKg: 100,
        previousValue: 95,
        sessionId: 's',
        achievedAt: '2026-09-29',
      },
      'Press banca',
    )
    expect(c).toMatchObject({ headline: 'Press banca', value: '100 kg' })
    expect(c.detail).toContain('antes 95 kg')
  })
})
