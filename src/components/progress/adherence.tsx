import { Link } from '@tanstack/react-router'
import { ChevronRight, Flame, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReactionBar, ReceivedReactions } from '@/components/partners/reactions'
import { Stat } from '@/components/progress/common'
import {
  adherenceLevel,
  averagePct,
  currentCommitment,
  formatPct,
  monthAdherence,
  monthValue,
  streaks,
  weekAdherence,
  weekHistory,
  weekMessage,
  type AdherenceLevel,
} from '@/lib/progress/adherence'
import {
  formatDayMonth,
  formatMonth,
  formatWeekRange,
  localDateKey,
  monthStartOf,
  weekStartOf,
  type DateKey,
} from '@/lib/progress/dates'
import { sessionTypeLabel } from '@/lib/workout/session-kinds'
import { useMyAdherenceData, usePartnerAdherence, usePartnerLinks } from '@/lib/progress/hooks'
import type { PartnerLink } from '@/lib/progress/api'
import type { ActivityDay, Commitment } from '@/lib/progress/types'
import { cn } from '@/lib/utils'

// < 50 % neutro, 50–99 % intermedio, ≥ 100 % logro (CLAUDE.md §10A).
const FILL: Record<AdherenceLevel, string> = {
  low: 'bg-slate-400 dark:bg-slate-500',
  mid: 'bg-sky-500',
  done: 'bg-emerald-600 dark:bg-emerald-500',
}

export function AdherenceBar({
  pct,
  label,
  value,
  extra = 0,
  size = 'md',
}: {
  pct: number | null
  label: string
  value: string
  extra?: number
  size?: 'sm' | 'md'
}) {
  const width = Math.min(1, pct ?? 0) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value}
          {extra > 0 && (
            <span className="ml-1.5 text-emerald-700 dark:text-emerald-400">+{extra} extra</span>
          )}
        </span>
      </div>
      <div
        className={cn('bg-muted mt-1 overflow-hidden rounded-full', size === 'md' ? 'h-3' : 'h-2')}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', FILL[adherenceLevel(pct)])}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export function weekValue(w: { counted: number; committed: number; pct: number | null }) {
  return `${w.counted}/${w.committed} · ${formatPct(w.pct)}`
}

// Barra de la semana en curso (siempre visible arriba en «Hoy»).
export function WeekAdherenceCard({ userId }: { userId: string }) {
  const today = localDateKey(new Date())
  const { days, commitments, isPending, error } = useMyAdherenceData(userId)
  if (isPending) {
    return <div className="bg-muted h-24 animate-pulse rounded-xl" aria-hidden />
  }
  if (error && commitments.length === 0) {
    return null
  }
  if (!currentCommitment(commitments, today)) {
    return <NoCommitmentCard hadOne={commitments.length > 0} />
  }
  const week = weekAdherence(commitments, days, weekStartOf(today))
  const { current } = streaks(commitments, days, today)
  return (
    <Link to="/progreso/cumplimiento" className="bg-card block rounded-xl border p-4">
      <AdherenceBar pct={week.pct} label="Esta semana" value={weekValue(week)} extra={week.extra} />
      {week.minutesTarget && week.minutesDone !== null && (
        <div className="mt-2">
          <AdherenceBar
            size="sm"
            pct={week.minutesDone / week.minutesTarget}
            label="Minutos"
            value={`${week.minutesDone}/${week.minutesTarget} min`}
          />
        </div>
      )}
      <p className="mt-2 text-sm font-medium">{weekMessage(week, today)}</p>
      {current > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          🔥 Racha: {current} {current === 1 ? 'semana completa' : 'semanas completas'}
        </p>
      )}
    </Link>
  )
}

