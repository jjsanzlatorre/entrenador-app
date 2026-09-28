import { Link } from '@tanstack/react-router'
import { CalendarDays, Dumbbell, Sun, TrendingUp, User, type LucideIcon } from 'lucide-react'

const items: {
  to: '/' | '/entrenar' | '/progreso' | '/plan' | '/perfil'
  label: string
  icon: LucideIcon
}[] = [
  { to: '/', label: 'Hoy', icon: Sun },
  { to: '/entrenar', label: 'Entrenar', icon: Dumbbell },
  { to: '/progreso', label: 'Progreso', icon: TrendingUp },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/perfil', label: 'Perfil', icon: User },
]

export function BottomNav() {
  return (
    <nav
      aria-label="Navegación principal"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="text-muted-foreground data-[status=active]:text-primary flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium"
            >
              <Icon className="size-6" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
