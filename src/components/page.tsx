import type { ReactNode } from 'react'

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">{title}</h1>
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