// Aviso cuando no hay compromiso vigente (nunca definido o quitado): sin porcentajes.
export function NoCommitmentCard({ hadOne }: { hadOne: boolean }) {
  return (
    <Link to="/perfil/compromiso" className="bg-card flex items-center gap-3 rounded-xl border p-4">
      <Flame className="text-primary size-6 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">
          {hadOne ? 'Ahora mismo no tienes compromiso' : 'Define tu compromiso semanal'}
        </p>
        <p className="text-muted-foreground text-sm">
          {hadOne
            ? 'Crea uno nuevo cuando quieras para volver a ver tu barra aquí.'
            : 'Cuántas sesiones quieres hacer cada semana. Así verás tu barra aquí.'}
        </p>
      </div>
      <ChevronRight className="text-muted-foreground size-5" />
    </Link>
  )
}

function PersonRow({
  name,
  commitments,
  days,
  partnerId,
  userId,
}: {
  name: string
  commitments: Commitment[]
  days: ActivityDay[]
  // Mis datos: userId sin partnerId. De otra persona: los dos (enlace a su evolución y reacciones).
  userId: string
  partnerId?: string
}) {
  const today = localDateKey(new Date())
  const weekStart = weekStartOf(today)
  const week = weekAdherence(commitments, days, weekStart)
  const month = monthAdherence(commitments, days, monthStartOf(today))
  const { current } = streaks(commitments, days, today)
  return (
    <li className="flex flex-col gap-1.5">
      <p className="flex items-center justify-between gap-2 font-semibold">
        {partnerId ? (
          <Link
            to="/pareja/$partnerId"
            params={{ partnerId }}
            className="text-primary flex min-w-0 items-center gap-0.5 truncate"
          >
            <span className="truncate">{name}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        ) : (
          <span className="truncate">{name}</span>
        )}
        {current > 0 && (
          <span className="text-muted-foreground text-xs font-normal">🔥 {current} sem.</span>
        )}
      </p>
      {!currentCommitment(commitments, today) ? (
        <p className="text-muted-foreground text-sm">
          {commitments.length === 0
            ? 'Aún no ha definido su compromiso.'
            : 'Ahora mismo no tiene compromiso.'}
        </p>
      ) : (
        <>
          <AdherenceBar
            size="sm"
            pct={week.pct}
            label="Semana"
            value={weekValue(week)}
            extra={week.extra}
          />
          <AdherenceBar
            size="sm"
            pct={month.pct}
            label="Mes"
            value={monthValue(month)}
            extra={month.extra}
          />
        </>
      )}
      {partnerId ? (
        <ReactionBar
          userId={userId}
          to={partnerId}
          toName={name}
          kind="week"
          targetKey={weekStart}
          className="mt-0.5"
        />
      ) : (
        <ReceivedReactions userId={userId} kind="week" targetKey={weekStart} />
      )}
    </li>
  )
}

function PartnerRow({ link, userId }: { link: PartnerLink; userId: string }) {
  const data = usePartnerAdherence(link.partnerId)
  if (data.isPending) return <li className="bg-muted h-16 animate-pulse rounded-lg" aria-hidden />
  if (data.isError) {
    return (
      <li className="text-muted-foreground text-sm">
        {link.displayName}: no se ha podido cargar su cumplimiento.
      </li>
    )
  }
  return (
    <PersonRow
      name={link.displayName}
      commitments={data.data.commitments}
      days={data.data.days}
      userId={userId}
      partnerId={link.partnerId}
    />
  )
}

