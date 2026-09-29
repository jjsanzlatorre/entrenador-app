// Tarjetas de las acciones del chat que no son cambios de sesiones (§11.5): crear un plan
// (create_plan) y ajustar el entreno de hoy (adjust_today). Nada se aplica sin pulsar el botón;
// tras aplicarse, la confirmación sale del resultado guardado en la base de datos (0033).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Check, Eye, Sparkles, X } from 'lucide-react'
import { ADJUST_DONE_TEXT, AdjustProposalView } from '@/components/ai/ai-adjust'
import { PlanProposalView, type PlanAcceptInput } from '@/components/ai/ai-plan-sheet'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import {
  acceptChatPlan,
  aiStatusKey,
  applyChatAdjust,
  chatKey,
  discardChatAction,
  discardProposal,
  refreshAfterChange,
  useAiRequests,
} from '@/lib/ai/client'
import type {
  AdjustProposal,
  ChatAdjustResult,
  ChatPlanResult,
  ChatResult,
  PlanProposal,
} from '@/lib/ai/schemas'
import { errorMessage } from '@/lib/notify'
import { useActivePlan } from '@/lib/plan/hooks'
import { WEEKDAY_LONG, type TrainingProfileData } from '@/lib/plan/profile'
import { FAMILY_LABELS } from '@/lib/plan/recommend'
import { schedulePlan, startOptions } from '@/lib/plan/schedule'
import type { PlanFamily, PlanStructure } from '@/lib/plan/types'
import { formatDayMonth, isoWeekday, localDateKey, weekStartOf } from '@/lib/progress/dates'
import type { Sex } from '@/types/database'

const dayLabel = (date: string) => `${WEEKDAY_LONG[isoWeekday(date) - 1]} ${formatDayMonth(date)}`

// Sesiones por semana de un plan (la semana con más, sin contar la descarga).
export function sessionsPerWeek(structure: PlanStructure) {
  const weeks = structure.weeks.filter((w) => !w.deload)
  return Math.max(0, ...(weeks.length ? weeks : structure.weeks).map((w) => w.sessions.length))
}

function familyText(family: string) {
  const f = FAMILY_LABELS[family as PlanFamily]
  return f ? `${f.emoji} ${f.label}` : family
}

function PlanLink({ date, label = 'Ver en Plan' }: { date: string; label?: string }) {
  return (
    <Link
      to="/plan"
      search={{ semana: weekStartOf(date) }}
      className="text-primary inline-flex items-center gap-1 font-medium underline"
    >
      <CalendarDays className="size-4" /> {label}
    </Link>
  )
}

function Confirmation({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-1 text-sm">
      {children}
    </div>
  )
}

function Failure({ message }: { message: string }) {
  return (
    <p role="alert" className="bg-muted flex gap-2 rounded-lg p-2 text-sm">
      <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" /> {message}
    </p>
  )
}

// ── create_plan ─────────────────────────────────────────────

type PlanState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; interactionId: string; proposal: PlanProposal }

