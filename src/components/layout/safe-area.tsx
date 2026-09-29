import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Márgenes de seguridad (CLAUDE.md §2). Con viewport-fit=cover y la barra de estado
// «black-translucent», la app se dibuja bajo la hora, la batería, la Dynamic Island y la barra
// de gestos. Reglas:
// - Las pantallas de /_app ya reciben el margen superior y lateral del layout.
// - Las pantallas sueltas (login, /unirse, /bloqueado…) usan <Screen>.
// - Cabeceras sticky: `sticky top-safe`. Barras fijas abajo: `pb-safe` (+ `px-safe`).
// - Overlays a pantalla completa (hojas, pop-ups): `p-safe-N` y alto máximo `max-h-sheet`.

// Banda opaca del alto de la barra de estado: el contenido que se desplaza por debajo no se
// mezcla con la hora y el texto blanco de la barra se lee también en el tema claro.
export function StatusBarScrim() {
  return (
    <div
      aria-hidden
      data-status-bar-scrim
      className="pointer-events-none fixed inset-x-0 top-0 z-[60]"
      style={{ height: 'var(--safe-top)', background: 'var(--status-bar)' }}
    />
  )
}

// Pantalla completa fuera del layout de la app (sin navegación inferior).
export function Screen({
  children,
  className,
  center = true,
}: {
  children: ReactNode
  className?: string
  center?: boolean
}) {
  // El margen va en el contenedor a todo el ancho (en horizontal el notch queda a un lado y la
  // columna centrada no pierde anchura).
  return (
    <div className="pt-safe pb-safe px-safe flex min-h-dvh flex-col">
      <main
        className={cn(
          'mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6',
          center && 'justify-center',
          className,
        )}
      >
        {children}
      </main>
    </div>
  )
}
