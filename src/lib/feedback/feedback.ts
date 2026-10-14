// Feedback desde la app (usabilidad 3/3): textos, resumen del dispositivo y exportación como
// texto para pegarlo en Claude Code. Lógica pura, con tests.
import type { FeedbackKind, FeedbackStatus } from '@/types/database'

export const FEEDBACK_KINDS: { kind: FeedbackKind; label: string; emoji: string; hint: string }[] =
  [
    { kind: 'bug', label: 'Fallo', emoji: '🐞', hint: 'Algo no funciona o sale mal' },
    { kind: 'idea', label: 'Idea', emoji: '💡', hint: 'Algo que te gustaría tener' },
    { kind: 'awkward', label: 'Incómodo', emoji: '😣', hint: 'Funciona, pero cuesta o confunde' },
  ]

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Nuevo',
  done: 'Hecho',
  discarded: 'Descartado',
}

export const FEEDBACK_MAX_LENGTH = 2000

export function feedbackKindLabel(kind: FeedbackKind) {
  return FEEDBACK_KINDS.find((k) => k.kind === kind)?.label ?? kind
}

export type DeviceInfo = {
  userAgent: string
  width: number
  height: number
  pixelRatio: number
  standalone: boolean
  language?: string
  online?: boolean
}

function osOf(ua: string) {
  let m = /iPhone OS (\d+)[_.](\d+)/.exec(ua) ?? /CPU OS (\d+)[_.](\d+)/.exec(ua)
  if (m) return `iOS ${m[1]}.${m[2]}${/iPad/.test(ua) ? ' (iPad)' : ''}`
  m = /Android (\d+(?:\.\d+)?)/.exec(ua)
  if (m) return `Android ${m[1]}`
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Sistema desconocido'
}

function browserOf(ua: string) {
  let m = /(?:CriOS|Chrome)\/(\d+)/.exec(ua)
  if (m && !/Edg\//.test(ua)) return `Chrome ${m[1]}`
  m = /Edg\/(\d+)/.exec(ua)
  if (m) return `Edge ${m[1]}`
  m = /(?:FxiOS|Firefox)\/(\d+)/.exec(ua)
  if (m) return `Firefox ${m[1]}`
  m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua)
  if (m) return `Safari ${m[1]}`
  if (/Safari/.test(ua)) return 'Safari'
  return 'Navegador desconocido'
}

// «iOS 18.2 · Safari 18.2 · 390×844 @3x · PWA instalada · es-ES».
export function deviceSummary(info: DeviceInfo) {
  const ratio = Math.round(info.pixelRatio * 10) / 10
  return [
    osOf(info.userAgent),
    browserOf(info.userAgent),
    `${Math.round(info.width)}×${Math.round(info.height)} @${ratio}x`,
    info.standalone ? 'PWA instalada' : 'navegador',
    info.language,
    info.online === false ? 'sin conexión' : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 500)
}

export function currentDeviceSummary() {
  if (typeof window === 'undefined') return ''
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return deviceSummary({
    userAgent: navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio || 1,
    standalone,
    language: navigator.language,
    online: navigator.onLine,
  })
}

export type FeedbackItem = {
  id: string
  userId: string
  kind: FeedbackKind
  message: string
  route: string | null
  device: string | null
  appVersion: string | null
  status: FeedbackStatus
  createdAt: string
}

const dateText = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  })

// Texto para pegar en Claude Code: un apartado por comentario, del más antiguo al más nuevo.
export function feedbackAsText(items: FeedbackItem[], nameOf: (userId: string) => string) {
  if (items.length === 0) return 'Sin comentarios.'
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const header = `Feedback de la app (${sorted.length} ${sorted.length === 1 ? 'comentario' : 'comentarios'})`
  const body = sorted.map((f, i) =>
    [
      `## ${i + 1}. [${feedbackKindLabel(f.kind)}] ${FEEDBACK_STATUS_LABEL[f.status]}`,
      `- Quién: ${nameOf(f.userId)}`,
      `- Cuándo: ${dateText(f.createdAt)}`,
      `- Pantalla: ${f.route ?? '—'}`,
      `- Dispositivo: ${f.device ?? '—'}`,
      ...(f.appVersion ? [`- Versión: ${f.appVersion}`] : []),
      '',
      f.message
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n'),
    ].join('\n'),
  )
  return [`# ${header}`, '', body.join('\n\n')].join('\n')
}
