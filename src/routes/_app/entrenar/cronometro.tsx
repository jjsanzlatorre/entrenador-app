import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  Flag,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  SkipForward,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { Chip } from '@/components/plan/chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  BigButton,
  SoundToggle,
  useCountdownAlerts,
  usePhaseChangeAlert,
} from '@/components/workout/timer-controls'
import { TimerFullscreen, type FullscreenControl } from '@/components/workout/timer-fullscreen'
import { notifyError, notifySaved } from '@/lib/notify'
import { saveFinishedSession } from '@/lib/workout/active-session'
import { unlockAudio } from '@/lib/workout/alerts'
import { formatClock } from '@/lib/workout/format'
import {
  getFullscreenAuto,
  setFullscreenAuto,
  useFullscreenAuto,
} from '@/lib/workout/fullscreen-pref'
import { historyQueryKey, useNow, useWakeLock } from '@/lib/workout/hooks'
import { START_OPTIONS } from '@/lib/workout/session-kinds'
import {
  addTime,
  createTimerState,
  endCurrentPhase,
  finishTimer,
  secondsLeftInPhase,
  startTimer,
  timerView,
  togglePause,
  workElapsedMs,
} from '@/lib/workout/timer'
import { timerDisplay } from '@/lib/workout/timer-display'
import {
  configToForm,
  DEFAULT_TOOL_FORM,
  formToConfig,
  loadFavorites,
  loadToolRun,
  saveFavorites,
  saveToolRun,
  type StepForm,
  type TimerFavorite,
  type ToolForm,
} from '@/lib/workout/tool-form'
import {
  buildToolSchedule,
  createToolSession,
  describeToolTimer,
  MAX_SEQUENCE_STEPS,
  TOOL_KIND_LABELS,
  toolConfigProblem,
  toolResultText,
  toolRunTimes,
  type ToolRun,
  type ToolTimerKind,
} from '@/lib/workout/tool-timer'
import type { SessionType } from '@/types/database'
import { cn } from '@/lib/utils'

// Herramienta «Cronómetro» (Entrenar): temporizadores sin crear sesión. Al terminar, se puede
// guardar como sesión.
export const Route = createFileRoute('/_app/entrenar/cronometro')({
  ssr: false,
  component: TimerToolPage,
})

// Hora actual para las acciones (fuera del render).
const nowMs = () => Date.now()

const KINDS: ToolTimerKind[] = ['free', 'countdown', 'emom', 'amrap', 'tabata', 'sequence']

