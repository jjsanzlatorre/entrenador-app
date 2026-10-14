import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Flag,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipForward,
  Timer,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fieldSpecs } from '@/lib/workout/fields'
import {
  getFullscreenAuto,
  setFullscreenAuto,
  useFullscreenAuto,
} from '@/lib/workout/fullscreen-pref'
import { timerDisplay } from '@/lib/workout/timer-display'
import { formatClock } from '@/lib/workout/format'
import { useNow } from '@/lib/workout/hooks'
import { formatDistance, formatPace, paceKindForExercise } from '@/lib/workout/pace'
import type { SetPatch } from '@/lib/workout/session-ops'
import { isTimedBlock, type TimerAction } from '@/lib/workout/timed-blocks'
import {
  buildSchedule,
  createTimerState,
  secondsLeftInPhase,
  timerView,
  workElapsedMs,
  type TimerConfig,
  type TimerView,
} from '@/lib/workout/timer'
import type { Exercise, LocalBlock } from '@/lib/workout/types'
import { cn } from '@/lib/utils'
import { ExerciseTechniqueSheet } from './exercise-technique'
import { SetRow } from './set-row'
import { BigButton, useCountdownAlerts, usePhaseChangeAlert } from './timer-controls'
import { TimerFullscreen, type FullscreenControl } from './timer-fullscreen'

export const BLOCK_LABELS: Record<string, string> = {
  straight: 'Series',
  superset: 'Superserie',
  circuit: 'Circuito',
  emom: 'EMOM',
  amrap: 'AMRAP',
  tabata: 'Tabata',
  for_time: 'For Time',
  intervals: 'Intervalos',
  free: 'Cronómetro',
}

export function describeTimer(config: TimerConfig) {
  switch (config.kind) {
    case 'emom':
      return config.intervalS === 60
        ? `${config.minutes} min, cada minuto`
        : `${config.minutes} rondas cada ${formatClock(config.intervalS)}`
    case 'amrap':
      return `${formatClock(config.durationS)} máximas rondas`
    case 'tabata':
      return `${config.workS}/${config.restS} s × ${config.rounds}`
    case 'for_time':
      return config.capS ? `cap ${formatClock(config.capS)}` : 'sin límite'
    case 'intervals':
      return `${config.reps} × ${
        config.workDistanceM ? formatDistance(config.workDistanceM) : formatClock(config.workS ?? 0)
      }${config.recoveryS ? ` · rec. ${formatClock(config.recoveryS)}` : ''}`
    case 'free':
      return 'cronómetro libre'
  }
}

export type TimedBlockActions = {
  onTimer: (blockId: string, action: TimerAction) => void
  onAmrap: (blockId: string, field: 'rounds' | 'extraReps', delta: number) => void
  onSettle: () => void
  onChangeSet: (setId: string, patch: SetPatch) => void
  onToggleComplete: (setId: string) => void
  onRemoveSet: (setId: string) => void
  onMove: (blockId: string, direction: -1 | 1) => void
  onRemoveBlock: (blockId: string) => void
}

