import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { localDateKey } from '@/lib/progress/dates'
import { useSessionLog } from '@/lib/progress/hooks'
import { useActivePlan } from '@/lib/plan/hooks'
import { acuteChronicRatio, ACWR_HIGH, ACWR_LOW, type Acwr } from '@/lib/progress/load'

// El aviso de subcarga (< 0,8) solo tiene sentido con un plan activo (§10).
export function useHasActivePlan(userId: string) {
  return Boolean(useActivePlan(userId).data)
}

export function formatRatio(ratio: number) {
  return ratio.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function acwrMessage(acwr: Acwr) {
  switch (acwr.status) {
    case 'high':
      return `Riesgo de sobrecarga: esta semana llevas bastante más carga que tu media (ratio > ${formatRatio(ACWR_HIGH)}). Plantéate un día suave o de descanso.`
    case 'low':
      return `Carga por debajo de lo habitual (ratio < ${formatRatio(ACWR_LOW)}): si te encuentras bien, puedes retomar el plan.`
    case 'ok':
      return `Carga equilibrada: entre ${formatRatio(ACWR_LOW)} y ${formatRatio(ACWR_HIGH)}.`
    default:
      return 'Datos insuficientes: el ratio necesita al menos 4 semanas de entrenos con RPE.'
  }
}

// Lo mismo, visto por una persona vinculada (sin consejos en segunda persona).
export function acwrMessageOther(acwr: Acwr) {
  switch (acwr.status) {
    case 'high':
      return `Esta semana lleva bastante más carga que su media (ratio > ${formatRatio(ACWR_HIGH)}).`
    case 'low':
      return `Carga por debajo de lo habitual (ratio < ${formatRatio(ACWR_LOW)}).`
    case 'ok':
      return `Carga equilibrada: entre ${formatRatio(ACWR_LOW)} y ${formatRatio(ACWR_HIGH)}.`
    default:
      return 'Datos insuficientes: el ratio necesita al menos 4 semanas de entrenos con RPE.'
  }
}

// Aviso compacto (en «Hoy» y Progreso): solo cuando hay algo que avisar.
export function AcwrAlert({ userId }: { userId: string }) {
  const log = useSessionLog(userId)
  const hasActivePlan = useHasActivePlan(userId)
  if (!log.data) return null
  const acwr = acuteChronicRatio(log.data.sessions, localDateKey(new Date()), { hasActivePlan })
  if (acwr.status !== 'high' && acwr.status !== 'low') return null
  return (
    <Link
      to="/progreso/carga"
      className="flex items-center gap-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
    >
      <AlertTriangle className="size-6 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {acwr.status === 'high' ? 'Cuidado con la carga' : 'Carga baja'} · ratio{' '}
          {formatRatio(acwr.ratio ?? 0)}
        </p>
        <p className="text-muted-foreground text-xs">{acwrMessage(acwr)}</p>
      </div>
      <ChevronRight className="text-muted-foreground size-5 shrink-0" />
    </Link>
  )
}
