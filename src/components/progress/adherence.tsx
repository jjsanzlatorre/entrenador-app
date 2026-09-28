import { Link } from '@tanstack/react-router'
import { ChevronRight, Flame, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  adherenceLevel,
  formatPct,
  monthAdherence,
  monthValue,
  streaks,
  weekAdherence,
  weekMessage,
  type AdherenceLevel,
} from '@/lib/progress/adherence'
import { localDateKey, monthStartOf, weekStartOf } from '@/lib/progress/dates'
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
  if (commitments.length === 0) {
    return (
      <Link
        to="/perfil/compromiso"
        className="bg-card flex items-center gap-3 rounded-xl border p-4"
      >
        <Flame className="text-primary size-6 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">Define tu compromiso semanal</p>
          <p className="text-muted-foreground text-sm">
            Cuántas sesiones quieres hacer cada semana. Así verás tu barra aquí.
          </p>
        </div>
        <ChevronRight className="text-muted-foreground size-5" />
      </Link>
    )
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

function PersonRow({
  name,
  commitments,
  days,
}: {
  name: string
  commitments: Commitment[]
  days: ActivityDay[]
}) {
  const today = localDateKey(new Date())
  const week = weekAdherence(commitments, days, weekStartOf(today))
  const month = monthAdherence(commitments, days, monthStartOf(today))
  const { current } = streaks(commitments, days, today)
  return (
    <li className="flex flex-col gap-1.5">
      <p className="flex items-center justify-between font-semibold">
        <span className="truncate">{name}</span>
        {current > 0 && (
          <span className="text-muted-foreground text-xs font-normal">🔥 {current} sem.</span>
        )}
      </p>
      {commitments.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aún no ha definido su compromiso.</p>
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
    </li>
  )
}

function PartnerRow({ link }: { link: PartnerLink }) {
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
    <PersonRow name={link.displayName} commitments={data.data.commitments} days={data.data.days} />
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
          <PersonRow name={`${myName} (tú)`} commitments={mine.commitments} days={mine.days} />
          {sharing.map((l) => (
            <PartnerRow key={l.partnerId} link={l} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
