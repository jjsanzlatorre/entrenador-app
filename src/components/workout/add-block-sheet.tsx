import { useState } from 'react'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { parseInteger } from '@/lib/workout/format'
import type { CircuitConfig, Exercise } from '@/lib/workout/types'
import type { TimerConfig } from '@/lib/workout/timer'
import { cn } from '@/lib/utils'
import { ExercisePicker } from './exercise-picker'

export type NewBlockKind =
  'straight' | 'circuit' | 'emom' | 'amrap' | 'tabata' | 'for_time' | 'intervals' | 'free'

export type NewBlock =
  | { kind: 'straight' }
  | { kind: 'circuit'; config: CircuitConfig; exercises: Exercise[] }
  | {
      kind: 'timed'
      config: TimerConfig
      exercises: { exercise: Exercise; targetReps: number | null }[]
    }

const OPTIONS: { kind: NewBlockKind; label: string; hint: string }[] = [
  { kind: 'straight', label: 'Ejercicio', hint: 'Series con descanso' },
  { kind: 'circuit', label: 'Circuito', hint: 'Rondas de varios ejercicios' },
  { kind: 'emom', label: 'EMOM', hint: 'Cada minuto, en el minuto' },
  { kind: 'amrap', label: 'AMRAP', hint: 'Máximas rondas en X min' },
  { kind: 'tabata', label: 'Tabata / HIIT', hint: 'Trabajo/descanso × rondas' },
  { kind: 'for_time', label: 'For Time', hint: 'Lo antes posible, con cap' },
  { kind: 'intervals', label: 'Intervalos', hint: 'Carrera, natación o bici' },
  { kind: 'free', label: 'Cronómetro', hint: 'Continuo o libre' },
]

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
  onClose,
  onCreate,
}: {
  open: boolean
  exercises: Exercise[]
  equipment: string[]
  defaultCardioId: string | null
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
                if (o.kind === 'straight') {
                  onCreate({ kind: 'straight' })
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
      {kind && kind !== 'straight' && (
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
  suffix,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 text-lg"
        />
        {suffix && <span className="text-muted-foreground text-sm">{suffix}</span>}
      </div>
    </div>
  )
}

type Picked = { exercise: Exercise; targetReps: string }

function BlockForm({
  kind,
  exercises,
  equipment,
  defaultCardioId,
  onCreate,
}: {
  kind: Exclude<NewBlockKind, 'straight'>
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
    rounds: kind === 'circuit' ? '3' : '8',
    capMin: '',
    reps: '6',
    mode: 'distance' as 'distance' | 'time',
    distanceM: '400',
    intervalWorkS: '180',
    recoveryS: '90',
    circuitRestS: '90',
  })
  const set = (key: keyof typeof p) => (v: string) => setP((prev) => ({ ...prev, [key]: v }))
  const n = (v: string, fallback: number) => parseInteger(v) ?? fallback

  const single = kind === 'intervals' || kind === 'free'
  const needsExercise = kind !== 'free'
  const showReps = kind === 'emom' || kind === 'amrap' || kind === 'for_time'

  function create() {
    const inputs = picked.map((x) => ({
      exercise: x.exercise,
      targetReps: parseInteger(x.targetReps),
    }))
    let config: TimerConfig
    switch (kind) {
      case 'circuit':
        onCreate({
          kind: 'circuit',
          config: {
            kind: 'circuit',
            rounds: n(p.rounds, 3),
            restBetweenRoundsS: n(p.circuitRestS, 90),
          },
          exercises: picked.map((x) => x.exercise),
        })
        return
      case 'emom':
        config = { kind: 'emom', minutes: n(p.minutes, 12), intervalS: n(p.intervalS, 60) }
        break
      case 'amrap':
        config = { kind: 'amrap', durationS: n(p.amrapMin, 10) * 60 }
        break
      case 'tabata':
        config = {
          kind: 'tabata',
          workS: n(p.workS, 20),
          restS: n(p.restS, 10),
          rounds: n(p.rounds, 8),
        }
        break
      case 'for_time': {
        const cap = parseInteger(p.capMin)
        config = { kind: 'for_time', capS: cap ? cap * 60 : null }
        break
      }
      case 'intervals':
        config = {
          kind: 'intervals',
          reps: n(p.reps, 6),
          workDistanceM: p.mode === 'distance' ? n(p.distanceM, 400) : null,
          workS: p.mode === 'time' ? n(p.intervalWorkS, 180) : null,
          recoveryS: n(p.recoveryS, 90),
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
              suffix="s"
            />
          </>
        )}
        {kind === 'amrap' && (
          <NumberField
            id="amrap-min"
            label="Duración"
            value={p.amrapMin}
            onChange={set('amrapMin')}
            suffix="min"
          />
        )}
        {kind === 'tabata' && (
          <>
            <NumberField
              id="tb-work"
              label="Trabajo"
              value={p.workS}
              onChange={set('workS')}
              suffix="s"
            />
            <NumberField
              id="tb-rest"
              label="Descanso"
              value={p.restS}
              onChange={set('restS')}
              suffix="s"
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
            suffix="min"
          />
        )}
        {kind === 'circuit' && (
          <>
            <NumberField id="c-rounds" label="Rondas" value={p.rounds} onChange={set('rounds')} />
            <NumberField
              id="c-rest"
              label="Descanso entre rondas"
              value={p.circuitRestS}
              onChange={set('circuitRestS')}
              suffix="s"
            />
          </>
        )}
        {kind === 'intervals' && (
          <>
            <NumberField id="iv-reps" label="Series" value={p.reps} onChange={set('reps')} />
            <NumberField
              id="iv-rec"
              label="Recuperación"
              value={p.recoveryS}
              onChange={set('recoveryS')}
              suffix="s"
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
                suffix="m"
              />
            ) : (
              <NumberField
                id="iv-time"
                label="Tiempo por serie"
                value={p.intervalWorkS}
                onChange={set('intervalWorkS')}
                suffix="s"
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
