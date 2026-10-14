import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  CalendarClock,
  ChevronLeft,
  Copy,
  Flag,
  PauseCircle,
  RotateCcw,
  Shuffle,
} from 'lucide-react'
import { Chip } from '@/components/plan/chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Sheet } from '@/components/ui/sheet'
import { parseCount } from '@/lib/input/quantity'
import { notifyError, notifySaved } from '@/lib/notify'
import { archivePlan, type ActivePlan } from '@/lib/plan/api'
import { refreshPlan } from '@/lib/plan/hooks'
import { WEEKDAY_SHORT } from '@/lib/plan/profile'
import {
  pausePlan,
  planEnd,
  planEndAfter,
  repeatWeek,
  shiftPlan,
  type PlanChange,
} from '@/lib/plan/reschedule'
import { usePlanChange } from '@/lib/plan/use-plan-change'
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  isoWeekday,
  type DateKey,
} from '@/lib/progress/dates'
import type { PlanChangeKind } from '@/types/database'

const KIND_LABELS: Record<PlanChangeKind, string> = {
  move: 'Mover sesión',
  swap: 'Intercambiar sesiones',
  shift: 'Desplazar plan',
  pause: 'Pausar plan',
  repeat: 'Repetir semana',
}

const shortDay = (d: DateKey) => `${WEEKDAY_SHORT[isoWeekday(d) - 1]} ${formatDayMonth(d)}`

type View = 'menu' | 'shift' | 'pause' | 'repeat'

// Plan → ⋯: desplazar, pausar o repetir semana (con vista previa y «Deshacer»), deshacer el último
// cambio, cambiar o terminar el plan.
export function PlanMenu({
  open,
  plan,
  userId,
  weekStart,
  today,
  onClose,
}: {
  open: boolean
  plan: ActivePlan
  userId: string
  // Semana que se está viendo en el calendario (la que se repite).
  weekStart: DateKey
  today: DateKey
  onClose: () => void
}) {
  const [view, setView] = useState<View>('menu')
  const changer = usePlanChange(userId)
  const queryClient = useQueryClient()

  const close = () => {
    setView('menu')
    onClose()
  }

  async function apply(change: PlanChange, success: string) {
    const ok = await changer.apply(plan.id, change, success)
    if (ok) close()
  }

  async function terminate() {
    if (!confirm(`¿Terminar el plan «${plan.name}»? Lo hecho se conserva en el historial.`)) return
    try {
      await archivePlan(plan.id)
      await refreshPlan(queryClient, userId)
      notifySaved('Plan terminado')
      close()
    } catch (error) {
      notifyError(error, 'terminar el plan')
    }
  }

  const title =
    view === 'menu'
      ? 'Opciones del plan'
      : view === 'shift'
        ? 'Desplazar plan'
        : view === 'pause'
          ? 'Pausar plan'
          : 'Repetir esta semana'

  return (
    <Sheet open={open} onClose={close} title={title}>
      {view !== 'menu' && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 self-start"
          onClick={() => setView('menu')}
        >
          <ChevronLeft /> Opciones
        </Button>
      )}
      {view === 'menu' && (
        <div className="flex flex-col gap-2 pb-2">
          <MenuItem
            icon={<ArrowRightLeft />}
            title="Desplazar plan"
            text="Todas las sesiones pendientes, unos días o semanas antes o después."
            onClick={() => setView('shift')}
          />
          <MenuItem
            icon={<PauseCircle />}
            title="Pausar plan"
            text="Vacaciones o lesión: lo pendiente se reprograma después de la pausa."
            onClick={() => setView('pause')}
          />
          <MenuItem
            icon={<Copy />}
            title="Repetir esta semana"
            text={`Vuelve a hacer la semana del ${formatWeekRange(weekStart)} y desplaza el resto.`}
            onClick={() => setView('repeat')}
          />
          {plan.lastChange && (
            <MenuItem
              icon={<RotateCcw />}
              title="Deshacer el último cambio"
              text={`${KIND_LABELS[plan.lastChange.kind]} (${new Date(
                plan.lastChange.createdAt,
              ).toLocaleString('es-ES', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })})`}
              disabled={changer.busy}
              onClick={() => {
                if (plan.lastChange) void changer.undo(plan.lastChange.id).then(close)
              }}
            />
          )}
          <MenuItem
            icon={<Shuffle />}
            title="Cambiar plan"
            text="Elegir otra plantilla (el actual se archiva)."
            asLink
          />
          <MenuItem
            icon={<Flag />}
            title="Terminar plan"
            text="Lo hecho se conserva en el historial."
            onClick={() => void terminate()}
          />
        </div>
      )}
      {view === 'shift' && (
        <ShiftForm
          plan={plan}
          today={today}
          busy={changer.busy}
          onApply={(c) => {
            const days = Number(c.params.days)
            void apply(
              c,
              `Plan desplazado ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'después' : 'antes'}`,
            )
          }}
        />
      )}
      {view === 'pause' && (
        <PauseForm
          plan={plan}
          today={today}
          busy={changer.busy}
          onApply={(c) =>
            void apply(c, `Plan en pausa hasta el ${formatDayMonth(String(c.params.until))}`)
          }
        />
      )}
      {view === 'repeat' && (
        <Preview
          plan={plan}
          change={repeatWeek(plan, weekStart, today)}
          busy={changer.busy}
          onApply={(c) =>
            void apply(
              c,
              `Semana repetida: ${sessions(c.copies.length)} ${c.copies.length === 1 ? 'añadida' : 'añadidas'}`,
            )
          }
        />
      )}
    </Sheet>
  )
}

