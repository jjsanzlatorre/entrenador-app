// Imagen para compartir (fase 7B): tarjeta vertical PNG (1080 × 1920, formato historia) de un
// logro, una semana completada o un récord. Solo lleva lo que se ve en la tarjeta: nunca medidas,
// fotos, notas ni nombres de otras personas.
import { downloadBlob } from '@/lib/export/files'

export type ShareCardKind = 'achievement' | 'week' | 'record'

export type ShareCard = {
  kind: ShareCardKind
  emoji: string
  // Línea pequeña de arriba («Mis logros · este mes», «Nuevo récord»…).
  eyebrow: string
  headline: string
  // Dato grande («312 km», «100 kg × 5»).
  value: string
  detail?: string
}

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1920

const THEMES: Record<ShareCardKind, [string, string]> = {
  achievement: ['#1e3a8a', '#2563eb'],
  week: ['#065f46', '#059669'],
  record: ['#78350f', '#d97706'],
}

// Parte un texto en líneas que caben en `maxWidth` (con la función de medida del canvas).
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = 4,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth || !line) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]!
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.trimEnd()}…`
  return kept
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export function drawShareCard(ctx: CanvasRenderingContext2D, card: ShareCard) {
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  const [from, to] = THEMES[card.kind]
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, from)
  bg.addColorStop(1, to)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Círculos suaves de fondo.
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  for (const [x, y, r] of [
    [W * 0.9, H * 0.12, 260],
    [W * 0.1, H * 0.85, 320],
    [W * 0.75, H * 0.7, 140],
  ] as const) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'

  ctx.font = `600 52px ${FONT}`
  ctx.globalAlpha = 0.85
  ctx.fillText(card.eyebrow.toUpperCase(), W / 2, 300)
  ctx.globalAlpha = 1

  ctx.font = `300px ${FONT}`
  ctx.fillText(card.emoji, W / 2, 720)

  ctx.font = `800 132px ${FONT}`
  const valueLines = wrapText(card.value, W - 140, (s) => ctx.measureText(s).width, 2)
  let y = 960
  for (const l of valueLines) {
    ctx.fillText(l, W / 2, y)
    y += 150
  }

  ctx.font = `700 68px ${FONT}`
  const head = wrapText(card.headline, W - 160, (s) => ctx.measureText(s).width, 5)
  y += 40
  for (const l of head) {
    ctx.fillText(l, W / 2, y)
    y += 88
  }

  if (card.detail) {
    ctx.font = `400 50px ${FONT}`
    ctx.globalAlpha = 0.9
    const detail = wrapText(card.detail, W - 180, (s) => ctx.measureText(s).width, 3)
    y += 30
    for (const l of detail) {
      ctx.fillText(l, W / 2, y)
      y += 66
    }
    ctx.globalAlpha = 1
  }

  ctx.font = `700 46px ${FONT}`
  ctx.globalAlpha = 0.8
  ctx.fillText('💪 Entrenador', W / 2, H - 140)
  ctx.globalAlpha = 1
}

export async function renderShareCard(card: ShareCard): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('este navegador no puede generar la imagen')
  drawShareCard(ctx, card)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('no se ha podido generar'))),
      'image/png',
    ),
  )
}

export function shareFileName(card: ShareCard, now = new Date()) {
  return `entrenador-${card.kind}-${now.toISOString().slice(0, 10)}.png`
}

// Hoja de compartir nativa si admite archivos; si no, descarga. Devuelve lo que se hizo.
export async function shareOrDownload(
  blob: Blob,
  card: ShareCard,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = shareFileName(card)
  const file = new File([blob], name, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: card.headline })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Otros errores (p. ej. sin gesto de usuario): se descarga.
    }
  }
  downloadBlob(blob, name)
  return 'downloaded'
}
