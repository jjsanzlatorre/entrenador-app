import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareCardButton } from '@/components/share/share-card-button'
import { accumulate, periodFor } from '@/lib/progress/accumulated'
import { monthAdherence, monthValue } from '@/lib/progress/adherence'
import { addMonths, formatMonth, localDateKey, monthStartOf } from '@/lib/progress/dates'
import {
  bestEquivalence,
  crossedMilestones,
  formatMetricValue,
  monthSummaryKey,
  pickMilestone,
  type EquivalenceContext,
  type Home,
} from '@/lib/progress/equivalences'
import {
  milestonesKey,
  useCommitments,
  useEquivalenceCatalog,
  useSessionLog,
  useShownMilestones,
} from '@/lib/progress/hooks'
import { markMilestonesShown } from '@/lib/progress/milestones-store'
import { activityDaysFromSessions } from '@/lib/progress/adherence'
import type { Profile } from '@/types/database'

export function homeOf(profile: Pick<Profile, 'home_city' | 'home_lat' | 'home_lng'>): Home | null {
  if (!profile.home_city || profile.home_lat === null || profile.home_lng === null) return null
  return { city: profile.home_city, lat: profile.home_lat, lng: profile.home_lng }
}

// Catálogo + ciudad de referencia del perfil.
export function useEquivalenceContext(profile: Profile) {
  const catalog = useEquivalenceCatalog()
  const home = homeOf(profile)
  const ctx = useMemo<EquivalenceContext | null>(
    () => (catalog.data ? { ...catalog.data, home } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- home se compara por valor
    [catalog.data, home?.city, home?.lat, home?.lng],
  )
  return { ctx, isPending: catalog.isPending, error: catalog.error }
}

// Tarjeta a media pantalla: emoji grande, frase y dato real. Se cierra con un toque.
export function MilestoneCard({
  emoji,
  title,
  phrase,
  value,
  children,
  onClose,
}: {
  emoji: string
  title?: string
  phrase: string
  value?: string
  children?: ReactNode
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="p-safe-4 fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Nuevo logro'}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="animate-in fade-in absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="bg-background animate-in zoom-in-90 fade-in relative flex max-h-full w-full max-w-sm flex-col items-center gap-3 overflow-y-auto overscroll-contain rounded-3xl p-6 text-center shadow-2xl duration-300">
        {title && (
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {title}
          </p>
        )}
        <span className="animate-in zoom-in-50 text-7xl leading-none duration-500" aria-hidden>
          {emoji}
        </span>
        <p className="text-lg leading-snug font-bold">{phrase}</p>
        {value && <p className="text-primary text-3xl font-extrabold tabular-nums">{value}</p>}
        {children}
        <div className="mt-2 flex w-full flex-col gap-2">
          {value && (
            <ShareCardButton
              size="lg"
              variant="outline"
              label="Compartir"
              card={{
                kind: 'achievement',
                emoji,
                eyebrow: title ?? 'Nuevo logro',
                headline: phrase,
                value,
              }}
            />
          )}
          <Button asChild size="lg">
            <Link to="/progreso/logros" onClick={onClose}>
              Ver mis logros
            </Link>
          </Button>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Pop-up de fin de sesión: como máximo 1, el hito más llamativo que esta sesión hace cruzar.
// La decisión se toma una vez (query sin caducidad) y todas las claves nuevas se marcan como
// vistas, así no se repite ni al recargar el resumen.
export function SessionMilestonePopup({
  profile,
  sessionId,
  startedAt,
}: {
  profile: Profile
  sessionId: string
  startedAt: string
}) {
  const queryClient = useQueryClient()
  const userId = profile.id
  const enabled = profile.show_equivalence_popups
  const log = useSessionLog(userId)
  const shown = useShownMilestones(userId)
  const { ctx } = useEquivalenceContext(profile)
  const [closed, setClosed] = useState(false)
  const ready =
    enabled && Boolean(ctx && shown.data && log.data?.sessions.some((s) => s.id === sessionId))

  const decision = useQuery({
    queryKey: ['milestone-popup', sessionId],
    enabled: ready,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!shown.data!.reliable) return null
      const candidates = crossedMilestones(
        log.data!.sessions,
        sessionId,
        localDateKey(startedAt),
        ctx!,
      )
      const { best, keys } = pickMilestone(candidates, new Set(shown.data!.items.map((i) => i.key)))
      if (keys.length > 0) {
        await markMilestonesShown(userId, keys)
        void queryClient.invalidateQueries({ queryKey: milestonesKey(userId) })
      }
      return best
    },
  })

  const best = decision.data
  if (!best || closed) return null
  return (
    <MilestoneCard
      title="¡Nuevo logro!"
      emoji={best.step.emoji}
      phrase={best.phrase}
      value={best.valueLabel}
      onClose={() => setClosed(true)}
    />
  )
}

// Resumen del mes anterior al abrir la app por primera vez en un mes nuevo.
export function MonthSummaryPopup({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const userId = profile.id
  const log = useSessionLog(userId)
  const commitments = useCommitments(userId)
  const shown = useShownMilestones(userId)
  const { ctx } = useEquivalenceContext(profile)
  const [closed, setClosed] = useState(false)
  const lastMonth = addMonths(monthStartOf(localDateKey(new Date())), -1)
  const key = monthSummaryKey(lastMonth)
  const ready =
    profile.show_equivalence_popups &&
    Boolean(ctx && log.data && !log.data.offline && shown.data?.reliable && commitments.isFetched)

  const summary = useQuery({
    queryKey: ['month-summary', userId, key],
    enabled: ready,
    networkMode: 'always',
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (shown.data!.items.some((i) => i.key === key)) return null
      const sessions = log.data!.sessions
      const acc = accumulate(sessions, periodFor('month', lastMonth))
      if (acc.sessions === 0) return null
      await markMilestonesShown(userId, [key])
      void queryClient.invalidateQueries({ queryKey: milestonesKey(userId) })
      const adherence = monthAdherence(
        commitments.data ?? [],
        activityDaysFromSessions(sessions),
        lastMonth,
      )
      return { acc, adherence, equivalence: bestEquivalence(acc, ctx!) }
    },
  })

  const data = summary.data
  if (!data || closed) return null
  const eq = data.equivalence
  return (
    <MilestoneCard
      title={`Tu resumen de ${formatMonth(lastMonth).replace(/ de \d{4}$/, '')}`}
      emoji={eq?.position.passed?.emoji ?? '📅'}
      phrase={
        eq?.phrase
          ? `En ${formatMonth(lastMonth).replace(/ de \d{4}$/, '')} ${eq.phrase.charAt(0).toLowerCase()}${eq.phrase.slice(1)}`
          : `${data.acc.sessions} ${data.acc.sessions === 1 ? 'sesión' : 'sesiones'} el mes pasado`
      }
      value={eq ? formatMetricValue(eq.metric, eq.value) : undefined}
      onClose={() => setClosed(true)}
    >
      <dl className="text-muted-foreground grid w-full grid-cols-2 gap-2 text-sm">
        <div className="bg-muted rounded-xl p-2">
          <dt className="text-xs">Sesiones</dt>
          <dd className="text-foreground text-lg font-bold">{data.acc.sessions}</dd>
        </div>
        <div className="bg-muted rounded-xl p-2">
          <dt className="text-xs">Cumplimiento</dt>
          <dd className="text-foreground text-sm font-bold">
            {data.adherence.target === 0 && !data.adherence.partial
              ? 'Sin compromiso'
              : monthValue(data.adherence)}
          </dd>
        </div>
      </dl>
    </MilestoneCard>
  )
}

// Aviso para elegir la ciudad de referencia (se pide la primera vez que hace falta).
export function HomeCityPrompt({ from }: { from: 'logros' | 'sesion' }) {
  return (
    <Link
      to="/perfil/ciudad"
      search={{ volver: from === 'logros' ? 'logros' : undefined }}
      className="bg-card flex items-center gap-3 rounded-xl border border-dashed p-4"
    >
      <MapPin className="text-primary size-6 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">Elige tu ciudad de referencia</p>
        <p className="text-muted-foreground text-sm">
          Para ver hasta dónde habrías llegado con tus kilómetros (en línea recta).
        </p>
      </div>
    </Link>
  )
}