function MenuItem({
  icon,
  title,
  text,
  onClick,
  disabled,
  asLink,
}: {
  icon: React.ReactNode
  title: string
  text: string
  onClick?: () => void
  disabled?: boolean
  asLink?: boolean
}) {
  const content = (
    <>
      <span className="text-primary mt-0.5 [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="text-muted-foreground block text-sm">{text}</span>
      </span>
    </>
  )
  const className =
    'bg-card hover:bg-accent flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-50'
  if (asLink)
    return (
      <Link to="/plan/elegir" className={className}>
        {content}
      </Link>
    )
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  )
}

function ShiftForm({
  plan,
  today,
  busy,
  onApply,
}: {
  plan: ActivePlan
  today: DateKey
  busy: boolean
  onApply: (c: PlanChange) => void
}) {
  const [from, setFrom] = useState(today)
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<'days' | 'weeks'>('weeks')
  const [direction, setDirection] = useState<1 | -1>(1)
  const n = parseCount(amount)
  const days = n === null ? 0 : n * (unit === 'weeks' ? 7 : 1) * direction
  const change = shiftPlan(plan, from || today, days, today)

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="shift-from">Desde</Label>
        <Input id="shift-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <p className="text-muted-foreground text-xs">
          Se mueven las sesiones pendientes de ese día en adelante.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Dirección">
        <Chip selected={direction === 1} onClick={() => setDirection(1)}>
          Después ⏩
        </Chip>
        <Chip selected={direction === -1} onClick={() => setDirection(-1)}>
          ⏪ Antes
        </Chip>
      </div>
      <QuantityInput
        id="shift-amount"
        label="Cuánto"
        value={amount}
        onChange={setAmount}
        quantity={{ kind: 'count', unit: unit === 'weeks' ? 'semanas' : 'días' }}
        steps={[1]}
      />
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Unidad">
        <Chip selected={unit === 'days'} onClick={() => setUnit('days')}>
          Días
        </Chip>
        <Chip selected={unit === 'weeks'} onClick={() => setUnit('weeks')}>
          Semanas
        </Chip>
      </div>
      <Preview plan={plan} change={change} busy={busy} onApply={onApply} />
    </div>
  )
}

function PauseForm({
  plan,
  today,
  busy,
  onApply,
}: {
  plan: ActivePlan
  today: DateKey
  busy: boolean
  onApply: (c: PlanChange) => void
}) {
  const [from, setFrom] = useState(today)
  const [until, setUntil] = useState(addDays(today, 6))
  const change = pausePlan(plan, from || today, until || today, today)
  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pause-from">Desde</Label>
          <Input
            id="pause-from"
            type="date"
            min={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pause-until">Hasta (incluido)</Label>
          <Input
            id="pause-until"
            type="date"
            min={from}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Duración rápida">
        {[
          [6, '1 semana'],
          [13, '2 semanas'],
          [20, '3 semanas'],
        ].map(([d, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={until === addDays(from || today, Number(d))}
            onClick={() => setUntil(addDays(from || today, Number(d)))}
            className="bg-background aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary h-9 rounded-full border px-3 text-sm"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        Lo pendiente se mueve semanas enteras: mantiene el orden y los días de la semana.
      </p>
      <Preview plan={plan} change={change} busy={busy} onApply={onApply} />
    </div>
  )
}

const PREVIEW_LIMIT = 8
const sessions = (n: number) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`

function Preview({
  plan,
  change,
  busy,
  onApply,
}: {
  plan: ActivePlan
  change: PlanChange
  busy: boolean
  onApply: (c: PlanChange) => void
}) {
  const endBefore = planEnd(plan.sessions)
  const endAfter = planEndAfter(plan, change)
  const items = [
    ...change.copies.map((c) => ({
      key: `c:${c.sourceId}`,
      text: `➕ ${c.title}`,
      detail: `${shortDay(c.date)} (repetida)`,
    })),
    ...change.moves.map((m) => ({
      key: `m:${m.id}`,
      text: m.title,
      detail: `${shortDay(m.from)} → ${shortDay(m.to)}`,
    })),
  ]
  return (
    <section aria-label="Vista previa" className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarClock className="size-4" /> Vista previa
      </p>
      {change.error ? (
        <p className="text-destructive text-sm" role="alert">
          {change.error}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {[
              change.moves.length > 0 &&
                `${sessions(change.moves.length)} ${change.moves.length === 1 ? 'cambia' : 'cambian'} de día`,
              change.copies.length > 0 &&
                `${sessions(change.copies.length)} ${change.copies.length === 1 ? 'nueva' : 'nuevas'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {change.kind === 'pause' && change.params.days
              ? ` (${Number(change.params.days) / 7} semana${Number(change.params.days) === 7 ? '' : 's'} después)`
              : ''}
          </p>
          <ul className="flex flex-col text-sm">
            {items.slice(0, PREVIEW_LIMIT).map((i) => (
              <li key={i.key} className="flex justify-between gap-2 border-b py-1 last:border-0">
                <span className="min-w-0 truncate">{i.text}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{i.detail}</span>
              </li>
            ))}
          </ul>
          {items.length > PREVIEW_LIMIT && (
            <p className="text-muted-foreground text-xs">y {items.length - PREVIEW_LIMIT} más…</p>
          )}
          {endBefore && endAfter && endBefore !== endAfter && (
            <p className="text-muted-foreground text-xs">
              El plan terminará el {shortDay(endAfter)} (antes, el {shortDay(endBefore)}).
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Lo hecho y lo saltado no se mueve. Podrás deshacerlo.
          </p>
        </>
      )}
      <Button size="lg" disabled={busy || change.error !== null} onClick={() => onApply(change)}>
        Aplicar
      </Button>
    </section>
  )
}