function TimerToolPage() {
  const { auth } = Route.useRouteContext()
  const userId = auth.userId
  const [run, setRunState] = useState<ToolRun | null>(() => loadToolRun(userId))
  const [form, setForm] = useState<ToolForm>(() => {
    const saved = loadToolRun(userId)
    return saved ? configToForm(saved.config) : DEFAULT_TOOL_FORM
  })
  const [favorites, setFavoritesState] = useState<TimerFavorite[]>(() => loadFavorites(userId))
  const [fullscreen, setFullscreen] = useState(false)
  const autoFullscreen = useFullscreenAuto('blocks')

  const setRun = useCallback(
    (next: ToolRun | null) => {
      setRunState(next)
      saveToolRun(userId, next)
    },
    [userId],
  )
  const setFavorites = (list: TimerFavorite[]) => {
    setFavoritesState(list)
    saveFavorites(userId, list)
  }

  const config = formToConfig(form)
  const problem = config ? toolConfigProblem(config) : 'Revisa los valores.'

  function start(skipPrep: boolean) {
    if (!config || problem) return
    unlockAudio()
    const now = nowMs()
    setRun({
      config,
      timer: startTimer(createTimerState(), now, skipPrep && config.kind !== 'free'),
      amrap: { rounds: 0, extraReps: 0 },
    })
    if (getFullscreenAuto('blocks')) setFullscreen(true)
  }

  return (
    <div className="pb-nav flex flex-col gap-5 p-4">
      <div className="flex items-center justify-between">
        <Link
          to="/entrenar"
          className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
        >
          <ChevronLeft className="size-4" /> Entrenar
        </Link>
        <SoundToggle />
      </div>
      <h1 className="text-2xl font-bold">Cronómetro</h1>

      {run ? (
        <RunView
          run={run}
          setRun={setRun}
          userId={userId}
          fullscreen={fullscreen}
          setFullscreen={setFullscreen}
          onRepeat={() => {
            setRun(null)
            setForm(configToForm(run.config))
          }}
        />
      ) : (
        <>
          {favorites.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Favoritos">
              <h2 className="text-sm font-semibold">Favoritos</h2>
              <ul className="flex flex-col gap-1.5">
                {favorites.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setForm(configToForm(f.config))}
                      className="bg-card hover:bg-accent flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left"
                    >
                      <Star className="text-trophy size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {describeToolTimer(f.config)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Borrar favorito ${f.name}`}
                      onClick={() =>
                        confirm(`¿Borrar «${f.name}»?`) &&
                        setFavorites(favorites.filter((x) => x.id !== f.id))
                      }
                      className="hover:bg-accent rounded-full p-2.5"
                    >
                      <Trash2 className="text-muted-foreground size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tipo de temporizador">
            {KINDS.map((k) => (
              <Chip
                key={k}
                selected={form.kind === k}
                onClick={() => setForm({ ...form, kind: k })}
              >
                {TOOL_KIND_LABELS[k]}
              </Chip>
            ))}
          </div>

          <ConfigForm form={form} setForm={setForm} />

          {config && !problem && (
            <p className="text-muted-foreground text-sm">{describeToolTimer(config)}</p>
          )}
          {problem && form.kind !== 'free' && (
            <p className="text-destructive text-sm" role="alert">
              {problem}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <BigButton
              variant="primary"
              label={
                form.kind === 'free'
                  ? 'Empezar cronómetro'
                  : 'Empezar con cuenta atrás de 10 segundos'
              }
              className="flex-none"
              disabled={Boolean(problem)}
              onClick={() => start(false)}
            >
              <Play className="size-6" /> Empezar
            </BigButton>
            {form.kind !== 'free' && (
              <Button variant="ghost" disabled={Boolean(problem)} onClick={() => start(true)}>
                Empezar sin cuenta atrás
              </Button>
            )}
            <label className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={autoFullscreen}
                onChange={(e) => setFullscreenAuto('blocks', e.target.checked)}
              />
              Abrir a pantalla completa al empezar
            </label>
          </div>

          {config && !problem && (
            <SaveFavorite
              onSave={(name) => {
                setFavorites([{ id: crypto.randomUUID(), name, config }, ...favorites])
                notifySaved(`«${name}» guardado en favoritos`)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

function ConfigForm({ form, setForm }: { form: ToolForm; setForm: (f: ToolForm) => void }) {
  const set = (patch: Partial<ToolForm>) => setForm({ ...form, ...patch })
  const min = { kind: 'duration', bare: 'min' } as const
  const sec = { kind: 'duration', bare: 's' } as const
  switch (form.kind) {
    case 'free':
      return (
        <p className="text-muted-foreground text-sm">
          Cronómetro ascendente, sin límite. Para cuando quieras.
        </p>
      )
    case 'countdown':
      return (
        <QuantityInput
          id="tool-countdown"
          label="Duración"
          value={form.countdown}
          onChange={(v) => set({ countdown: v })}
          quantity={min}
          steps={[1]}
          chips={[1, 3, 5, 10]}
        />
      )
    case 'emom':
      return (
        <div className="grid grid-cols-2 gap-3">
          <QuantityInput
            id="tool-emom-minutes"
            label="Rondas (minutos)"
            value={form.emomMinutes}
            onChange={(v) => set({ emomMinutes: v })}
            quantity={{ kind: 'count', unit: 'rondas' }}
            steps={[1]}
          />
          <QuantityInput
            id="tool-emom-every"
            label="Cada"
            value={form.emomEvery}
            onChange={(v) => set({ emomEvery: v })}
            quantity={sec}
          />
        </div>
      )
    case 'amrap':
      return (
        <QuantityInput
          id="tool-amrap"
          label="Duración"
          value={form.amrap}
          onChange={(v) => set({ amrap: v })}
          quantity={min}
          steps={[1]}
          chips={[8, 10, 12, 15, 20]}
        />
      )
    case 'tabata':
      return (
        <div className="grid grid-cols-3 gap-2">
          <QuantityInput
            id="tool-tabata-work"
            label="Trabajo"
            value={form.tabataWork}
            onChange={(v) => set({ tabataWork: v })}
            quantity={sec}
          />
          <QuantityInput
            id="tool-tabata-rest"
            label="Descanso"
            value={form.tabataRest}
            onChange={(v) => set({ tabataRest: v })}
            quantity={sec}
          />
          <QuantityInput
            id="tool-tabata-rounds"
            label="Rondas"
            value={form.tabataRounds}
            onChange={(v) => set({ tabataRounds: v })}
            quantity={{ kind: 'count' }}
          />
        </div>
      )
    case 'sequence':
      return <SequenceForm form={form} set={set} />
  }
}

function SequenceForm({ form, set }: { form: ToolForm; set: (patch: Partial<ToolForm>) => void }) {
  const update = (i: number, patch: Partial<StepForm>) =>
    set({ steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Fases que se repiten cada ronda (p. ej. 40 s sentadilla, 20 s descanso, 30 s flexiones…).
      </p>
      <ol className="flex flex-col gap-2">
        {form.steps.map((step, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-5 text-sm font-semibold">{i + 1}</span>
              <div
                className="grid flex-1 grid-cols-2 gap-1.5"
                role="group"
                aria-label={`Fase ${i + 1}`}
              >
                <Chip
                  selected={step.kind === 'work'}
                  className="min-h-9 py-1"
                  onClick={() => update(i, { kind: 'work' })}
                >
                  Trabajo
                </Chip>
                <Chip
                  selected={step.kind === 'rest'}
                  className="min-h-9 py-1"
                  onClick={() => update(i, { kind: 'rest' })}
                >
                  Descanso
                </Chip>
              </div>
              <button
                type="button"
                aria-label={`Quitar fase ${i + 1}`}
                disabled={form.steps.length <= 1}
                onClick={() => set({ steps: form.steps.filter((_, j) => j !== i) })}
                className="hover:bg-accent rounded-full p-2 disabled:opacity-30"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`step-${i}-label`} className="text-sm">
                  Nombre
                </Label>
                <Input
                  id={`step-${i}-label`}
                  value={step.label}
                  maxLength={40}
                  placeholder={step.kind === 'work' ? 'Trabajo' : 'Descanso'}
                  onChange={(e) => update(i, { label: e.target.value })}
                  className="h-12"
                />
              </div>
              <QuantityInput
                id={`step-${i}-duration`}
                label="Duración"
                value={step.duration}
                onChange={(v) => update(i, { duration: v })}
                quantity={{ kind: 'duration', bare: 's' }}
              />
            </div>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        disabled={form.steps.length >= MAX_SEQUENCE_STEPS}
        onClick={() =>
          set({
            steps: [
              ...form.steps,
              form.steps.at(-1)?.kind === 'work'
                ? { kind: 'rest', label: 'Descanso', duration: '20' }
                : { kind: 'work', label: 'Trabajo', duration: '40' },
            ],
          })
        }
      >
        <Plus /> Añadir fase
      </Button>
      <QuantityInput
        id="tool-rounds"
        label="Rondas"
        value={form.rounds}
        onChange={(v) => set({ rounds: v })}
        quantity={{ kind: 'count', unit: 'rondas' }}
        steps={[1]}
      />
    </div>
  )
}

function SaveFavorite({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Star /> Guardar como favorito
      </Button>
    )
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSave(name.trim().slice(0, 60))
        setName('')
        setOpen(false)
      }}
    >
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor="favorite-name">Nombre del favorito</Label>
        <Input
          id="favorite-name"
          autoFocus
          value={name}
          maxLength={60}
          placeholder="p. ej. EMOM piernas"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!name.trim()}>
        Guardar
      </Button>
    </form>
  )
}

function RunView({
  run,
  setRun,
  userId,
  fullscreen,
  setFullscreen,
  onRepeat,
}: {
  run: ToolRun
  setRun: (r: ToolRun | null) => void
  userId: string
  fullscreen: boolean
  setFullscreen: (v: boolean) => void
  onRepeat: () => void
}) {
  const schedule = buildToolSchedule(run.config)
  const running = run.timer.startedAt !== null && run.timer.finishedAt === null
  const now = useNow(250, running)
  const view = timerView(schedule, run.timer, now)
  const live = view.status === 'running' || view.status === 'paused'
  useWakeLock(live)
  const [saving, setSaving] = useState(false)

  const secondsLeft = view.status === 'running' ? secondsLeftInPhase(view) : null
  const phaseKey = `tool:${run.timer.startedAt}:${view.phaseIndex}`
  useCountdownAlerts(phaseKey, secondsLeft, view.status === 'running')
  usePhaseChangeAlert(phaseKey, running)

  // Si el tiempo se acabó (también con la app cerrada), se cierra en el instante exacto.
  useEffect(() => {
    if (view.status === 'done' && run.timer.startedAt !== null && run.timer.finishedAt === null) {
      const endAt = run.timer.startedAt + run.timer.pausedMs + view.totalMs
      setRun({ ...run, timer: finishTimer(run.timer, Math.min(endAt, nowMs())) })
      setFullscreen(false)
    }
  }, [view.status, view.totalMs, run, setRun, setFullscreen])

  const display = timerDisplay({
    config: run.config,
    schedule,
    view,
    workElapsedMs: workElapsedMs(schedule, run.timer, now),
    exercises: [],
  })
  const paused = view.status === 'paused'
  const update = (timer: ToolRun['timer']) => setRun({ ...run, timer })
  const togglePauseNow = () => update(togglePause(run.timer, nowMs()))
  const finish = () => {
    if (run.config.kind !== 'free' && !confirm('¿Terminar ya?')) return
    update(finishTimer(run.timer, nowMs()))
    setFullscreen(false)
  }
  const skip = () => update(endCurrentPhase(schedule, run.timer, nowMs()).state)
  const amrapAdd = (field: 'rounds' | 'extraReps', delta: number) =>
    setRun({ ...run, amrap: { ...run.amrap, [field]: Math.max(0, run.amrap[field] + delta) } })
  const isAmrap = run.config.kind === 'amrap'
  const prep = display.phase === 'prep'
  const label = TOOL_KIND_LABELS[run.config.kind as ToolTimerKind] ?? 'Cronómetro'

  const controls: FullscreenControl[] = [
    {
      label: 'Sumar 15 segundos',
      content: '+15 s',
      disabled: display.open,
      onClick: () => update(addTime(schedule, run.timer, 15_000, nowMs())),
    },
    {
      label: 'Saltar fase',
      content: (
        <>
          <SkipForward className="size-6" /> Saltar
        </>
      ),
      disabled: run.config.kind === 'free',
      onClick: skip,
    },
    {
      label: 'Terminar',
      content: (
        <>
          <Flag className="size-6" /> Terminar
        </>
      ),
      onClick: finish,
    },
  ]

  if (view.status === 'done') {
    const { durationS } = toolRunTimes(run, now)
    return (
      <section className="flex flex-col gap-3" aria-label="Resultado">
        <div className="rounded-2xl bg-emerald-500/10 p-4 text-center">
          <p className="text-muted-foreground text-xs uppercase">{describeToolTimer(run.config)}</p>
          <p className="text-3xl font-bold tabular-nums">{toolResultText(run, now)}</p>
          <p className="text-muted-foreground text-sm">Tiempo total: {formatClock(durationS)}</p>
        </div>
        <Button size="lg" className="h-14 text-lg" onClick={() => setSaving(true)}>
          <Save /> Guardar como sesión
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onRepeat}>
            <RotateCcw /> Otra vez
          </Button>
          <Button variant="ghost" onClick={() => setRun(null)}>
            Cerrar
          </Button>
        </div>
        <SaveSessionSheet
          open={saving}
          run={run}
          userId={userId}
          onClose={() => setSaving(false)}
          onSaved={() => setRun(null)}
        />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Temporizador en marcha">
      <div
        role="timer"
        className={cn(
          'rounded-2xl p-4 text-center',
          display.phase === 'prep' && 'bg-amber-500/15',
          display.phase === 'rest' && 'bg-emerald-500/15',
          display.phase === 'work' && 'bg-primary/10',
        )}
      >
        <p className="text-sm font-semibold uppercase">
          {paused ? `${display.title} · en pausa` : display.title}
        </p>
        <p
          className={cn(
            'text-7xl leading-none font-bold tabular-nums',
            display.warn && !paused && 'text-destructive',
          )}
        >
          {display.clock}
        </p>
        {display.current && <p className="mt-2 text-xl font-semibold">{display.current}</p>}
        {display.next && <p className="text-muted-foreground text-sm">Siguiente: {display.next}</p>}
        {isAmrap && (
          <p className="mt-2 text-lg">
            <span className="text-3xl font-bold tabular-nums">{run.amrap.rounds}</span> rondas
            {run.amrap.extraReps > 0 && ` + ${run.amrap.extraReps} reps`}
          </p>
        )}
      </div>
      <Button variant="outline" size="lg" onClick={() => setFullscreen(true)}>
        <Maximize2 /> Pantalla completa
      </Button>
      {isAmrap && !prep && (
        <div className="flex flex-col gap-2">
          <BigButton
            variant="primary"
            label="Sumar una ronda"
            onClick={() => amrapAdd('rounds', 1)}
            className="h-20 flex-none text-xl"
          >
            <Plus className="size-7" /> 1 ronda
          </BigButton>
          <div className="flex gap-2">
            <BigButton label="Restar una ronda" onClick={() => amrapAdd('rounds', -1)}>
              −1 ronda
            </BigButton>
            <BigButton label="Sumar una repetición suelta" onClick={() => amrapAdd('extraReps', 1)}>
              <Plus className="size-5" /> rep
            </BigButton>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <BigButton label={paused ? 'Reanudar' : 'Pausa'} onClick={togglePauseNow}>
          {paused ? <Play className="size-6" /> : <Pause className="size-6" />}
        </BigButton>
        {controls.map((c) => (
          <BigButton
            key={c.label}
            label={c.label}
            disabled={c.disabled}
            variant={c.label === 'Terminar' ? 'danger' : 'secondary'}
            onClick={c.onClick}
          >
            {c.content}
          </BigButton>
        ))}
      </div>
      {fullscreen && live && (
        <TimerFullscreen
          display={display}
          paused={paused}
          label={describeToolTimer(run.config) || label}
          onTogglePause={togglePauseNow}
          controls={controls}
          big={
            isAmrap && !prep
              ? {
                  label: 'Sumar una ronda',
                  content: (
                    <>
                      <Plus className="size-8" /> 1 ronda
                    </>
                  ),
                  onClick: () => amrapAdd('rounds', 1),
                }
              : null
          }
          extra={
            isAmrap ? (
              <p className="text-2xl font-bold">
                <span className="text-5xl font-black tabular-nums">{run.amrap.rounds}</span> rondas
              </p>
            ) : null
          }
          onClose={() => setFullscreen(false)}
        />
      )}
    </section>
  )
}

const SESSION_TYPES: { type: SessionType; label: string }[] = [
  ...START_OPTIONS.map((o) => ({ type: o.sessionType, label: o.label })),
  { type: 'other', label: 'Otra' },
]

function SaveSessionSheet({
  open,
  run,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean
  run: ToolRun
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [type, setType] = useState<SessionType>(
    run.config.kind === 'free' || run.config.kind === 'countdown' ? 'other' : 'functional',
  )
  const [title, setTitle] = useState(describeToolTimer(run.config))
  const [rpe, setRpe] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const session = createToolSession(
        userId,
        run,
        { sessionType: type, title, rpe, notes: notes.trim() || null },
        nowMs(),
      )
      await saveFinishedSession(session)
      await queryClient.invalidateQueries({ queryKey: historyQueryKey(userId) })
      onSaved()
      await navigate({
        to: '/entrenar/historial/$sessionId',
        params: { sessionId: session.id },
        search: { nueva: 1 },
        replace: true,
      })
    } catch (error) {
      notifyError(error, 'guardar la sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Guardar como sesión"
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={() => void save()}>
          Guardar sesión
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tipo de sesión">
          {SESSION_TYPES.map((t) => (
            <Chip key={t.type} selected={type === t.type} onClick={() => setType(t.type)}>
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tool-session-title">Título</Label>
          <Input
            id="tool-session-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Esfuerzo (RPE, opcional)</p>
          <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="RPE">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <Chip
                key={n}
                selected={rpe === n}
                className="px-0"
                onClick={() => setRpe(rpe === n ? null : n)}
              >
                {n}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tool-session-notes">Notas</Label>
          <Textarea
            id="tool-session-notes"
            value={notes}
            placeholder="Qué ejercicios hiciste, cómo te sentiste…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Sheet>
  )
}
