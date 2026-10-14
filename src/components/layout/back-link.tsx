import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

// «Atrás» común a todas las pantallas (usabilidad 3/3): siempre arriba a la izquierda, con el
// nombre de la pantalla a la que vuelve y un área táctil de 44 px. El menú ⋯ de la pantalla va
// arriba a la derecha (AppMenu) y la acción principal (Guardar, Empezar…) abajo.
export function BackLink({
  to = '/progreso',
  label = 'Progreso',
}: {
  to?: string
  label?: string
}) {
  return (
    <Link
      to={to}
      className="text-primary relative -ml-1 inline-flex min-h-11 items-center gap-1 self-start pr-2 text-sm font-medium"
    >
      <ChevronLeft className="size-5" /> {label}
    </Link>
  )
}