export function TimedBlockCard({
  block,
  letter,
  isFirst,
  isLast,
  exercisesById,
  live,
  anotherRunning,
  actions,
}: {
  block: LocalBlock
  letter: string
  isFirst: boolean
  isLast: boolean
  exercisesById: Map<string, Exercise>
  live: boolean
  anotherRunning: boolean
  actions: TimedBlockActions
}) {
  const config = isTimedBlock(block) ? block.settings : null
  const timer = block.timer ?? createTimerState()
  const running = timer.startedAt !== null && timer.finishedAt === null
  const now = useNow(250, running)
  const schedule = config ? buildSchedule(config) : []
  const view = timerView(schedule, timer, now)
  const [selectedSet, setSelectedSet] = useState<string | null>(null)
  const [techniqueFor, setTechniqueFor] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const autoFullscreen = useFullscreenAuto('blocks')

  const secondsLeft = view.status === 'running' ? secondsLeftInPhase(view) : null
  const phaseKey = `${block.id}:${view.phaseIndex}`
  useCountdownAlerts(phaseKey, secondsLeft, view.status === 'running')
  usePhaseChangeAlert(phaseKey, running)

  // Si el tiempo se acabó (también con la app cerrada), se cierra el bloque.
  const { onSettle } = actions
  useEffect(() => {
    if (view.status === 'done' && timer.startedAt !== null && timer.finishedAt === null) onSettle()
  }, [view.status, timer.startedAt, timer.finishedAt, onSettle])

  if (!config) return null
  const exerciseName = (id: string) => exercisesById.get(id)?.name ?? id
  const act = (a: TimerAction) => actions.onTimer(block.id, a)
  // Al empezar, a pantalla completa si está activado (se puede cambiar en la propia pantalla).
  const start = (a: 'start' | 'start-now') => {
    act(a)
    if (getFullscreenAuto('blocks')) setFullscreen(true)
  }
  const showFullscreen = fullscreen && (view.status === 'running' || view.status === 'paused')

  return (
    <section
      aria-label={`Bloque ${letter}`}
      className={cn(
        'bg-card rounded-2xl border p-3 shadow-xs',
        running && 'border-primary ring-primary/30 ring-2',
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="bg-primary/10 text-primary mt-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold">
          {letter}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-lg leading-tight font-semibold">
            <Timer className="size-5 shrink-0" /> {BLOCK_LABELS[config.kind]}
          </h3>
          <p className="text-muted-foreground text-sm">{describeTimer(config)}</p>
          {block.exercises.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {block.exercises.map((e, i) => (
                <span key={e.exerciseId}>
                  {i > 0 && ' · '}
                  {e.targetReps ? `${e.targetReps} ` : ''}
                  <button
                    type="button"
                    onClick={() => setTechniqueFor(e.exerciseId)}
                    title="Ver técnica"
                    className="decoration-muted-foreground/50 underline underline-offset-2"
                  >
                    {exerciseName(e.exerciseId)}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
        {view.status === 'idle' && live && (
          <div className="flex">
            <IconButton
              label="Subir bloque"
              disabled={isFirst}
              onClick={() => actions.onMove(block.id, -1)}
            >
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton
              label="Bajar bloque"
              disabled={isLast}
              onClick={() => actions.onMove(block.id, 1)}
            >
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton
              label="Quitar bloque"
              onClick={() => confirm('¿Quitar este bloque?') && actions.onRemoveBlock(block.id)}
            >
              <Trash2 className="text-destructive size-4" />
            </IconButton>
          </div>
        )}
      </div>

      {live && view.status === 'idle' && (
        <div className="flex flex-col gap-2">
          <BigButton
            variant="primary"
            label="Empezar con cuenta atrás de 10 segundos"
            className="flex-none"
            disabled={anotherRunning}
            onClick={() => start(config.kind === 'free' ? 'start-now' : 'start')}
          >
            <Play className="size-6" /> Empezar
          </BigButton>
          {config.kind !== 'free' && (
            <Button variant="ghost" disabled={anotherRunning} onClick={() => start('start-now')}>
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
          {anotherRunning && (
            <p className="text-muted-foreground text-center text-xs">
              Termina antes el bloque que está en marcha.
            </p>
          )}
        </div>
      )}

      {(view.status === 'running' || view.status === 'paused') && (
        <RunningView
          block={block}
          config={config}
          view={view}
          now={now}
          exerciseName={exerciseName}
          onAction={act}
          onAmrap={(field, delta) => actions.onAmrap(block.id, field, delta)}
          onFullscreen={() => setFullscreen(true)}
          fullscreen={showFullscreen}
          onCloseFullscreen={() => setFullscreen(false)}
        />
      )}

      {view.status === 'done' && <ResultView block={block} config={config} />}

      {/* Series: editables al terminar (pesos, reps, distancias). En el bloque continuo
          (cronómetro) siempre visibles, para anotar la distancia o registrar sin cronómetro. */}
      {(view.status === 'done' || !live || config.kind === 'free') && block.sets.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {block.sets.map((set) => {
            const exercise = exercisesById.get(set.exerciseId)
            // En series de intervalos la distancia va en metros («400»), aunque sea carrera.
            const specs = fieldSpecs(exercise).map((spec) =>
              config.kind === 'intervals' && spec.field === 'distanceM'
                ? {
                    ...spec,
                    unit: 'm',
                    step: 25,
                    quantity: { kind: 'distance' as const, bare: 'm' as const },
                    label: 'Distancia (m)',
                  }
                : spec,
            )
            const pace = paceKindForExercise(set.exerciseId)
            const paceText = pace ? formatPace(pace, set.distanceM, set.durationS) : null
            return (
              <div key={set.id}>
                {block.exercises.length > 1 && (
                  <p className="text-muted-foreground px-2 text-xs">
                    {exerciseName(set.exerciseId)}
                  </p>
                )}
                <SetRow
                  set={set}
                  specs={specs}
                  label={`${set.setIndex + 1}`}
                  selected={selectedSet === set.id}
                  onSelect={() => setSelectedSet(set.id)}
                  onChange={(patch) => actions.onChangeSet(set.id, patch)}
                  onToggleComplete={() => actions.onToggleComplete(set.id)}
                  onToggleWarmup={() => undefined}
                  onRemove={() => actions.onRemoveSet(set.id)}
                />
                {paceText && <p className="text-muted-foreground px-3 pb-1 text-xs">{paceText}</p>}
              </div>
            )
          })}
        </div>
      )}
      <ExerciseTechniqueSheet
        exercise={techniqueFor ? exercisesById.get(techniqueFor) : null}
        onClose={() => setTechniqueFor(null)}
      />
    </section>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="hover:bg-accent rounded-full p-2 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function RunningView({
  block,
  config,
  view,
  now,
  exerciseName,
  onAction,
  onAmrap,
  onFullscreen,
  fullscreen,
  onCloseFullscreen,
}: {
  block: LocalBlock
  config: TimerConfig
  view: TimerView
  now: number
  exerciseName: (id: string) => string
  onAction: (a: TimerAction) => void
  onAmrap: (field: 'rounds' | 'extraReps', delta: number) => void
  onFullscreen: () => void
  fullscreen: boolean
  onCloseFullscreen: () => void
}) {
  const phase = view.phase
  const paused = view.status === 'paused'
  const prep = phase?.kind === 'prep'
  const rest = phase?.kind === 'rest'
  const schedule = buildSchedule(config)
  const display = timerDisplay({
    config,
    schedule,
    view,
    workElapsedMs: workElapsedMs(schedule, block.timer ?? createTimerState(), now),
    exercises: block.exercises.map((e) => ({
      name: exerciseName(e.exerciseId),
      targetReps: e.targetReps,
    })),
  })
  const open = display.open
  // En la tarjeta: el ejercicio del minuto o la ronda (EMOM y Tabata), como siempre.
  const detail = config.kind === 'emom' || config.kind === 'tabata' ? display.current : null

  const splits = block.result?.kind === 'intervals' ? block.result.splits : []
  const pace = block.exercises[0] ? paceKindForExercise(block.exercises[0].exerciseId) : null
  const lapMode = config.kind === 'intervals' && config.workDistanceM && phase?.kind === 'work'
  const amrap = config.kind === 'amrap' && block.result?.kind === 'amrap' ? block.result : null

  const finish = () => {
    if (config.kind === 'for_time' || config.kind === 'free' || confirm('¿Terminar el bloque ya?'))
      onAction('finish')
  }
  const controls: FullscreenControl[] = [
    {
      label: 'Sumar 15 segundos',
      content: '+15 s',
      disabled: open,
      onClick: () => onAction('add-15'),
    },
    ...(lapMode
      ? []
      : [
          {
            label: 'Saltar fase',
            content: (
              <>
                <SkipForward className="size-6" /> Saltar
              </>
            ),
            disabled: config.kind === 'free' || config.kind === 'for_time',
            onClick: () => onAction('skip'),
          },
        ]),
    {
      label: 'Terminar bloque',
      content: (
        <>
          <Flag className="size-6" /> Terminar
        </>
      ),
      onClick: finish,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'relative rounded-2xl p-4 text-center',
          prep && 'bg-amber-500/15',
          rest && 'bg-emerald-500/15',
          !prep && !rest && 'bg-primary/10',
        )}
        role="timer"
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
        {detail && <p className="mt-2 text-2xl font-semibold">{detail}</p>}
        {amrap && (
          <p className="mt-2 text-lg">
            <span className="text-3xl font-bold tabular-nums">{amrap.rounds}</span> rondas
            {amrap.extraReps > 0 && ` + ${amrap.extraReps} reps`}
          </p>
        )}
      </div>

      <Button variant="outline" size="lg" onClick={onFullscreen}>
        <Maximize2 /> Pantalla completa
      </Button>

      {amrap && !prep && (
        <div className="flex flex-col gap-2">
          <BigButton
            variant="primary"
            label="Sumar una ronda"
            onClick={() => onAmrap('rounds', 1)}
            className="h-20 flex-none text-xl"
          >
            <Plus className="size-7" /> 1 ronda
          </BigButton>
          <div className="flex items-center gap-2">
            <BigButton label="Restar una ronda" onClick={() => onAmrap('rounds', -1)}>
              −1 ronda
            </BigButton>
            <BigButton
              label="Restar una repetición suelta"
              onClick={() => onAmrap('extraReps', -1)}
            >
              <Minus className="size-5" /> rep
            </BigButton>
            <BigButton label="Sumar una repetición suelta" onClick={() => onAmrap('extraReps', 1)}>
              <Plus className="size-5" /> rep
            </BigButton>
          </div>
        </div>
      )}

      {lapMode && (
        <BigButton
          variant="primary"
          label="Vuelta hecha"
          onClick={() => onAction('skip')}
          className="h-20 flex-none text-xl"
        >
          <Flag className="size-7" /> Serie hecha
        </BigButton>
      )}

      <div className="flex gap-2">
        <BigButton label={paused ? 'Reanudar' : 'Pausa'} onClick={() => onAction('toggle-pause')}>
          {paused ? <Play className="size-6" /> : <Pause className="size-6" />}
        </BigButton>
        <BigButton label="Sumar 15 segundos" disabled={open} onClick={() => onAction('add-15')}>
          +15 s
        </BigButton>
        {!lapMode && (
          <BigButton
            label="Saltar fase"
            disabled={config.kind === 'free' || config.kind === 'for_time'}
            onClick={() => onAction('skip')}
          >
            <SkipForward className="size-6" />
          </BigButton>
        )}
        <BigButton variant="danger" label="Terminar bloque" onClick={finish}>
          <Flag className="size-6" />
        </BigButton>
      </div>

      {splits.length > 0 && (
        <ol className="text-sm">
          {splits.map((s, i) => (
            <li key={i} className="flex justify-between border-b py-1 tabular-nums">
              <span>Serie {i + 1}</span>
              <span>
                {formatClock(s.durationS)}
                {pace && s.distanceM ? ` · ${formatPace(pace, s.distanceM, s.durationS)}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {fullscreen && (
        <TimerFullscreen
          display={display}
          paused={paused}
          label={BLOCK_LABELS[config.kind] ?? 'Temporizador'}
          onTogglePause={() => onAction('toggle-pause')}
          controls={controls}
          big={
            amrap && !prep
              ? {
                  label: 'Sumar una ronda',
                  content: (
                    <>
                      <Plus className="size-8" /> 1 ronda
                    </>
                  ),
                  onClick: () => onAmrap('rounds', 1),
                }
              : lapMode
                ? {
                    label: 'Vuelta hecha',
                    content: (
                      <>
                        <Flag className="size-8" /> Serie hecha
                      </>
                    ),
                    onClick: () => onAction('skip'),
                  }
                : null
          }
          extra={
            amrap ? (
              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  aria-label="Restar una ronda"
                  onClick={() => onAmrap('rounds', -1)}
                  className="h-12 rounded-xl bg-white/20 px-3 text-lg font-bold"
                >
                  −1
                </button>
                <p className="text-2xl font-bold">
                  <span className="text-5xl font-black tabular-nums">{amrap.rounds}</span> rondas
                  {amrap.extraReps > 0 && ` + ${amrap.extraReps}`}
                </p>
              </div>
            ) : null
          }
          onClose={onCloseFullscreen}
        />
      )}
    </div>
  )
}

export function resultSummary(block: LocalBlock) {
  const r = block.result
  if (!r) return null
  switch (r.kind) {
    case 'emom':
      return `${r.minutesCompleted} de ${r.minutes} minutos`
    case 'amrap':
      return `${r.rounds} rondas${r.extraReps ? ` + ${r.extraReps} reps` : ''} en ${formatClock(r.durationS)}`
    case 'tabata':
      return `${r.roundsCompleted} de ${r.rounds} rondas`
    case 'for_time':
      return r.timeS === null
        ? null
        : `${formatClock(r.timeS)}${r.capped ? ' (cap alcanzado)' : ''}`
    case 'intervals':
      return r.splits.length > 0 ? `${r.splits.length} series` : null
    case 'free':
      return r.elapsedS ? formatClock(r.elapsedS) : null
    case 'circuit':
      return `${r.roundsCompleted} de ${r.rounds} rondas`
  }
}

function ResultView({ block, config }: { block: LocalBlock; config: TimerConfig }) {
  const summary = resultSummary(block)
  return (
    <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
      <p className="text-muted-foreground text-xs uppercase">
        {BLOCK_LABELS[config.kind]} terminado
      </p>
      {summary && <p className="text-2xl font-bold tabular-nums">{summary}</p>}
      <p className="text-muted-foreground mt-1 text-xs">
        Revisa y ajusta las series si hace falta.
      </p>
    </div>
  )
}
