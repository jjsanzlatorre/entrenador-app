import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { planAdherence } from '@/lib/plan/calendar'
import { useActivePlan } from '@/lib/plan/hooks'
import { localDateKey } from '@/lib/progress/dates'
import { useSessionLog } from '@/lib/progress/hooks'

// Adherencia al plan (§10A): indicador aparte del compromiso.
export function PlanAdherenceBar({ adherence }: { adherence: ReturnType<typeof planAdherence> }) {
  const pct = adherence.pct ?? 0
  return (
    <div className="flex flex-col gap-1" aria-label="Adherencia al plan">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Adherencia al plan</span>
        <span className="text-muted-foreground">
          {adherence.pct === null
            ? `0 de ${adherence.total} · aún no tocaba ninguna`
            : `${adherence.done} de ${adherence.due} (${adherence.pct} %)`}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Sesiones del plan hechas frente a las que ya tocaban ({adherence.total} en total). Aparte de
        tu compromiso semanal.
      </p>
    </div>
  )
}

// Tarjeta para Cumplimiento: solo con plan activo.
export function PlanAdherenceCard({ userId }: { userId: string }) {
  const plan = useActivePlan(userId)
  const log = useSessionLog(userId)
  if (!plan.data) return null
  const adherence = planAdherence(
    plan.data.sessions,
    log.data?.sessions ?? [],
    localDateKey(new Date()),
  )
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          <Link to="/plan" className="hover:underline">
            {plan.data.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <PlanAdherenceBar adherence={adherence} />
      </CardContent>
    </Card>
  )
}
