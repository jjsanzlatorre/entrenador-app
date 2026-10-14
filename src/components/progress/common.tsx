import type { ReactNode } from 'react'

// «Atrás» común (antes vivía aquí; se mantiene la exportación).
export { BackLink } from '@/components/layout/back-link'

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-[10px]">{hint}</p>}
    </div>
  )
}
