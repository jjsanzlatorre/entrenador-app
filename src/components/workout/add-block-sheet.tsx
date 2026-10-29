import { useState } from 'react'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { QuantityInput } from '@/components/ui/quantity-input'
import { parseCount, parseDistance, parseDuration, type QuantityKind } from '@/lib/input/quantity'
import { draftProblems, draftToInput, emptyDraft, type RoundDraft } from '@/lib/workout/round-draft'
import type { RoundBlockInput } from '@/lib/workout/rounds'
import type { Exercise, LastPerformance } from '@/lib/workout/types'
import type { TimerConfig } from '@/lib/workout/timer'
import { cn } from '@/lib/utils'
import { ExercisePicker } from './exercise-picker'
import { RoundBlockEditor } from './round-block-editor'

export type NewBlockKind =
  | 'straight'
  | 'circuit'
  | 'emom'
  | 'amrap'
  | 'tabata'
  | 'for_time'
  | 'intervals'
  | 'free'
  | 'copy'
  | 'text'

export type NewBlock =
  | { kind: 'straight' }
  | { kind: 'rounds'; input: RoundBlockInput }
  // Abren su propia hoja (copiar de otra sesión, escribir el entreno).
  | { kind: 'copy' }
  | { kind: 'text' }
  | {
      kind: 'timed'
      config: TimerConfig
      exercises: { exercise: Exercise; targetReps: number | null }[]
    }

const OPTIONS: { kind: NewBlockKind; label: string; hint: string }[] = [
  { kind: 'straight', label: 'Ejercicio', hint: 'Series con descanso' },
  { kind: 'circuit', label: 'Superserie / circuito', hint: 'Varios ejercicios × rondas' },
  { kind: 'emom', label: 'EMOM', hint: 'Cada minuto, en el minuto' },
  { kind: 'amrap', label: 'AMRAP', hint: 'Máximas rondas en X min' },
  { kind: 'tabata', label: 'Tabata / HIIT', hint: 'Trabajo/descanso × rondas' },
  { kind: 'for_time', label: 'For Time', hint: 'Lo antes posible, con cap' },
  { kind: 'intervals', label: 'Intervalos', hint: 'Carrera, natación o bici' },
  { kind: 'free', label: 'Cronómetro', hint: 'Continuo o libre' },
  { kind: 'copy', label: 'Copiar bloque', hint: 'De otra sesión' },
  { kind: 'text', label: 'Escribir entreno', hint: '«a 10 + b 45s, x4»' },
]

// Abren otra hoja o el buscador directamente (sin formulario aquí).
const DIRECT = new Set<NewBlockKind>(['straight', 'copy', 'text'])

type TimerKind = Exclude<NewBlockKind, 'straight' | 'circuit' | 'copy' | 'text'>
const isTimerKind = (kind: NewBlockKind | null): kind is TimerKind =>
  kind !== null && kind !== 'circuit' && !DIRECT.has(kind)

const CARDIO_IDS = [
  'run',
  'swim_freestyle',
  'swim_backstroke',
  'swim_breaststroke',
  'swim_drills',
  'bike',
  'spinning',
  'row_erg',
  'skierg',
  'air_bike',
]

