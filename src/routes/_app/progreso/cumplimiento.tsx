import { createFileRoute, Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { AdherenceOverview, UsCard } from '@/components/progress/adherence'
import { PlanAdherenceCard } from '@/components/plan/plan-adherence'
import { BackLink } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { currentCommitment } from '@/lib/progress/adherence'
import { localDateKey } from '@/lib/progress/dates'
import { useMyAdherenceData } from '@/lib/progress/hooks'

export const Route = createFileRoute('/_app/progreso/cumplimiento')({
  ssr: false,
  component: AdherencePage,
})

function AdherencePage() {
  const { auth } = Route.useRouteContext()
  const { days, commitments, isPending, offline } = useMyAdherenceData(auth.userId)
  const today = localDateKey(new Date())

  if (isPending) return <p className="text-muted-foreground p-6 text-center">Cargando…</p>

  if (!currentCommitment(commitments, today)) {
    const hadOne = commitments.length > 0
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        <h1 className="text-2xl font-bold">Cumplimiento</h1>
        <p className="text-muted-foreground">
          {hadOne
            ? 'Ahora mismo no tienes compromiso. Tu historial se conserva: crea uno nuevo cuando quieras y volverás a ver tus barras.'
            : 'Aún no has definido tu compromiso: cuántas sesiones quieres hacer cada semana.'}
        </p>
        <Button asChild size="lg">
          <Link to="/perfil/compromiso">
            {hadOne ? 'Crear un compromiso' : 'Definir mi compromiso'}
          </Link>
        </Button>
        <PlanAdherenceCard userId={auth.userId} />
        <UsCard userId={auth.userId} myName={auth.profile.display_name ?? 'Yo'} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cumplimiento</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/perfil/compromiso">
            <Pencil /> Compromiso
          </Link>
        </Button>
      </div>
      {offline && (
        <p className="text-muted-foreground text-sm">
          Sin conexión: se cuentan las sesiones guardadas en este móvil.
        </p>
      )}

      <AdherenceOverview commitments={commitments} days={days} today={today} />

      <PlanAdherenceCard userId={auth.userId} />

      <UsCard userId={auth.userId} myName={auth.profile.display_name ?? 'Yo'} />

      <p className="text-muted-foreground text-xs">
        Cuenta una sesión por día y tipo, de al menos 15 minutos. La adherencia al plan es aparte:
        sesiones del plan hechas frente a las que ya tocaban.
      </p>
    </div>
  )
}
