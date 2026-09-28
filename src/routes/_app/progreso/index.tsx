import { createFileRoute, Link } from '@tanstack/react-router'
import {
  BarChart3,
  Camera,
  ChevronRight,
  Flame,
  Medal,
  Scale,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import { WeekAdherenceCard } from '@/components/progress/adherence'
import { Page } from '@/components/page'

export const Route = createFileRoute('/_app/progreso/')({
  component: ProgressPage,
})

const SECTIONS: {
  to:
    | '/progreso/cumplimiento'
    | '/progreso/resumen'
    | '/progreso/records'
    | '/progreso/medidas'
    | '/progreso/fotos'
    | '/progreso/logros'
  label: string
  hint: string
  icon: LucideIcon
}[] = [
  {
    to: '/progreso/cumplimiento',
    label: 'Cumplimiento',
    hint: 'Semana, mes, histórico y rachas',
    icon: Flame,
  },
  {
    to: '/progreso/logros',
    label: 'Mis logros',
    hint: 'Acumulados, equivalencias y destinos',
    icon: Medal,
  },
  {
    to: '/progreso/resumen',
    label: 'Resumen',
    hint: 'Sesiones, horas, carga y distancia',
    icon: BarChart3,
  },
  {
    to: '/progreso/records',
    label: 'Récords y gráficas',
    hint: '1RM, pesos, volumen, ritmos',
    icon: Trophy,
  },
  { to: '/progreso/medidas', label: 'Peso y medidas', hint: 'Registro y evolución', icon: Scale },
  { to: '/progreso/fotos', label: 'Fotos', hint: 'Antes y después (privadas)', icon: Camera },
]

function ProgressPage() {
  const { auth } = Route.useRouteContext()
  return (
    <Page title="Progreso">
      <WeekAdherenceCard userId={auth.userId} />
      <ul className="flex flex-col gap-2">
        {SECTIONS.map(({ to, label, hint, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-4"
            >
              <Icon className="text-primary size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{label}</p>
                <p className="text-muted-foreground truncate text-sm">{hint}</p>
              </div>
              <ChevronRight className="text-muted-foreground size-5" />
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  )
}