export function AddBlockSheet({
  open,
  exercises,
  equipment,
  defaultCardioId,
  userId,
  loadLast,
  onClose,
  onCreate,
}: {
  open: boolean
  exercises: Exercise[]
  equipment: string[]
  defaultCardioId: string | null
  userId?: string
  loadLast?: (exercise: Exercise) => Promise<LastPerformance | null>
  onClose: () => void
  onCreate: (block: NewBlock) => void
}) {
  const [kind, setKind] = useState<NewBlockKind | null>(null)

  function close() {
    setKind(null)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      className="h-[92dvh]"
      title={
        kind ? (
          <button type="button" onClick={() => setKind(null)} className="flex items-center gap-1">
            <ChevronLeft className="size-5" /> {OPTIONS.find((o) => o.kind === kind)?.label}
          </button>
        ) : (
          'Añadir bloque'
        )
      }
    >
      {!kind && (
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => {
                if (DIRECT.has(o.kind)) {
                  onCreate({ kind: o.kind as 'straight' | 'copy' | 'text' })
                  close()
                } else setKind(o.kind)
              }}
              className="bg-secondary flex min-h-20 flex-col items-start justify-center rounded-xl p-3 text-left active:scale-95"
            >
              <span className="text-base font-bold">{o.label}</span>
              <span className="text-muted-foreground text-xs">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      {kind === 'circuit' && (
        <RoundsForm
          exercises={exercises}
          equipment={equipment}
          userId={userId}
          loadLast={loadLast}
          onCreate={(input) => {
            onCreate({ kind: 'rounds', input })
            close()
          }}
        />
      )}
      {isTimerKind(kind) && (
        <BlockForm
          key={kind}
          kind={kind}
          exercises={exercises}
          equipment={equipment}
          defaultCardioId={defaultCardioId}
          onCreate={(block) => {
            onCreate(block)
            close()
          }}
        />
      )}
    </Sheet>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  quantity = { kind: 'count' },
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  quantity?: QuantityKind
}) {
  return (
    <QuantityInput id={id} label={label} value={value} onChange={onChange} quantity={quantity} />
  )
}

const SECONDS: QuantityKind = { kind: 'duration', bare: 's' }
const MINUTES: QuantityKind = { kind: 'duration', bare: 'min' }
const METERS: QuantityKind = { kind: 'distance', bare: 'm' }

type Picked = { exercise: Exercise; targetReps: string }

function BlockForm({
  kind,
  exercises,
  equipment,
  defaultCardioId,
  onCreate,
}: {
  kind: TimerKind
  exercises: Exercise[]
  equipment: string[]
  defaultCardioId: string | null
  onCreate: (block: NewBlock) => void
}) {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const cardioDefault = byId.get(defaultCardioId ?? 'run') ?? byId.get('run')
  const [picked, setPicked] = useState<Picked[]>(() =>
    (kind === 'intervals' || kind === 'free') && cardioDefault
      ? [{ exercise: cardioDefault, targetReps: '' }]
      : [],
  )
  const [picking, setPicking] = useState(false)
  const [p, setP] = useState({
    minutes: '12',
    intervalS: '60',
    amrapMin: '10',
    workS: '20',
    restS: '10',
    rounds: '8',
    capMin: '',
    reps: '6',
    mode: 'distance' as 'distance' | 'time',
    distanceM: '400',
    intervalWorkS: '180',
    recoveryS: '90',
  })
  const set = (key: keyof typeof p) => (v: string) => setP((prev) => ({ ...prev, [key]: v }))
  const n = (v: string, fallback: number) => parseCount(v) ?? fallback
  // Tiempos en segundos: número suelto en s (o en min) y también «1:30», «2'30"», «3 min»…
  const sec = (v: string, fallback: number) => parseDuration(v, 's') ?? fallback
  const min = (v: string, fallback: number) => parseDuration(v, 'min') ?? fallback * 60

  const single = kind === 'intervals' || kind === 'free'
  const needsExercise = kind !== 'free'
  const showReps = kind === 'emom' || kind === 'amrap' || kind === 'for_time'

  function create() {
    const inputs = picked.map((x) => ({
      exercise: x.exercise,
      targetReps: parseCount(x.targetReps),
    }))
    let config: TimerConfig
    switch (kind) {
      case 'emom':
        config = { kind: 'emom', minutes: n(p.minutes, 12), intervalS: sec(p.intervalS, 60) }
        break
      case 'amrap':
        config = { kind: 'amrap', durationS: min(p.amrapMin, 10) }
        break
      case 'tabata':
        config = {
          kind: 'tabata',
          workS: sec(p.workS, 20),
          restS: sec(p.restS, 10),
          rounds: n(p.rounds, 8),
        }
        break
      case 'for_time': {
        const cap = parseDuration(p.capMin, 'min')
        config = { kind: 'for_time', capS: cap ? cap : null }
        break
      }
      case 'intervals':
        config = {
          kind: 'intervals',
          reps: n(p.reps, 6),
          workDistanceM: p.mode === 'distance' ? (parseDistance(p.distanceM, 'm') ?? 400) : null,
          workS: p.mode === 'time' ? sec(p.intervalWorkS, 180) : null,
          recoveryS: sec(p.recoveryS, 90),
        }
        break
      case 'free':
        config = { kind: 'free' }
        break
    }
    onCreate({ kind: 'timed', config, exercises: inputs })
  }

  const valid = !needsExercise || picked.length > 0

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="grid grid-cols-2 gap-3">
        {kind === 'emom' && (
          <>
            <NumberField
              id="emom-min"
              label="Rondas (minutos)"
              value={p.minutes}
              onChange={set('minutes')}
            />
            <NumberField
              id="emom-int"
              label="Cada"
              value={p.intervalS}
              onChange={set('intervalS')}
              quantity={SECONDS}
            />
          </>
        )}
        {kind === 'amrap' && (
          <NumberField
            id="amrap-min"
            label="Duración"
            value={p.amrapMin}
            onChange={set('amrapMin')}
            quantity={MINUTES}
          />
        )}
        {kind === 'tabata' && (
          <>
            <NumberField
              id="tb-work"
              label="Trabajo"
              value={p.workS}
              onChange={set('workS')}
              quantity={SECONDS}
            />
            <NumberField
              id="tb-rest"
              label="Descanso"
              value={p.restS}
              onChange={set('restS')}
              quantity={SECONDS}
            />
            <NumberField id="tb-rounds" label="Rondas" value={p.rounds} onChange={set('rounds')} />
          </>
        )}
        {kind === 'for_time' && (
          <NumberField
            id="ft-cap"
            label="Tiempo límite (opcional)"
            value={p.capMin}
            onChange={set('capMin')}
            quantity={MINUTES}
          />
        )}
        {kind === 'intervals' && (
          <>
            <NumberField id="iv-reps" label="Series" value={p.reps} onChange={set('reps')} />
            <NumberField
              id="iv-rec"
              label="Recuperación"
              value={p.recoveryS}
              onChange={set('recoveryS')}
              quantity={SECONDS}
            />
            <div
              className="col-span-2 grid grid-cols-2 gap-2"
              role="group"
              aria-label="Cada serie por"
            >
              {(['distance', 'time'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={p.mode === m}
                  onClick={() => setP((prev) => ({ ...prev, mode: m }))}
                  className={cn(
                    'h-11 rounded-lg border font-medium',
                    p.mode === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background',
                  )}
                >
                  {m === 'distance' ? 'Por distancia' : 'Por tiempo'}
                </button>
              ))}
            </div>
            {p.mode === 'distance' ? (
              <NumberField
                id="iv-dist"
                label="Distancia por serie"
                value={p.distanceM}
                onChange={set('distanceM')}
                quantity={METERS}
              />
            ) : (
              <NumberField
                id="iv-time"
                label="Tiempo por serie"
                value={p.intervalWorkS}
                onChange={set('intervalWorkS')}
                quantity={SECONDS}
              />
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {single ? 'Actividad' : 'Ejercicios'}
          {kind === 'emom' && (
            <span className="text-muted-foreground font-normal"> (rotan cada minuto)</span>
          )}
        </p>
        {single && (
          <div className="flex flex-wrap gap-1.5">
            {CARDIO_IDS.map((id) => byId.get(id))
              .filter((e): e is Exercise => Boolean(e))
              .map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={picked[0]?.exercise.id === e.id}
                  onClick={() => setPicked([{ exercise: e, targetReps: '' }])}
                  className={cn(
                    'h-9 rounded-full border px-3 text-sm',
                    picked[0]?.exercise.id === e.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background',
                  )}
                >
                  {e.name}
                </button>
              ))}
            {kind === 'free' && (
              <button
                type="button"
                aria-pressed={picked.length === 0}
                onClick={() => setPicked([])}
                className={cn(
                  'h-9 rounded-full border px-3 text-sm',
                  picked.length === 0
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background',
                )}
              >
                Solo cronómetro
              </button>
            )}
          </div>
        )}
        {!single && (
          <>
            <ul className="flex flex-col gap-2">
              {picked.map((x, i) => (
                <li key={x.exercise.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{x.exercise.name}</span>
                  {showReps && (
                    <Input
                      aria-label={`Repeticiones de ${x.exercise.name}`}
                      inputMode="numeric"
                      placeholder="reps"
                      value={x.targetReps}
                      onChange={(e) =>
                        setPicked((prev) =>
                          prev.map((y, j) => (j === i ? { ...y, targetReps: e.target.value } : y)),
                        )
                      }
                      className="h-10 w-20 text-center"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Quitar ${x.exercise.name}`}
                    onClick={() => setPicked((prev) => prev.filter((_, j) => j !== i))}
                    className="text-destructive p-2"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="outline" onClick={() => setPicking(true)}>
              <Plus /> Añadir ejercicio
            </Button>
          </>
        )}
      </div>

      <Button size="lg" className="h-14 text-lg" disabled={!valid} onClick={create}>
        Crear bloque
      </Button>

      <ExercisePicker
        mode={picking ? { kind: 'add' } : null}
        exercises={exercises}
        equipment={equipment}
        excludeIds={picked.map((x) => x.exercise.id)}
        loading={false}
        error={null}
        onPick={(e) => {
          setPicked((prev) => [...prev, { exercise: e, targetReps: '' }])
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  )
}

// Superserie o circuito: ejercicios con su objetivo, rondas y descansos.
function RoundsForm({
  exercises,
  equipment,
  userId,
  loadLast,
  onCreate,
}: {
  exercises: Exercise[]
  equipment: string[]
  userId?: string
  loadLast?: (exercise: Exercise) => Promise<LastPerformance | null>
  onCreate: (input: RoundBlockInput) => void
}) {
  const [draft, setDraft] = useState<RoundDraft>(emptyDraft)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const problems = draft.items.length > 0 ? draftProblems(draft, byId) : []
  const input = draftToInput(draft, byId)
  return (
    <div className="flex flex-col gap-4 pb-4">
      <RoundBlockEditor
        idPrefix="new-rounds"
        draft={draft}
        onChange={setDraft}
        exercises={exercises}
        equipment={equipment}
        userId={userId}
        loadLast={loadLast}
      />
      {problems.length > 0 && (
        <ul className="text-destructive text-sm">
          {problems.map((p) => (
            <li key={`${p.key}-${p.message}`}>{p.message}</li>
          ))}
        </ul>
      )}
      <Button
        size="lg"
        className="h-14 text-lg"
        disabled={!input}
        onClick={() => input && onCreate(input)}
      >
        Crear bloque
      </Button>
    </div>
  )
}
