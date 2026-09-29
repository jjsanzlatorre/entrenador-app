// Qué cubre cada permiso (Perfil → Pareja y amigos → persona). Las fotos no aparecen: nunca se
// comparten.
import type { SharePerm } from '@/lib/progress/api'

export const PERMISSION_INFO: { key: SharePerm; label: string; hint: string }[] = [
  {
    key: 'adherence',
    label: 'Cumplimiento',
    hint: 'Porcentajes, rachas y nº de sesiones por tipo.',
  },
  {
    key: 'sessions',
    label: 'Entrenos',
    hint: 'Historial y detalle de sesiones (con notas), pesos, récords y gráficas por ejercicio.',
  },
  {
    key: 'muscles',
    label: 'Mapa muscular y carga',
    hint: 'Series por músculo, RPE y carga semanal. Sin pesos.',
  },
  {
    key: 'achievements',
    label: 'Logros',
    hint: 'Acumulados (km, metros, tonelaje, horas), equivalencias y tu ciudad de referencia.',
  },
  { key: 'metrics', label: 'Medidas', hint: 'Peso y perímetros.' },
]

export function sharedSummary(perms: Record<SharePerm, boolean>) {
  const labels = PERMISSION_INFO.filter((p) => perms[p.key]).map((p) => p.label.toLowerCase())
  if (labels.length === 0) return 'nada por ahora'
  if (labels.length === 1) return labels[0]!
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
}
