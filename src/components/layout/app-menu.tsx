// Menú ⋯ de cada pantalla (usabilidad 3/3): siempre arriba a la derecha. «Enviar feedback» y
// «Cómo funciona» están en todas las pantallas.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleHelp, MessageSquareWarning, MoreHorizontal } from 'lucide-react'
import { FeedbackSheet } from '@/components/feedback/feedback-sheet'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function AppMenuButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="Más opciones"
        onClick={() => setOpen(true)}
        className={cn(
          'hover:bg-accent text-muted-foreground flex size-11 items-center justify-center rounded-full',
          className,
        )}
      >
        <MoreHorizontal className="size-6" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Más opciones">
        <div className="flex flex-col gap-2 pb-2">
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
            onClick={() => {
              setOpen(false)
              setFeedback(true)
            }}
          >
            <MessageSquareWarning /> Enviar feedback
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
            onClick={() => {
              setOpen(false)
              void navigate({ to: '/perfil/ayuda' })
            }}
          >
            <CircleHelp /> Cómo funciona
          </Button>
        </div>
      </Sheet>
      <FeedbackSheet open={feedback} onClose={() => setFeedback(false)} />
    </>
  )
}
