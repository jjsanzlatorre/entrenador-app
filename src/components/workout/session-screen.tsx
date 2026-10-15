import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  cancelEdit,
  discardActiveSession,
  finishActiveSession,
  saveEditedSession,
  updateActiveSession,
} from '@/lib/workout/active-session'
import { unlockAudio } from '@/lib/workout/alerts'
import { getExerciseHistory, getLastPerformance } from '@/lib/workout/api'
import { elapsedMinutes, sessionStats } from '@/lib/workout/calc'
import { formatClock } from '@/lib/workout/format'
import { formatWhen } from '@/lib/workout/when'
import {
  useCatalog,
  useEquipment,
  useLastPerformance,
  useNow,
  useWakeLock,
} from '@/lib/workout/hooks'
import { sessionHeaderStats } from '@/lib/workout/summary'
import * as ops from '@/lib/workout/session-ops'
import { suggestionFor } from '@/lib/workout/suggestion'
import { cardioExerciseFor } from '@/lib/workout/session-kinds'
import * as timed from '@/lib/workout/timed-blocks'
import type { Exercise, LocalSession } from '@/lib/workout/types'
import { PairBanner } from '@/components/partners/pair'
import { AppMenuButton } from '@/components/layout/app-menu'
import { Tip } from '@/components/help/tip'
import { notifyUndoable, notifyWarning } from '@/lib/notify'
import { useLongPressDrag } from '@/lib/plan/use-long-press-drag'
import { getActiveSession } from '@/lib/workout/active-session'
import { AddBlockSheet, type NewBlock } from './add-block-sheet'
import { BlockCard, type BlockActions } from './block-card'
import { ExercisePicker, type PickerMode } from './exercise-picker'
import { FinishSheet } from './finish-sheet'
import { RestTimerBar } from './rest-timer-bar'
import { SyncBadge } from './sync-badge'
import { TimedBlockCard, type TimedBlockActions } from './timed-block-card'
import { SoundToggle } from './timer-controls'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function SessionScreen({ session }: { session: LocalSession }) {
  const navigate = useNavigate()
  const live = session.mode === 'live'
  // «Registrar entreno pasado»: sin temporizadores ni cuenta en vivo; se guarda como nueva.
  const past = session.mode === 'past'
  const catalog = useCatalog(session.userId)
  const equipment = useEquipment(session.userId)
  const exerciseIds = useMemo(
    () => session.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)),
    [session.blocks],
  )
  const last = useLastPerformance(session.userId, exerciseIds, session.id)
  const now = useNow(1000, live)
  useWakeLock(live)

  const [picker, setPicker] = useState<PickerMode | null>(null)
  const [addingBlock, setAddingBlock] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [manualSelection, setManualSelection] = useState<string | null>(null)

  const nextPending = ops.nextPendingSetId(session)
  const allSets = session.blocks.flatMap((b) => b.sets)
  const selectedSetId =
    manualSelection && allSets.some((s) => s.id === manualSelection && !s.completed)
      ? manualSelection
      : nextPending
  const stats = sessionStats(session)
  const pendingSets = allSets.filter((s) => !s.completed).length

  const withLast = useCallback(
    async (exercise: Exercise) =>
      (await getLastPerformance(session.userId, [exercise.id], session.id)).get(exercise.id) ??
      null,
    [session.userId, session.id],
  )

  async function handlePick(exercise: Exercise) {
    const mode = picker
    setPicker(null)
    if (!mode) return
    const lastPerf = await withLast(exercise)
    // Sugerencia de peso (§10) solo al registrar en directo, no al editar una sesión pasada.
    const suggestion = live
      ? suggestionFor(
          exercise,
          exercise.id,
          (await getExerciseHistory(session.userId, [exercise.id], session.id)).get(exercise.id),
        )
      : null
    const t = Date.now()
    updateActiveSession((s) => {
      const next =
        mode.kind === 'superset'
          ? ops.addToSuperset(s, mode.blockId, exercise, lastPerf, t)
          : mode.kind === 'substitute'
            ? ops.substituteExercise(s, mode.blockId, mode.exercise.id, exercise, lastPerf, t)
            : ops.addExerciseBlock(s, exercise, lastPerf, t)
      const blockId = mode.kind === 'add' ? next.blocks.at(-1)?.id : mode.blockId
      return suggestion && blockId ? ops.applyWeightSuggestion(next, blockId, suggestion, t) : next
    })
    setManualSelection(null)
    void last.refetch()
    if (mode.kind === 'add') {
      requestAnimationFrame(() =>
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
      )
    }
  }

  const actions: BlockActions = {
    onSelectSet: (setId) => setManualSelection(setId),
    onChangeSet: (setId, patch) =>
      updateActiveSession((s) => ops.updateSetAndFollowing(s, setId, patch, Date.now())),
    onToggleComplete: (setId) => {
      unlockAudio()
      updateActiveSession((s) => ops.toggleSetComplete(s, setId, Date.now()))
      setManualSelection(null)
    },
    onToggleWarmup: (setId) => updateActiveSession((s) => ops.toggleWarmup(s, setId, Date.now())),
    onRemoveSet: (setId) => {
      const current = getActiveSession()
      const block = current?.blocks.find((b) => b.sets.some((x) => x.id === setId))
      const position = block?.sets.findIndex((x) => x.id === setId) ?? -1
      const removed = block?.sets[position]
      updateActiveSession((s) => ops.removeSet(s, setId, Date.now()))
      if (block && removed) {
        notifyUndoable(`Serie ${removed.setIndex + 1} borrada`, () =>
          updateActiveSession((s) => ops.restoreSet(s, block.id, removed, position, Date.now())),
        )
      }
    },
    onMergeNext: (blockId) => updateActiveSession((s) => ops.mergeWithNext(s, blockId, Date.now())),
    onSplit: (blockId, exerciseId) =>
      updateActiveSession((s) => ops.splitExercise(s, blockId, exerciseId, Date.now())),
    onAddSet: (blockId, exerciseId) => {
      updateActiveSession((s) => ops.addSet(s, blockId, exerciseId, Date.now()))
      setManualSelection(null)
    },
    onMove: (blockId, direction) =>
      updateActiveSession((s) => ops.moveBlock(s, blockId, direction, Date.now())),
    onAddSuperset: (blockId) => setPicker({ kind: 'superset', blockId }),
    onSubstitute: (blockId, exercise) => setPicker({ kind: 'substitute', blockId, exercise }),
    onRemoveExercise: (blockId, exerciseId) =>
      updateActiveSession((s) => ops.removeExercise(s, blockId, exerciseId, Date.now())),
    onRevertSuggestion: (blockId, exerciseId) =>
      updateActiveSession((s) => ops.revertWeightSuggestion(s, blockId, exerciseId, Date.now())),
    onCompleteHold: past
      ? undefined
      : (setId, durationS) => {
          unlockAudio()
          updateActiveSession((s) => {
            const t = Date.now()
            return ops.toggleSetComplete(ops.updateSet(s, setId, { durationS }, t), setId, t)
          })
          setManualSelection(null)
        },
  }

  // Mantener pulsado el nombre de un ejercicio y soltarlo sobre otro bloque: superserie.
  const { drag, bind } = useLongPressDrag((sourceId, targetId) => {
    const before = getActiveSession()
    updateActiveSession((s) => ops.mergeBlocks(s, sourceId, targetId, Date.now()))
    if (getActiveSession() === before) notifyWarning('Esos ejercicios no se pueden unir')
  }, 'drop-block')
  const blockDrag = { bind, over: drag?.overDate ?? null, dragging: drag?.id ?? null }

  const skipRest = useCallback(() => updateActiveSession((s) => ops.clearRest(s)), [])

  // Temporizadores que terminaron con la app cerrada o en segundo plano: se cierran al volver.
  const settleTimers = useCallback(
    () => updateActiveSession((s) => timed.settleFinishedTimers(s, Date.now())),
    [],
  )
  useEffect(() => {
    settleTimers()
    const onVisible = () => document.visibilityState === 'visible' && settleTimers()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [settleTimers])

  const running = timed.runningTimedBlock(session)

  const timedActions: TimedBlockActions = {
    onTimer: (blockId, action) => {
      unlockAudio()
      updateActiveSession((s) => timed.applyTimerAction(s, blockId, action, Date.now()))
    },
    onAmrap: (blockId, field, delta) =>
      updateActiveSession((s) => timed.amrapAdd(s, blockId, field, delta, Date.now())),
    onSettle: settleTimers,
    onChangeSet: (setId, patch) =>
      updateActiveSession((s) => ops.updateSet(s, setId, patch, Date.now())),
    onToggleComplete: (setId) =>
      updateActiveSession((s) => ops.toggleSetComplete(s, setId, Date.now())),
    onRemoveSet: (setId) => updateActiveSession((s) => ops.removeSet(s, setId, Date.now())),
    onMove: (blockId, direction) =>
      updateActiveSession((s) => ops.moveBlock(s, blockId, direction, Date.now())),
    onRemoveBlock: (blockId) =>
      updateActiveSession((s) => timed.removeBlock(s, blockId, Date.now())),
  }

  async function handleNewBlock(block: NewBlock) {
    if (block.kind === 'straight') {
      setPicker({ kind: 'add' })
      return
    }
    if (block.kind === 'circuit') {
      const lastMap = await getLastPerformance(
        session.userId,
        block.exercises.map((e) => e.id),
        session.id,
      )
      const t = Date.now()
      updateActiveSession((s) =>
        timed.addCircuitBlock(
          s,
          block.config,
          block.exercises.map((e) => ({ exercise: e, last: lastMap.get(e.id) })),
          t,
        ),
      )
    } else {
      const t = Date.now()
      updateActiveSession((s) => timed.addTimedBlock(s, block.config, block.exercises, t))
    }
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
    )
  }

  async function handleSave(details: ops.SessionDetailsPatch) {
    setSaving(true)
    try {
      const saved =
        live || past ? await finishActiveSession(details) : await saveEditedSession(details)
      if (saved) {
        await navigate({
          to: '/entrenar/historial/$sessionId',
          params: { sessionId: saved.id },
          search: { nueva: live || past ? 1 : undefined },
          replace: true,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDiscard() {
    if (live || past) {
      if (!confirm('¿Descartar la sesión? Se borrarán todas sus series.')) return
      await discardActiveSession()
      await navigate({ to: '/entrenar', replace: true })
    } else {
      await cancelEdit()
      await navigate({
        to: '/entrenar/historial/$sessionId',
        params: { sessionId: session.id },
        replace: true,
      })
    }
  }

  const restExercise = session.rest ? catalog.byId.get(session.rest.exerciseId) : undefined
  const elapsedS = Math.max(0, (now - new Date(session.startedAt).getTime()) / 1000)

  const headerStats = sessionHeaderStats(session, stats)

  return (
    <div className="pb-safe-40 flex flex-col">
      <header className="bg-background/95 top-safe sticky z-30 border-b px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            to="/entrenar"
            aria-label="Volver a Entrenar (la sesión sigue abierta)"
            className="hover:bg-accent -ml-1 rounded-full p-2"
          >
            <ChevronLeft className="size-6" />
          </Link>
          <div className="min-w-0 flex-1">
            <input
              aria-label="Título de la sesión"
              defaultValue={session.title}
              key={session.id}
              onBlur={(e) => {
                const title = e.target.value.trim()
                if (title !== session.title)
                  updateActiveSession((s) => ops.updateDetails(s, { title }, Date.now()))
              }}
              className="w-full truncate bg-transparent text-lg font-bold outline-none"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              {live ? (
                <span className="font-semibold tabular-nums">{formatClock(elapsedS)}</span>
              ) : past ? (
                <span className="font-semibold" data-testid="past-badge">
                  Entreno pasado · {formatWhen(new Date(session.startedAt).getTime(), now)}
                </span>
              ) : (
                <span className="text-muted-foreground">Editando</span>
              )}
              <span className="text-muted-foreground">{headerStats}</span>
              <SyncBadge compact />
            </div>
          </div>
          <SoundToggle className="-mr-1" />
          <AppMenuButton className="-mr-1" />
          <Button size="lg" onClick={() => setFinishing(true)} className="h-11 px-4">
            {live ? 'Terminar' : 'Guardar'}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-3">
        {session.pairGroupId && <PairBanner session={session} />}
        {catalog.isError && catalog.byId.size === 0 && (
          <p className="text-destructive rounded-lg border p-3 text-sm">{catalog.error.message}</p>
        )}

        {past && (
          <p className="text-muted-foreground rounded-xl border p-3 text-sm">
            Apunta lo que hiciste: ejercicios, series y pesos. Marca ✓ las series hechas (o «Marcar
            todas como hechas» al guardar) y pon la duración al final.
          </p>
        )}
        {live && session.blocks.some((b) => !timed.isTimedBlock(b)) && (
          <Tip id="session-sets" title="Registrar series rápido">
            ✓ o desliza la serie a la derecha para completarla (la siguiente se rellena con los
            mismos valores); a la izquierda, para borrarla. Mantén pulsado el nombre de un ejercicio
            y suéltalo sobre otro para hacer una superserie.
          </Tip>
        )}
        {session.blocks.length === 0 && (
          <div className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center">
            <p className="font-medium">Sesión vacía</p>
            <p className="text-sm">Añade el primer ejercicio para empezar.</p>
          </div>
        )}

        {session.blocks.map((block, i) =>
          timed.isTimedBlock(block) ? (
            <TimedBlockCard
              key={block.id}
              block={block}
              letter={LETTERS[i] ?? String(i + 1)}
              isFirst={i === 0}
              isLast={i === session.blocks.length - 1}
              exercisesById={catalog.byId}
              live={live}
              anotherRunning={Boolean(running && running.id !== block.id)}
              actions={timedActions}
            />
          ) : (
            <BlockCard
              key={block.id}
              block={block}
              letter={LETTERS[i] ?? String(i + 1)}
              isFirst={i === 0}
              isLast={i === session.blocks.length - 1}
              exercisesById={catalog.byId}
              lastByExercise={last.data}
              selectedSetId={selectedSetId}
              actions={actions}
              groupable={ops.isGroupable(block)}
              canMergeNext={ops.canMergeWithNext(session, block.id)}
              drag={blockDrag}
            />
          ),
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="lg"
            variant="outline"
            className="border-primary text-primary h-16 border-2 border-dashed text-base"
            aria-label="Añadir ejercicio"
            onClick={() => setPicker({ kind: 'add' })}
          >
            <Plus className="size-5" /> Ejercicio
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-primary text-primary h-16 border-2 border-dashed text-base"
            aria-label="Añadir bloque con temporizador"
            onClick={() => setAddingBlock(true)}
          >
            <Plus className="size-5" /> Bloque
          </Button>
        </div>

        <Button variant="ghost" className="text-destructive mt-6" onClick={handleDiscard}>
          <Trash2 /> {live || past ? 'Descartar sesión' : 'Cancelar edición'}
        </Button>
        {live && (
          <p className="text-muted-foreground px-2 text-center text-xs">
            Todo se guarda en el móvil al momento. En iPhone los avisos pueden no sonar con la
            pantalla bloqueada y no vibran; al volver verás el tiempo correcto.
          </p>
        )}
      </div>

      {session.rest && live && (
        <RestTimerBar
          rest={session.rest}
          exerciseName={restExercise?.name ?? ''}
          onAdjust={(delta) => updateActiveSession((s) => ops.adjustRest(s, delta, Date.now()))}
          onTogglePause={() => updateActiveSession((s) => ops.toggleRestPause(s, Date.now()))}
          onSkip={skipRest}
        />
      )}

      <ExercisePicker
        userId={session.userId}
        mode={picker}
        exercises={catalog.data ?? []}
        equipment={equipment.data ?? []}
        excludeIds={
          picker?.kind === 'superset'
            ? (session.blocks
                .find((b) => b.id === picker.blockId)
                ?.exercises.map((e) => e.exerciseId) ?? [])
            : picker?.kind === 'substitute'
              ? [picker.exercise.id]
              : []
        }
        loading={catalog.isPending}
        error={catalog.isError && !catalog.data ? catalog.error.message : null}
        onPick={(e) => void handlePick(e)}
        onClose={() => setPicker(null)}
      />

      <AddBlockSheet
        open={addingBlock}
        exercises={catalog.data ?? []}
        equipment={equipment.data ?? []}
        defaultCardioId={cardioExerciseFor(session.sessionType)}
        onClose={() => setAddingBlock(false)}
        onCreate={(b) => void handleNewBlock(b)}
      />

      {drag &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-hidden
            className="bg-primary text-primary-foreground pointer-events-none fixed z-50 max-w-60 -translate-x-1/2 -translate-y-full rounded-xl px-3 py-2 text-sm font-semibold shadow-lg"
            style={{ left: drag.x, top: drag.y - 12 }}
          >
            {drag.label}
            <span className="block text-xs font-normal opacity-90">
              {drag.overDate && drag.overDate !== drag.id
                ? 'Suelta para hacer superserie'
                : 'Suéltalo sobre otro ejercicio'}
            </span>
          </div>,
          document.body,
        )}

      {finishing && (
        <FinishSheet
          open
          session={session}
          elapsedMin={session.durationMin ?? (past ? null : elapsedMinutes(session.startedAt, now))}
          pendingSets={pendingSets}
          saving={saving}
          onClose={() => setFinishing(false)}
          onSave={(details) => void handleSave(details)}
          onCompleteAll={() => updateActiveSession((s) => ops.completeFilledSets(s, Date.now()))}
        />
      )}
    </div>
  )
}