// Tarjeta «Nosotros»: tu cumplimiento junto al de las personas vinculadas que lo comparten.
export function UsCard({ userId, myName }: { userId: string; myName: string }) {
  const links = usePartnerLinks(userId)
  const mine = useMyAdherenceData(userId)
  const sharing = (links.data ?? []).filter((l) => l.status === 'accepted' && l.theyShare.adherence)
  if (sharing.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" /> Nosotros
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          <PersonRow
            name={`${myName} (tú)`}
            commitments={mine.commitments}
            days={mine.days}
            userId={userId}
          />
          {sharing.map((l) => (
            <PartnerRow key={l.partnerId} link={l} userId={userId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

const HISTORY_FILL = FILL

// Detalle del cumplimiento: semana en curso, mes, rachas y últimas 12 semanas. Se usa en
// «Cumplimiento» (self) y en la evolución de una persona vinculada (solo lectura).
export function AdherenceOverview({
  commitments,
  days,
  today,
  self = true,
}: {
  commitments: Commitment[]
  days: ActivityDay[]
  today: DateKey
  self?: boolean
}) {
  const week = weekAdherence(commitments, days, weekStartOf(today))
  const month = monthAdherence(commitments, days, monthStartOf(today))
  const history = weekHistory(commitments, days, today)
  const streak = streaks(commitments, days, today)
  const avg = averagePct(commitments, days, today)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            Semana en curso{' '}
            <span className="text-muted-foreground text-sm font-normal">
              {formatWeekRange(week.weekStart)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <AdherenceBar
            pct={week.pct}
            label="Sesiones"
            value={weekValue(week)}
            extra={week.extra}
          />
          {week.byType.map((t) => (
            <AdherenceBar
              key={t.sessionType}
              size="sm"
              pct={t.done / t.committed}
              label={sessionTypeLabel(t.sessionType)}
              value={`${t.done}/${t.committed}`}
            />
          ))}
          {week.minutesTarget && week.minutesDone !== null && (
            <AdherenceBar
              size="sm"
              pct={week.minutesDone / week.minutesTarget}
              label="Minutos"
              value={`${week.minutesDone}/${week.minutesTarget} min`}
            />
          )}
          {self && <p className="text-sm font-medium">{weekMessage(week, today)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="first-letter:uppercase">{formatMonth(month.monthStart)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <AdherenceBar
            pct={month.pct}
            label="Sesiones del mes"
            value={monthValue(month)}
            extra={month.extra}
          />
          <p className="text-muted-foreground text-xs">
            {month.partial
              ? `${self ? 'Tu' : 'Su'} compromiso empezó a final de mes: el porcentaje se verá el mes que viene.`
              : `Objetivo del mes: ${String(month.committed).replace('.', ',')} sesiones (las semanas partidas entre dos meses cuentan por días), redondeado a ${month.target}.`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Racha actual" value={`${streak.current} sem.`} />
        <Stat label="Mejor racha" value={`${streak.best} sem.`} />
        <Stat label="Media 3 meses" value={formatPct(avg)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimas 12 semanas</CardTitle>
        </CardHeader>
        <CardContent>
          <ol
            className="flex h-32 items-end gap-1"
            aria-label="Cumplimiento de las últimas 12 semanas"
          >
            {history.map((w) => {
              const pct = w.pct === null ? 0 : Math.min(1, w.pct)
              return (
                <li
                  key={w.weekStart}
                  className="flex h-full flex-1 flex-col items-center justify-end"
                  title={`Semana del ${formatDayMonth(w.weekStart)}: ${w.pct === null ? 'sin compromiso' : weekValue(w)}`}
                >
                  <span className="sr-only">
                    Semana del {formatDayMonth(w.weekStart)}:{' '}
                    {w.pct === null ? 'sin compromiso' : weekValue(w)}
                  </span>
                  <div
                    className={cn(
                      'w-full rounded-t-sm',
                      w.pct === null ? 'bg-muted' : HISTORY_FILL[adherenceLevel(w.pct)],
                    )}
                    style={{ height: `${Math.max(4, pct * 100)}%` }}
                    aria-hidden
                  />
                </li>
              )
            })}
          </ol>
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>{formatDayMonth(history[0]!.weekStart)}</span>
            <span>esta semana</span>
          </div>
          <ul className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
            <Legend className={HISTORY_FILL.low} label="< 50 %" />
            <Legend className={HISTORY_FILL.mid} label="50–99 %" />
            <Legend className={HISTORY_FILL.done} label="≥ 100 %" />
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1">
      <span className={cn('inline-block size-3 rounded-sm', className)} aria-hidden />
      {label}
    </li>
  )
}
