import { useState } from 'react'
import { ArrowLeftRight, CalendarDays } from 'lucide-react'
import { Chip } from '@/components/plan/chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import type { PlannedSession } from '@/lib/plan/api'
import { moveWarnings } from '@/lib/plan/move-rules'
import { WEEKDAY_LONG, WEEKDAY_SHORT, type FixedActivity } from '@/lib/plan/profile'
import {
  isPendingPlanned,
  moveSession,
  moveStrip,
  moveStripStart,
  swapSessions,
} from '@/lib/plan/reschedule'
import { usePlanChange } from '@/lib/plan/use-plan-change'
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  isoWeekday,
  weekStartOf,
  type DateKey,
} from '@/lib/progress/dates'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import { cn } from '@/lib/utils'

const dayName = (d: DateKey) => `${WEEKDAY_LONG[isoWeekday(d) - 1]} ${formatDayMonth(d)}`

// «Mover»: tira de 14 días (la semana de la sesión y la siguiente). Un toque la mueve; los días
// con aviso (⚠) se pueden elegir igual. «Intercambiar» la cambia por otra sesión pendiente.
export function MoveSheet({
  session,
  planId,
  sessions,
  fixed,
  today,
  userId,
  onClose,
}: {
  session: PlannedSession | null
  planId: string
  sessions: PlannedSession[]
  fixed: Pick<FixedActivity, 'type' | 'days'>[]
  today: DateKey
  userId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<'move' | 'swap'>('move')
  const [custom, setCustom] = useState('')
  const changer = usePlanChange(userId)

  const close = () => {
    setTab('move')
    setCustom('')
    onClose()
  }

  if (!session) return null

  const start = moveStripStart(session.date, today)
  const strip = moveStrip(start)
  const warningsFor = (date: DateKey) => moveWarnings(session, date, sessions, fixed)
  const onDay = (date: DateKey) =>
    sessions.filter((s) => s.id !== session.id && s.date === date && s.status !== 'skipped')

  async function moveTo(date: DateKey) {
    if (!session || date === session.date || changer.busy) return
    const ok = await changer.apply(
      planId,
      moveSession(session, date),
      `«${session.title}» movida al ${dayName(date)}`,
      warningsFor(date),
    )
    if (ok) close()
  }

  async function swapWith(other: PlannedSession) {
    if (!session || changer.busy) return
    const rest = sessions.filter((s) => s.id !== session.id && s.id !== other.id)
    const warnings = [
      ...moveWarnings(session, other.date, rest, fixed),
      ...moveWarnings(other, session.date, rest, fixed),
    ]
    const ok = await changer.apply(
      planId,
      swapSessions(session, other),
      `Intercambiadas: «${session.title}» al ${dayName(other.date)} y «${other.title}» al ${dayName(session.date)}`,
      warnings,
    )
    if (ok) close()
  }

  const swapCandidates = sessions
    .filter(
      (s) =>
        s.id !== session.id &&
        isPendingPlanned(s) &&
        s.date !== session.date &&
        s.date >= start &&
        s.date <= addDays(start, 13),
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  const stripWarnings = strip
    .filter((d) => d.date !== session.date && d.date >= today)
    .flatMap((d) => warningsFor(d.date).map((w) => ({ date: d.date, text: w })))
  const customWarnings = custom && custom !== session.date ? warningsFor(custom) : []

  return (
    <Sheet
      open
      onClose={close}
      title={`${sessionTypeEmoji(session.sessionType)} Mover «${session.title}»`}
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Mover o intercambiar">
          <Chip selected={tab === 'move'} onClick={() => setTab('move')}>
            <CalendarDays className="mr-1 inline size-4" /> Otro día
          </Chip>
          <Chip selected={tab === 'swap'} onClick={() => setTab('swap')}>
            <ArrowLeftRight className="mr-1 inline size-4" /> Intercambiar
          </Chip>
        </div>

        {tab === 'move' && (
          <>
            <p className="text-muted-foreground text-sm">
              Ahora: <span className="text-foreground font-medium">{dayName(session.date)}</span>.
              Toca el día al que la quieres mover.
            </p>
            {[0, 7].map((offset) => {
              const weekStart = addDays(start, offset)
              return (
                <div key={offset} className="flex flex-col gap-1.5">
                  <p className="text-muted-foreground text-xs font-semibold uppercase">
                    {weekStart === weekStartOf(today)
                      ? 'Esta semana'
                      : weekStart === addDays(weekStartOf(today), 7)
                        ? 'Semana siguiente'
                        : formatWeekRange(weekStart)}
                  </p>
                  <div className="grid grid-cols-7 gap-1">
                    {strip.slice(offset, offset + 7).map((d) => {
                      const current = d.date === session.date
                      const past = d.date < today
                      const warned = !current && !past && warningsFor(d.date).length > 0
                      const busyDay = onDay(d.date)
                      return (
                        <button
                          key={d.date}
                          type="button"
                          data-move-date={d.date}
                          disabled={past || current || changer.busy}
                          aria-pressed={current}
                          aria-label={`Mover al ${dayName(d.date)}${warned ? ' (con aviso)' : ''}${busyDay.length ? `, ya tienes ${busyDay.map((s) => s.title).join(', ')}` : ''}`}
                          onClick={() => void moveTo(d.date)}
                          className={cn(
                            'flex min-h-16 flex-col items-center justify-start rounded-xl border px-0 py-1.5 text-sm leading-tight font-semibold transition-colors',
                            current
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-card hover:bg-accent active:scale-95',
                            past && 'opacity-35',
                            d.date === today && !current && 'border-primary',
                            warned && 'border-amber-500',
                          )}
                        >
                          <span>{WEEKDAY_SHORT[d.weekday - 1]}</span>
                          <span className="text-xs font-normal">{Number(d.date.slice(8))}</span>
                          <span className="text-xs" aria-hidden>
                            {busyDay
                              .slice(0, 2)
                              .map((s) => sessionTypeEmoji(s.sessionType))
                              .join('')}
                            {warned ? '⚠' : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {stripWarnings.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
                {stripWarnings.map((w) => (
                  <li key={`${w.date}:${w.text}`}>
                    ⚠ <span className="font-semibold">{dayName(w.date)}</span>: {w.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground text-xs">
              ⚠ = pierna pesada antes de frontón, pádel, tenis o surf, dos intensas seguidas u otra
              sesión ese día. Puedes moverla igual.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="Otro día"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={changer.busy || !custom || custom === session.date}
                onClick={() => void moveTo(custom)}
              >
                Mover
              </Button>
            </div>
            {customWarnings.map((w) => (
              <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
                ⚠ {w}
              </p>
            ))}
          </>
        )}

        {tab === 'swap' && (
          <>
            <p className="text-muted-foreground text-sm">
              Elige la sesión con la que cambiarla de día (pendientes de estas dos semanas).
            </p>
            {swapCandidates.length === 0 && (
              <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-sm">
                No hay otras sesiones pendientes en estas dos semanas.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {swapCandidates.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={changer.busy}
                    onClick={() => void swapWith(s)}
                    className="bg-card hover:bg-accent flex w-full items-center gap-3 rounded-xl border p-3 text-left active:scale-[0.99]"
                  >
                    <span aria-hidden className="text-xl">
                      {sessionTypeEmoji(s.sessionType)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="text-muted-foreground block text-xs first-letter:uppercase">
                        {dayName(s.date)} ⇄ {dayName(session.date)}
                      </span>
                    </span>
                    <ArrowLeftRight className="text-muted-foreground size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  )
}
