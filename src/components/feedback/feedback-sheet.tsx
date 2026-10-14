// «Enviar feedback» (usabilidad 3/3): texto libre + tipo; la ruta, la fecha y el dispositivo se
// adjuntan solos. Desde el menú ⋯ de cualquier pantalla y desde Perfil.
import { useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { sendFeedback } from '@/lib/feedback/api'
import { currentDeviceSummary, FEEDBACK_KINDS, FEEDBACK_MAX_LENGTH } from '@/lib/feedback/feedback'
import { notifyError, notifySaved } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { FeedbackKind } from '@/types/database'

export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const route = useLocation({ select: (l) => `${l.pathname}${l.searchStr ?? ''}` })
  const [kind, setKind] = useState<FeedbackKind>('awkward')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const device = open ? currentDeviceSummary() : ''
  const text = message.trim()

  async function submit() {
    if (!text) return
    setSending(true)
    try {
      const result = await sendFeedback({ kind, message: text, route, device })
      notifySaved(
        result === 'sent'
          ? '¡Gracias! Feedback enviado'
          : 'Guardado en el móvil: se enviará cuando haya conexión',
      )
      setMessage('')
      onClose()
    } catch (error) {
      notifyError(error, 'enviar el feedback')
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Enviar feedback"
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={!text || sending}
          onClick={() => void submit()}
        >
          <Send /> Enviar
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-3 gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={cn(
                'flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-semibold',
                kind === k.kind ? 'border-primary bg-primary/10 text-primary' : 'bg-card',
              )}
            >
              <span aria-hidden className="text-xl">
                {k.emoji}
              </span>
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground -mt-1 text-xs">
          {FEEDBACK_KINDS.find((k) => k.kind === kind)?.hint}
        </p>
        <Label htmlFor="feedback-message">¿Qué ha pasado o qué cambiarías?</Label>
        <Textarea
          id="feedback-message"
          value={message}
          maxLength={FEEDBACK_MAX_LENGTH}
          rows={5}
          placeholder="Cuéntalo con tus palabras: qué intentabas hacer y qué esperabas."
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Se adjunta automáticamente: la pantalla ({route}), la fecha y el dispositivo ({device}).
          Solo lo ve el administrador.
        </p>
      </div>
    </Sheet>
  )
}