export function ChatPlanCard({
  userId,
  sex,
  profile,
  chatInteractionId,
  request,
  result,
  autoPrepare,
}: {
  userId: string
  sex: Sex | null
  profile: TrainingProfileData
  chatInteractionId: string
  request: NonNullable<ChatResult['plan_request']>
  result: ChatPlanResult | undefined
  // Respuesta recién llegada: el plan se prepara solo (el usuario lo acaba de pedir).
  autoPrepare: boolean
}) {
  const ai = useAiRequests()
  const queryClient = useQueryClient()
  const active = useActivePlan(userId)
  const [state, setState] = useState<PlanState>({ phase: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(false)
  // Resultado local mientras se refresca la conversación.
  const [local, setLocal] = useState<ChatPlanResult | null>(null)
  const started = useRef(false)
  const current = local ?? result
  const today = localDateKey(new Date())
  const start = startOptions(today)[0]!

  const schedule = useMemo(
    () =>
      state.phase === 'ready'
        ? schedulePlan({
            structure: state.proposal.structure,
            startDate: start,
            preferredDays: profile.availability.preferred_days,
            fixedActivities: profile.fixedActivities,
          })
        : null,
    [state, start, profile],
  )

  async function prepare() {
    setState({ phase: 'loading' })
    setError(null)
    const res = await ai.prepareChatPlan(chatInteractionId)
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    if (!res.ok) {
      setState({ phase: 'idle' })
      setError(res.message)
      return
    }
    setState({ phase: 'ready', interactionId: res.interactionId, proposal: res.proposal })
    if (!res.cached) void queryClient.invalidateQueries({ queryKey: chatKey(userId) })
  }

  // Recién pedido, o ya preparado antes (se lee el guardado sin gastar consulta).
  const status = current?.status
  useEffect(() => {
    if (started.current) return
    if (status === 'prepared' || (autoPrepare && status === undefined)) {
      started.current = true
      void Promise.resolve().then(prepare)
    }
    // prepare solo depende de ids estables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoPrepare])

  async function create(input: PlanAcceptInput) {
    const res = await acceptChatPlan({ chatInteractionId, ...input })
    setLocal(res)
    await refreshAfterChange(queryClient, userId)
  }

  async function createNow() {
    if (!schedule || state.phase !== 'ready') return
    if (
      active.data &&
      !confirm(
        `Ya tienes el plan «${active.data.name}». ¿Sustituirlo? Se archiva (no se borra) y lo hecho se conserva.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await create({ name: state.proposal.name, startDate: start, sessions: schedule.sessions })
    } catch (e) {
      setError(`No se ha podido crear el plan: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    setBusy(true)
    setError(null)
    try {
      await discardChatAction(chatInteractionId, 'plan')
      setLocal({ status: 'discarded' })
      await queryClient.invalidateQueries({ queryKey: chatKey(userId) })
    } catch (e) {
      setError(`No se ha podido descartar: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const perWeek = state.phase === 'ready' ? sessionsPerWeek(state.proposal.structure) : null

  return (
    <section
      aria-label={`Propuesta: ${request.title}`}
      className="border-primary/40 bg-primary/5 flex flex-col gap-2 rounded-xl border p-3"
    >
      <p className="text-primary text-xs font-medium uppercase">
        <span aria-hidden>📋 </span>Crear plan
      </p>
      <p className="font-semibold">
        {state.phase === 'ready' ? state.proposal.name : request.title}
      </p>
      <p className="text-muted-foreground text-sm">
        {familyText(request.family)} · {perWeek ?? request.days_per_week} días/semana · 4 semanas
      </p>
      <p className="text-sm">{request.reason}</p>

      {current?.status === 'accepted' ? (
        <Confirmation>
          <p className="font-medium">
            ✅ Plan creado: {current.weeks} semanas, {current.per_week} días/semana (
            {current.sessions} sesiones), desde el {dayLabel(current.start_date)}.
          </p>
          {current.replaced && (
            <p className="text-muted-foreground">
              Sustituye a «{current.replaced}», que queda archivado.
            </p>
          )}
          <PlanLink date={current.start_date} />
        </Confirmation>
      ) : current?.status === 'discarded' ? (
        <p className="text-muted-foreground text-sm">Descartado</p>
      ) : state.phase === 'loading' ? (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Sparkles className="text-primary size-4 animate-pulse" /> Preparando el plan… puede
          tardar hasta un minuto. No se crea nada hasta que pulses «Crear plan».
        </p>
      ) : state.phase === 'ready' && schedule ? (
        <>
          <p className="text-sm">
            Empieza el {dayLabel(start)} · {schedule.sessions.length} sesiones en tu calendario.
          </p>
          {active.data && (
            <p className="flex gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm dark:bg-amber-950/30">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
              Sustituye a tu plan «{active.data.name}»: se archiva (no se borra) y lo que ya has
              hecho se conserva.
            </p>
          )}
          {state.proposal.dropped.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Se han quitado ejercicios que no están en tu biblioteca.
            </p>
          )}
          <Button disabled={busy} onClick={() => void createNow()}>
            <Check /> {busy ? 'Creando…' : 'Crear plan'}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setDetail(true)}>
              <Eye /> Ver detalle
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
              <X /> Descartar
            </Button>
          </div>
          <Sheet
            open={detail}
            onClose={() => setDetail(false)}
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="text-primary size-5" /> Plan propuesto
              </span>
            }
          >
            <PlanProposalView
              interactionId={state.interactionId}
              proposal={state.proposal}
              remaining={null}
              profile={profile}
              userId={userId}
              sex={sex}
              onDone={() => setDetail(false)}
              onAccept={create}
              onDiscard={discard}
            />
          </Sheet>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            La IA prepara el plan con tus días y tu material (hasta un minuto, 1 consulta). Luego lo
            revisas y decides.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={() => void prepare()}>
              <Sparkles /> Preparar plan
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void discard()}>
              <X /> Descartar
            </Button>
          </div>
        </>
      )}
      {error && <Failure message={error} />}
    </section>
  )
}

// ── adjust_today ────────────────────────────────────────────

type AdjustState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; interactionId: string; proposal: AdjustProposal }

export function ChatAdjustCard({
  userId,
  sex,
  name,
  chatInteractionId,
  request,
  result,
}: {
  userId: string
  sex: Sex | null
  name: (id: string) => string
  chatInteractionId: string
  request: NonNullable<ChatResult['adjust_today']>
  result: ChatAdjustResult | undefined
}) {
  const ai = useAiRequests()
  const queryClient = useQueryClient()
  const [state, setState] = useState<AdjustState>({ phase: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<ChatAdjustResult | null>(null)
  const current = local ?? result

  async function prepare() {
    setState({ phase: 'loading' })
    setError(null)
    const res = await ai.proposeAdjust(request.planned_session_id)
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    if (!res.ok) {
      setState({ phase: 'idle' })
      setError(res.message)
      return
    }
    setState({ phase: 'ready', interactionId: res.interactionId, proposal: res.proposal })
  }

  async function accept(interactionId: string, proposal: AdjustProposal) {
    setBusy(true)
    setError(null)
    try {
      const res = await applyChatAdjust(chatInteractionId, interactionId, proposal.plannedSessionId)
      setLocal(res)
      await refreshAfterChange(queryClient, userId)
    } catch (e) {
      setError(`No se ha podido aplicar el ajuste: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    setBusy(true)
    setError(null)
    try {
      if (state.phase === 'ready') {
        await discardProposal(state.interactionId).catch((e: unknown) =>
          console.error('[ai] descartar ajuste', e),
        )
      }
      await discardChatAction(chatInteractionId, 'adjust')
      setLocal({ status: 'discarded' })
      await queryClient.invalidateQueries({ queryKey: chatKey(userId) })
    } catch (e) {
      setError(`No se ha podido descartar: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={`Propuesta: ${request.title}`}
      className="border-primary/40 bg-primary/5 flex flex-col gap-2 rounded-xl border p-3"
    >
      <p className="text-primary text-xs font-medium uppercase">
        <span aria-hidden>🔄 </span>Ajustar el entreno de hoy
      </p>
      <p className="font-semibold">{request.title}</p>
      <p className="text-sm">{request.reason}</p>
      {current?.status === 'accepted' ? (
        <Confirmation>
          <p className="font-medium">
            ✅ {ADJUST_DONE_TEXT[current.decision] ?? 'Ajuste aplicado'}: «{current.title}» ·{' '}
            {dayLabel(current.date)}.
          </p>
          <PlanLink date={current.date} />
        </Confirmation>
      ) : current?.status === 'discarded' ? (
        <p className="text-muted-foreground text-sm">Descartado</p>
      ) : state.phase === 'loading' ? (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Sparkles className="text-primary size-4 animate-pulse" /> La IA está mirando tu check-in
          y tu carga…
        </p>
      ) : state.phase === 'ready' ? (
        <AdjustProposalView
          adjust={state.proposal.adjust}
          busy={busy}
          sex={sex}
          name={name}
          onAccept={() => void accept(state.interactionId, state.proposal)}
          onDiscard={() => void discard()}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={() => void prepare()}>
            <Sparkles /> Preparar ajuste
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void discard()}>
            <X /> Descartar
          </Button>
        </div>
      )}
      {error && <Failure message={error} />}
    </section>
  )
}

// Acciones que la app ha quitado por no poderse aplicar.
export function DiscardedActions({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="bg-muted flex flex-col gap-1 rounded-xl p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="text-warning size-4 shrink-0" />
        {items.length === 1
          ? 'He quitado una propuesta que no se podía aplicar:'
          : `He quitado ${items.length} propuestas que no se podían aplicar:`}
      </p>
      <ul className="text-muted-foreground list-disc pl-6">
        {items.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </div>
  )
}
