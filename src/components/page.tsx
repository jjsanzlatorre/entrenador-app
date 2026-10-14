import type { ReactNode } from 'react'
import { BackLink } from '@/components/layout/back-link'

// Pantalla estándar: «Atrás» (si la hay) arriba a la izquierda, título y contenido. El menú ⋯
// va arriba a la derecha (layout) y la acción principal, abajo.
export function Page({
  title,
  back,
  children,
}: {
  title: string
  back?: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {back && <BackLink to={back.to} label={back.label} />}
      <h1 className="pr-10 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  )
}

export function ComingSoon({ phase, children }: { phase: number; children: ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
      <p>{children}</p>
      <p className="mt-2 text-xs">Llega en la fase {phase}.</p>
    </div>
  )
}
