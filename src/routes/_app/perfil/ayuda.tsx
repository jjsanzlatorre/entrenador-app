import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, MessageSquareWarning, RotateCcw } from 'lucide-react'
import { FeedbackSheet } from '@/components/feedback/feedback-sheet'
import { BackLink } from '@/components/layout/back-link'
import { Button } from '@/components/ui/button'
import { HELP_SECTIONS } from '@/lib/help/content'
import { resetTips } from '@/lib/help/tips'
import { notifyError, notifySaved } from '@/lib/notify'

export const Route = createFileRoute('/_app/perfil/ayuda')({
  component: HelpPage,
})

// «Cómo funciona» (usabilidad 3/3): guía breve por pantalla, consejos y feedback.
function HelpPage() {
  const [feedback, setFeedback] = useState(false)
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="pr-10 text-2xl font-bold">Cómo funciona</h1>
      <p className="text-muted-foreground text-sm">
        Lo básico de cada pestaña en dos líneas. Toca una sección para verla.
      </p>
      <div className="flex flex-col gap-2">
        {HELP_SECTIONS.map((section) => (
          <details key={section.id} className="bg-card group rounded-2xl border">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold">
              <span aria-hidden className="text-xl">
                {section.emoji}
              </span>
              <span className="flex-1">{section.title}</span>
              <ChevronDown className="text-muted-foreground size-5 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 px-4 pb-4 pl-9 text-sm">
              {section.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <Button
        variant="outline"
        size="lg"
        className="justify-start"
        onClick={() =>
          void resetTips().then(
            () => notifySaved('Los consejos volverán a salir'),
            (error: unknown) => notifyError(error, 'restablecer los consejos'),
          )
        }
      >
        <RotateCcw /> Volver a ver los consejos
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="justify-start"
        onClick={() => setFeedback(true)}
      >
        <MessageSquareWarning /> ¿Algo no se entiende? Enviar feedback
      </Button>
      <FeedbackSheet open={feedback} onClose={() => setFeedback(false)} />
    </div>
  )
}
