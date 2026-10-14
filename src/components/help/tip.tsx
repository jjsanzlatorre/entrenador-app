import type { ReactNode } from 'react'
import { Lightbulb, X } from 'lucide-react'
import { dismissTip, useTipVisible, type TipId } from '@/lib/help/tips'

// Consejo de primera vez: breve, se cierra con un toque y no vuelve a salir.
export function Tip({ id, title, children }: { id: TipId; title: string; children: ReactNode }) {
  const visible = useTipVisible(id)
  if (!visible) return null
  return (
    <aside
      aria-label={`Consejo: ${title}`}
      className="bg-primary/5 border-primary/30 relative flex gap-3 rounded-2xl border p-3 pr-11 text-sm"
    >
      <Lightbulb className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
      <button
        type="button"
        onClick={() => dismissTip(id)}
        aria-label="Entendido, no volver a mostrar"
        className="hover:bg-accent absolute top-1 right-1 flex size-10 items-center justify-center rounded-full"
      >
        <X className="size-5" />
      </button>
    </aside>
  )
}
