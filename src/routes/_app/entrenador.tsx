import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Send, Sparkles, Trash2 } from 'lucide-react'
import { ChangeCard } from '@/components/ai/change-card'
import { ChatAdjustCard, ChatPlanCard, DiscardedActions } from '@/components/ai/chat-actions'
import { ChatRangeCard } from '@/components/ai/chat-range-card'
import { Page } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  aiStatusKey,
  chatDebugEnabled,
  chatKey,
  clearChat,
  useAiRequests,
  useAiStatus,
  useChat,
  type ChatMessage,
} from '@/lib/ai/client'
import { modelLogLines } from '@/lib/ai/chat-text'
import { CHAT_MAX_MESSAGE, type AiFailure } from '@/lib/ai/schemas'
import { notifyError } from '@/lib/notify'
import { useTrainingProfile } from '@/lib/plan/hooks'
import { emptyTrainingProfile, type TrainingProfileData } from '@/lib/plan/profile'
import { useCatalog } from '@/lib/workout/hooks'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/entrenador')({
  ssr: false,
  component: CoachChatPage,
})

const SUGGESTIONS = [
  '¿Qué tal voy esta semana?',
  'Créame un plan de 3 días de fuerza',
  'Tengo molestias en el hombro, ¿cambio algo?',
  'Esta semana solo puedo entrenar 2 días',
]

// Chat con el entrenador (§11.5): usa los datos del usuario y conserva la conversación. Lo que
// la IA propone (crear un plan, cambiar sesiones, ajustar hoy) llega como tarjetas: solo se
// aplica al pulsar su botón, y la confirmación sale de la base de datos.
function CoachChatPage() {
  const { auth } = Route.useRouteContext()
  const userId = auth.userId
  const status = useAiStatus()
  const chat = useChat(userId)
  const ai = useAiRequests()
  const catalog = useCatalog(userId)
  const training = useTrainingProfile(userId)
  const profile = training.data ?? emptyTrainingProfile()
  const queryClient = useQueryClient()
  const name = (id: string) => catalog.byId.get(id)?.name ?? id
  const [text, setText] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState<AiFailure | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // Respuesta recién recibida: su create_plan se prepara solo.
  const [fresh, setFresh] = useState<string | null>(null)
  // Modo depuración (?debug=1): modelo usado y descartes bajo cada respuesta.
  const [debug] = useState(() => chatDebugEnabled(window.location.search))
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
      setFresh(res.interactionId)
      await queryClient.invalidateQueries({ queryKey: chatKey(userId) })
    } else {
      // No se ha guardado nada: el texto vuelve a la caja para reintentar.
      setError(res)
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
              Pregúntame por tu entrenamiento: uso tu plan, tus sesiones y tu check-in. Puedo
              proponerte crear un plan, cambiar, mover o saltar sesiones y ajustar el entreno de
              hoy: verás una tarjeta y nada cambia hasta que pulses su botón.
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
          <MessageItem
            key={m.id}
            message={m}
            userId={userId}
            sex={auth.profile.sex}
            name={name}
            profile={profile}
            fresh={m.interactionId !== null && m.interactionId === fresh}
            debug={debug}
          />
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

      {error && <p className="bg-muted rounded-xl p-3 text-sm">{error.message}</p>}
      {debug && error && (
        <pre className="bg-muted text-muted-foreground max-w-full overflow-x-auto rounded-lg p-2 text-[11px] whitespace-pre-wrap">
          {[
            `código: ${error.code}`,
            error.debug ? `tiempo total: ${error.debug.ms} ms` : null,
            error.debug ? `error: ${error.debug.error}` : null,
            ...modelLogLines(error.debug?.models),
          ]
            .filter(Boolean)
            .join('\n')}
        </pre>
      )}

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
  profile,
  fresh,
  debug,
}: {
  message: ChatMessage
  userId: string
  sex: Parameters<typeof ChangeCard>[0]['sex']
  name: (id: string) => string
  profile: TrainingProfileData
  fresh: boolean
  debug: boolean
}) {
  const mine = message.role === 'user'
  const interactionId = !mine ? message.interactionId : null
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
      {interactionId && message.planRequest && (
        <ChatPlanCard
          userId={userId}
          sex={sex}
          profile={profile}
          chatInteractionId={interactionId}
          request={message.planRequest}
          result={message.results.plan}
          autoPrepare={fresh}
        />
      )}
      {interactionId && message.adjustToday && (
        <ChatAdjustCard
          userId={userId}
          sex={sex}
          name={name}
          chatInteractionId={interactionId}
          request={message.adjustToday}
          result={message.results.adjust}
        />
      )}
      {interactionId &&
        message.ranges.map((r, i) => (
          <ChatRangeCard
            key={`range-${i}`}
            userId={userId}
            sex={sex}
            name={name}
            chatInteractionId={interactionId}
            index={i}
            range={r}
            result={message.results.ranges?.[String(i)]}
          />
        ))}
      {interactionId &&
        message.changes.map((c, i) => (
          <ChangeCard
            key={i}
            userId={userId}
            interactionId={interactionId}
            index={i}
            change={c}
            response={message.responses[String(i)]}
            sex={sex}
            name={name}
          />
        ))}
      {interactionId && <DiscardedActions items={message.discarded} />}
      {debug && message.debug && (
        <pre className="bg-muted text-muted-foreground max-w-full overflow-x-auto rounded-lg p-2 text-[11px] whitespace-pre-wrap">
          {[
            `modelo: ${message.debug.model ?? '?'} (${message.debug.tier}) · intentos: ${message.debug.attempts}${message.debug.ms !== undefined ? ` · ${message.debug.ms} ms` : ''}`,
            ...modelLogLines(message.debug.models),
            message.debug.text_fix ? `texto corregido: ${message.debug.text_fix}` : null,
            ...message.debug.discarded.map((d) => `descarte: ${d}`),
            ...message.debug.issues.flatMap((list, i) => list.map((x) => `intento ${i + 1}: ${x}`)),
          ]
            .filter(Boolean)
            .join('\n')}
        </pre>
      )}
    </li>
  )
}
