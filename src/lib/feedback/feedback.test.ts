import { describe, expect, it } from 'vitest'
import { deviceSummary, feedbackAsText, type FeedbackItem } from './feedback'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

describe('resumen del dispositivo', () => {
  it('iPhone con la PWA instalada', () => {
    expect(
      deviceSummary({
        userAgent: IPHONE,
        width: 390,
        height: 844,
        pixelRatio: 3,
        standalone: true,
        language: 'es-ES',
      }),
    ).toBe('iOS 18.2 · Safari 18.2 · 390×844 @3x · PWA instalada · es-ES')
  })

  it('Android en el navegador y sin conexión', () => {
    expect(
      deviceSummary({
        userAgent: ANDROID,
        width: 412,
        height: 915,
        pixelRatio: 2.625,
        standalone: false,
        online: false,
      }),
    ).toBe('Android 14 · Chrome 130 · 412×915 @2.6x · navegador · sin conexión')
  })
})

describe('exportar como texto', () => {
  const items: FeedbackItem[] = [
    {
      id: '2',
      userId: 'u2',
      kind: 'idea',
      message: 'Poder repetir\nel último entreno',
      route: '/entrenar',
      device: 'Android 14',
      appVersion: null,
      status: 'new',
      createdAt: '2026-10-14T09:00:00Z',
    },
    {
      id: '1',
      userId: 'u1',
      kind: 'bug',
      message: 'El descanso no suena',
      route: '/entrenar/sesion',
      device: 'iOS 18.2',
      appVersion: null,
      status: 'done',
      createdAt: '2026-10-13T09:00:00Z',
    },
  ]

  it('del más antiguo al más nuevo, con ruta, dispositivo y el texto citado', () => {
    const text = feedbackAsText(items, (id) => (id === 'u1' ? 'Ana' : 'Bea'))
    expect(text.startsWith('# Feedback de la app (2 comentarios)')).toBe(true)
    expect(text.indexOf('El descanso no suena')).toBeLessThan(text.indexOf('Poder repetir'))
    expect(text).toContain('## 1. [Fallo] Hecho')
    expect(text).toContain('- Quién: Ana')
    expect(text).toContain('- Pantalla: /entrenar/sesion')
    expect(text).toContain('> Poder repetir\n> el último entreno')
  })

  it('sin comentarios', () => {
    expect(feedbackAsText([], () => '')).toBe('Sin comentarios.')
  })
})
