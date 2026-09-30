import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { Chip } from '@/components/plan/chip'
import { PlannedBlocks } from '@/components/plan/planned-blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { acceptAiPlan, aiStatusKey, discardProposal, useAiRequests } from '@/lib/ai/client'
import {
  canRemoveExercise,
  canRemoveSession,
  parseRepsInput,
  removeExercise,
  removeSession,
  updateExercise,
  type ExercisePath,
} from '@/lib/ai/edit-plan'
import type { PlanProposal } from '@/lib/ai/schemas'
import { notifyError, notifySaved } from '@/lib/notify'
import { INTENSITY_LABELS } from '@/lib/plan/describe'
import { activePlanKey, useActivePlan } from '@/lib/plan/hooks'
import { WEEKDAY_LONG, type TrainingProfileData } from '@/lib/plan/profile'
import { schedulePlan, startOptions, warningText, type ScheduledSession } from '@/lib/plan/schedule'
import type { PlanStructure } from '@/lib/plan/types'
import { formatDayMonth, localDateKey } from '@/lib/progress/dates'
import { useCatalog } from '@/lib/workout/hooks'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import type { Sex } from '@/types/database'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; interactionId: string; proposal: PlanProposal; remaining: number }

// «Personalizar con IA»: pide un plan a la IA a partir de la plantilla elegida (o de la
// recomendada) y del onboarding, lo enseña y solo lo crea al pulsar «Aceptar».
export function AiPlanSheet({
  request,
  profile,
  userId,
  sex,
  onClose,
}: {
  // null = cerrada. templateId null = «recomiéndame».
  request: { templateId: string | null; label: string } | null
  profile: TrainingProfileData
  userId: string
  sex: Sex | null
  onClose: () => void
}) {
  const ai = useAiRequests()
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const asked = useRef<object | null>(null)

  useEffect(() => {
    if (!request || asked.current === request) return
    asked.current = request
    setState({ phase: 'loading' })
    void ai.proposePlan(request.templateId).then((res) => {
      if (asked.current !== request) return
      void queryClient.invalidateQueries({ queryKey: aiStatusKey })
      setState(
        res.ok
          ? {
              phase: 'ready',
              interactionId: res.interactionId,
              proposal: res.proposal,
              remaining: res.remaining,
            }
          : { phase: 'error', message: res.message },
      )
    })
  }, [request, ai, queryClient])

  function close() {
    asked.current = null
    onClose()
  }

  return (
    <Sheet
      open={request !== null}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="text-primary size-5" /> {request?.label ?? 'Plan con IA'}
        </span>
      }
    >
      {state.phase === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
          <Sparkles className="text-primary size-10 animate-pulse" />
          <p className="font-semibold">La IA está preparando tu plan…</p>
          <p className="text-muted-foreground text-sm">
            Puede tardar hasta un minuto. No se cambia nada hasta que lo aceptes.
          </p>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="flex flex-col gap-3 py-6">
          <p className="bg-muted rounded-xl p-3 text-sm">{state.message}</p>
          <p className="text-muted-foreground text-sm">
            Puedes seguir eligiendo una plantilla sin IA.
          </p>
          <Button variant="outline" onClick={close}>
            Volver
          </Button>
        </div>
      )}
      {state.phase === 'ready' && (
        <PlanProposalView
          key={state.interactionId}
          interactionId={state.interactionId}
          proposal={state.proposal}
          remaining={state.remaining}
          profile={profile}
          userId={userId}
          sex={sex}
          onDone={close}
        />
      )}
    </Sheet>
  )
}

export type PlanAcceptInput = { name: string; startDate: string; sessions: ScheduledSession[] }

