import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

export function BackLink({
  to = '/progreso',
  label = 'Progreso',
}: {
  to?: string
  label?: string
}) {
  return (
    <Link to={to} className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium">
      <ChevronLeft className="size-4" /> {label}
    </Link>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[10px]">{hint}</p>}
    </div>
  )
}
