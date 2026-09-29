import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Send, Sparkles, Trash2 } from 'lucide-react'
import { ChangeCard } from '@/components/ai/change-card'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  aiStatusKey,
  chatKey,
  clearChat,
  useAiRequests,
  useAiStatus,
  useChat,
  type ChatMessage,
} from '@/lib/ai/client'
import { CHAT_MAX_MESSAGE } from '@/lib/ai/schemas'
import { notifyError } from '@/lib/notify'
import { useCatalog } from '@/lib/workout/hooks'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/entrenador')({
  ssr: false,
  component: CoachChatPage,
})

const SUGGESTIONS = [
  '¿Qué tal voy esta semana?',
  'Tengo molestias en el hombro, ¿cambio algo?',
  'Esta semana solo puedo entrenar 2 días',
]

// Chat con el entrenador (§11.5): usa los datos del usuario y conserva la conversación. Si la
// IA propone cambios en el plan, llegan como tarjetas para aceptar o descartar.
function CoachChatPage() {
  const { auth } = Route.useRouteContext()
  const userId = auth.userId
  const status = useAiStatus()
  const chat = useChat(userId)
  const ai = useAiRequests()
  const catalog = useCatalog(userId)
  const queryClient = useQueryClient()
  const name = (id: string) => catalog.byId.get(id)?.name ?? id
  const [text, setText] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const messages = chat.data ?? []
  const left = status.data ? Math.max(0, status.data.limit - status.data.usedToday) : null
  const configured = status.data?.configured === true

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, sending])

  async function send(value: string) {
    const message = value.trim()
    if (!message || sending) return
    setSending(message)
    setError(null)
    setText('')
    const res = await ai.sendChat(message)
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: chatKey(userId) })
    } else {
      // No se ha guardado nada: el texto vuelve a la caja para reintentar.
      setError(res.message)
      setText(message)
    }
    setSending(null)
  }

  async function clear() {
    setConfirmClear(false)
    try {
      await clearChat(userId)
      await queryClient.invalidateQueries({ queryKey: chatKey(userId) })
    } catch (e) {
      notifyError(e, 'borrar la conversación')
    }
  }

  return (
    <Page title="Entrenador">
      <div className="-mt-2 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/">
            <ChevronLeft /> Hoy
          </Link>
        </Button>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 /> Borrar conversación
          </Button>
        )}
      </div>

      {confirmClear && (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <p className="text-sm">
            ¿Borrar toda la conversación? Los cambios ya aceptados se quedan.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="destructive" onClick={() => void clear()}>
              Borrar
            </Button>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {status.isSuccess && !configured && (
        <p className="bg-muted rounded-xl p-3 text-sm">
          El entrenador IA no está configurado. La app funciona igual sin IA.
        </p>
      )}

      {chat.isError && (
        <p className="text-muted-foreground text-sm">
          No se ha podido cargar la conversación: {chat.error.message}
        </p>
      )}

      <ol aria-label="Conversación" className="flex flex-col gap-3">
        {messages.length === 0 && !sending && chat.isSuccess && (
          <li className="text-muted-foreground flex flex-col gap-2 text-sm">
            <p>
              Pregúntame por tu entrenamiento: uso tu plan, tus sesiones y tu check-in. Si te
              propongo cambiar el plan, verás una tarjeta y tú decides.
            </p>
            {configured && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => void send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </li>
        )}
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} userId={userId} sex={auth.profile.sex} name={name} />
        ))}
        {sending && (
          <>
            <li className="bg-primary text-primary-foreground ml-10 self-end rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
              {sending}
            </li>
            <li role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Sparkles className="text-primary size-4 animate-pulse" /> El entrenador está
              pensando…
            </li>
          </>
        )}
      </ol>

      {error && <p className="bg-muted rounded-xl p-3 text-sm">{error}</p>}

      {configured && (
        <form
          className="bg-background bottom-above-nav sticky flex flex-col gap-1 border-t py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(text)
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Mensaje para el entrenador"
              placeholder="Escribe tu pregunta…"
              value={text}
              maxLength={CHAT_MAX_MESSAGE}
              rows={2}
              disabled={sending !== null}
              onChange={(e) => setText(e.target.value)}
              className="min-h-12 flex-1 resize-none"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Enviar"
              className="size-12"
              disabled={!text.trim() || sending !== null || left === 0}
            >
              <Send />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {left === 0
              ? 'Has llegado al límite de consultas de hoy.'
              : left !== null
                ? `Consultas a la IA que te quedan hoy: ${left}`
                : null}
          </p>
        </form>
      )}
      <div ref={bottom} />
    </Page>
  )
}

function MessageItem({
  message,
  userId,
  sex,
  name,
}: {
  message: ChatMessage
  userId: string
  sex: Parameters<typeof ChangeCard>[0]['sex']
  name: (id: string) => string
}) {
  const mine = message.role === 'user'
  return (
    <li className={cn('flex flex-col gap-2', mine ? 'ml-10 items-end' : 'mr-4')}>
      <p
        className={cn(
          'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
          mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm',
        )}
      >
        {message.content}
      </p>
      {!mine &&
        message.interactionId &&
        message.changes.map((c, i) => (
          <ChangeCard
            key={i}
            userId={userId}
            interactionId={message.interactionId!}
            index={i}
            change={c}
            response={message.responses[String(i)]}
            sex={sex}
            name={name}
          />
        ))}
    </li>
  )
}