// Vista previa de un plan de la IA (semanas, días, Editar, Aceptar, Descartar). La usan
// «Personalizar con IA» y el create_plan del chat (con su propio `onAccept` / `onDiscard`).
export function PlanProposalView({
  interactionId,
  proposal,
  remaining,
  profile,
  userId,
  sex,
  onDone,
  onAccept,
  onDiscard,
}: {
  interactionId: string
  proposal: PlanProposal
  remaining: number | null
  profile: TrainingProfileData
  userId: string
  sex: Sex | null
  onDone: () => void
  // Sustituye a crear el plan y abrir Plan (chat: accept_chat_plan y confirmación en el chat).
  onAccept?: (input: PlanAcceptInput) => Promise<void>
  onDiscard?: () => Promise<void>
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useCatalog(userId)
  const active = useActivePlan(userId)
  const today = localDateKey(new Date())
  const options = startOptions(today)
  const [start, setStart] = useState(options[0]!)
  const [structure, setStructure] = useState<PlanStructure>(proposal.structure)
  const [name, setName] = useState(proposal.name)
  const [editing, setEditing] = useState(false)
  const [week, setWeek] = useState(0)
  const [busy, setBusy] = useState(false)
  const exerciseName = (id: string) => catalog.byId.get(id)?.name ?? id

  const schedule = useMemo(
    () =>
      schedulePlan({
        structure,
        startDate: start,
        preferredDays: profile.availability.preferred_days,
        fixedActivities: profile.fixedActivities,
      }),
    [structure, start, profile],
  )
  const warnings = [...new Set(schedule.warnings.map(warningText))].slice(0, 3)
  const weekData = structure.weeks[week]
  const dates = schedule.sessions.filter((s) => s.week === week + 1)

  async function accept() {
    if (
      active.data &&
      !confirm(`Ya tienes el plan «${active.data.name}». ¿Sustituirlo? Lo hecho se conserva.`)
    ) {
      return
    }
    setBusy(true)
    const plan = {
      name: name.trim() || proposal.name,
      startDate: start,
      sessions: schedule.sessions,
    }
    if (onAccept) {
      try {
        await onAccept(plan)
        onDone()
      } catch (error) {
        notifyError(error, 'crear el plan')
      } finally {
        setBusy(false)
      }
      return
    }
    try {
      await acceptAiPlan({
        interactionId,
        templateId: proposal.baseTemplateId,
        name: name.trim() || proposal.name,
        summary: proposal.summary,
        startDate: start,
        sessions: schedule.sessions,
      })
      await queryClient.invalidateQueries({ queryKey: activePlanKey(userId) })
      notifySaved(`Plan creado: ${schedule.sessions.length} sesiones en 4 semanas`)
      onDone()
      await navigate({ to: '/plan', search: { semana: start } })
    } catch (error) {
      notifyError(error, 'crear el plan')
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    setBusy(true)
    try {
      await (onDiscard ? onDiscard() : discardProposal(interactionId))
    } catch (error) {
      console.error('[ai] descartar', error)
    } finally {
      setBusy(false)
      onDone()
    }
  }

  const edit = (fn: (s: PlanStructure) => PlanStructure) => setStructure((s) => fn(s))

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-col gap-1">
        {editing ? (
          <Input
            aria-label="Nombre del plan"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <h3 className="text-lg font-bold">{name}</h3>
        )}
        <p className="text-sm">{proposal.summary}</p>
        <p className="text-muted-foreground text-xs">{structure.progression_rules}</p>
        <p className="text-muted-foreground text-xs">
          Propuesta de la IA{remaining !== null ? ` · te quedan ${remaining} consultas hoy` : ''}
        </p>
      </div>

      {proposal.dropped.length > 0 && (
        <p className="flex gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
          Se han quitado ejercicios que no están en tu biblioteca ({proposal.dropped.join(', ')}).
        </p>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold">Empieza el lunes…</h4>
        <div className="flex flex-wrap gap-2">
          {options.map((d) => (
            <Chip key={d} selected={start === d} onClick={() => setStart(d)}>
              {d === today ? 'Hoy' : formatDayMonth(d)}
            </Chip>
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          {warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2" role="tablist" aria-label="Semana">
        {structure.weeks.map((w, i) => (
          <Chip key={w.week} selected={week === i} onClick={() => setWeek(i)}>
            Sem. {w.week}
            {w.deload ? ' ↓' : ''}
          </Chip>
        ))}
      </div>

      {weekData && (
        <ul className="flex flex-col gap-2">
          {weekData.sessions.map((s, si) => {
            const date = dates.find((d) => d.title === s.title)?.date
            return (
              <li key={`${week}-${si}`} className="rounded-xl border p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-semibold">
                    <span aria-hidden>{sessionTypeEmoji(s.session_type)} </span>
                    {s.title}
                  </p>
                  {date && (
                    <span className="text-muted-foreground shrink-0 text-xs first-letter:uppercase">
                      {WEEKDAY_LONG[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}{' '}
                      {formatDayMonth(date)}
                    </span>
                  )}
                  {editing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar ${s.title}`}
                      disabled={!canRemoveSession(structure, week)}
                      onClick={() => edit((p) => removeSession(p, week, si))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground mb-2 text-xs">
                  {s.duration_min} min · {INTENSITY_LABELS[s.intensity]}
                </p>
                {editing ? (
                  <EditBlocks
                    structure={structure}
                    week={week}
                    session={si}
                    name={exerciseName}
                    onChange={edit}
                  />
                ) : (
                  <PlannedBlocks blocks={s.blocks} name={exerciseName} sex={sex} />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="bg-background sticky bottom-0 flex flex-col gap-2 border-t pt-3">
        <Button size="lg" disabled={busy} onClick={() => void accept()}>
          <Check /> {busy ? 'Creando…' : 'Aceptar y crear el plan'}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setEditing((e) => !e)}>
            <Pencil /> {editing ? 'Listo' : 'Editar'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
            <X /> Descartar
          </Button>
        </div>
      </div>
    </div>
  )
}

function EditBlocks({
  structure,
  week,
  session,
  name,
  onChange,
}: {
  structure: PlanStructure
  week: number
  session: number
  name: (id: string) => string
  onChange: (fn: (s: PlanStructure) => PlanStructure) => void
}) {
  const s = structure.weeks[week]!.sessions[session]!
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {s.blocks.flatMap((b, bi) =>
        b.exercises.map((e, ei) => {
          const path: ExercisePath = { week, session, block: bi, exercise: ei }
          return (
            <li
              key={`${bi}-${ei}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
            >
              <span className="min-w-0 flex-1 font-medium">{name(e.exercise_id)}</span>
              {e.sets !== undefined && (
                <label className="flex items-center gap-1 text-xs">
                  Series
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="h-9 w-14"
                    min={1}
                    max={30}
                    value={e.sets}
                    onChange={(ev) => {
                      const n = Number.parseInt(ev.target.value, 10)
                      if (n >= 1 && n <= 30) onChange((p) => updateExercise(p, path, { sets: n }))
                    }}
                  />
                </label>
              )}
              {e.reps !== undefined && (
                <label className="flex items-center gap-1 text-xs">
                  Reps
                  <Input
                    className="h-9 w-20"
                    defaultValue={e.reps}
                    onBlur={(ev) => {
                      const reps = parseRepsInput(ev.target.value)
                      if (reps) onChange((p) => updateExercise(p, path, { reps }))
                      else ev.target.value = e.reps ?? ''
                    }}
                  />
                </label>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${name(e.exercise_id)}`}
                disabled={!canRemoveExercise(structure, path)}
                onClick={() => onChange((p) => removeExercise(p, path))}
              >
                <Trash2 />
              </Button>
            </li>
          )
        }),
      )}
    </ul>
  )
}
