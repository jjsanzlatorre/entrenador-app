import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aiStatusKey, useAiRequests, useAiStatus, weeklyReviewKey } from '@/lib/ai/client'
import type { ReviewFacts } from '@/lib/ai/review'
import type { AiResult } from '@/lib/ai/schemas'
import type { WeeklyReviewResult } from '@/server/ai/coach'
import { formatWeekRange } from '@/lib/progress/dates'
import { PR_LABELS } from '@/lib/progress/records'
import { muscleName } from '@/lib/workout/labels'
import { sessionTypeLabel } from '@/lib/workout/session-kinds'
import type { SessionType, Sex } from '@/types/database'
import { ChangeCard } from './change-card'

type ReviewQuery = {
  data: AiResult<WeeklyReviewResult> | undefined
  isPending: boolean
}

// Tarjeta en «Hoy»: titular de la revisión de la semana pasada y enlace a verla entera.
export function WeeklyReviewCard({ review }: { review: ReviewQuery }) {
  const res = review.data
  if (review.isPending || !res) return null
  if (!res.ok) {
    // Sin revisión (aún no generada, sin datos o sin IA): no se muestra nada en «Hoy».
    if (['not_generated', 'no_data', 'not_configured', 'rules_available'].includes(res.code)) {
      return null
    }
    return (
      <Link
        to="/plan/revision"
        className="bg-muted flex items-center gap-3 rounded-2xl p-3 text-sm"
      >
        <Sparkles className="text-primary size-5 shrink-0" />
        <span className="flex-1">Revisión semanal: {res.message}</span>
        <ChevronRight className="size-5" />
      </Link>
    )
  }
  const pending = res.review.changes.filter((_, i) => !res.responses[String(i)]).length
  return (
    <Link
      to="/plan/revision"
      className="border-primary/40 bg-primary/5 flex items-center gap-3 rounded-2xl border p-3"
    >
      <Sparkles className="text-primary size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-primary text-xs font-medium uppercase">
          Revisión semanal · {formatWeekRange(res.review.weekStart)}
        </p>
        <p className="font-semibold">{res.review.review.headline}</p>
        {pending > 0 && (
          <p className="text-muted-foreground text-xs">
            {pending === 1 ? '1 cambio propuesto' : `${pending} cambios propuestos`} para esta
            semana
          </p>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0" />
    </Link>
  )
}

const ACWR_TEXT = {
  insufficient: 'datos insuficientes',
  ok: 'en rango',
  high: 'alto: riesgo de sobrecarga',
  low: 'bajo',
} as const

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-muted/60 rounded-xl p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

// Datos de la semana revisada: salen del cálculo de la app, no de la IA.
export function ReviewFactsView({ facts }: { facts: ReviewFacts }) {
  const byType = Object.entries(facts.byType)
    .map(([type, n]) => `${n} ${sessionTypeLabel(type as SessionType).toLowerCase()}`)
    .join(' · ')
  const loadDiff =
    facts.previousLoad > 0
      ? Math.round(((facts.load - facts.previousLoad) / facts.previousLoad) * 100)
      : null
  return (
    <section aria-label="Datos de la semana" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Fact
          label="Sesiones"
          value={String(facts.sessions)}
          hint={byType || `${facts.minutes} min`}
        />
        <Fact
          label="Compromiso"
          value={facts.commitment ? `${facts.commitment.pct} %` : '—'}
          hint={
            facts.commitment
              ? `${facts.commitment.counted} de ${facts.commitment.committed}` +
                (facts.commitment.extra > 0 ? ` (+${facts.commitment.extra} extra)` : '')
              : 'sin compromiso'
          }
        />
        {facts.plan && (
          <Fact
            label="Plan"
            value={`${facts.plan.done} de ${facts.plan.planned}`}
            hint="sesiones planificadas hechas"
          />
        )}
        <Fact
          label="Carga (sRPE)"
          value={String(facts.load)}
          hint={
            loadDiff === null
              ? facts.missingRpe > 0
                ? `${facts.missingRpe} sin RPE`
                : undefined
              : `${loadDiff >= 0 ? '+' : ''}${loadDiff} % frente a la anterior`
          }
        />
        <Fact
          label="Agudo:crónico"
          value={facts.acwr.ratio === null ? '—' : facts.acwr.ratio.toFixed(2).replace('.', ',')}
          hint={ACWR_TEXT[facts.acwr.status]}
        />
      </div>
      {facts.overloaded.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Mucho volumen (&gt; 20 series): </span>
          {facts.overloaded.map((m) => `${muscleName(m.muscleId)} (${m.sets})`).join(', ')}
        </p>
      )}
      {facts.neglected.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Sin trabajar en 2 semanas: </span>
          {facts.neglected.map(muscleName).join(', ')}
        </p>
      )}
      {facts.prs.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">🏆 Récords</p>
          <ul className="text-muted-foreground">
            {facts.prs.map((p, i) => (
              <li key={i}>
                {p.exercise}: {PR_LABELS[p.type]} {String(p.value).replace('.', ',')} {p.unit}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// Revisión completa: datos, comentario de la IA, 3 recomendaciones, cambios propuestos y
// «Regenerar» (con confirmación: gasta una consulta).
export function WeeklyReviewView({
  userId,
  review,
  sex,
  name,
}: {
  userId: string
  review: ReviewQuery & { refetch: () => unknown }
  sex: Sex | null
  name: (id: string) => string
}) {
  const ai = useAiRequests()
  const status = useAiStatus()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const res = review.data
  const left = status.data ? Math.max(0, status.data.limit - status.data.usedToday) : null

  async function generate(force: boolean) {
    setBusy(true)
    setError(null)
    setConfirming(false)
    const next = await ai.weeklyReview({ generate: true, force })
    void queryClient.invalidateQueries({ queryKey: aiStatusKey })
    if (next.ok) {
      queryClient.setQueryData(weeklyReviewKey(userId, next.review.weekStart), next)
    } else {
      setError(next.message)
    }
    setBusy(false)
  }

  if (review.isPending || !res) {
    return <p className="text-muted-foreground text-center">Cargando…</p>
  }

  if (busy) {
    return (
      <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Sparkles className="text-primary size-4 animate-pulse" /> La IA está revisando tu semana…
      </p>
    )
  }

  if (!res.ok) {
    const canGenerate =
      status.data?.configured && res.code !== 'no_data' && res.code !== 'not_configured'
    return (
      <div className="flex flex-col gap-3">
        <p className="bg-muted rounded-xl p-3 text-sm">{error ?? res.message}</p>
        {canGenerate && (
          <Button size="lg" disabled={left === 0} onClick={() => void generate(false)}>
            <Sparkles /> Revisar mi semana
          </Button>
        )}
        {left !== null && status.data?.configured && (
          <p className="text-muted-foreground text-center text-xs">
            Consultas a la IA que te quedan hoy: {left}
          </p>
        )}
      </div>
    )
  }

  const { review: r, facts, changes } = res.review
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Semana del {formatWeekRange(res.review.weekStart)}
      </p>
      <ReviewFactsView facts={facts} />

      <section aria-label="Comentario del entrenador" className="flex flex-col gap-2">
        <p className="text-primary flex items-center gap-1 text-xs font-medium uppercase">
          <Sparkles className="size-3" /> Tu entrenador
        </p>
        <p className="text-lg font-bold">{r.headline}</p>
        <p className="text-sm">{r.summary}</p>
      </section>

      <section aria-label="Recomendaciones" className="flex flex-col gap-2">
        <h2 className="font-semibold">3 recomendaciones</h2>
        <ol className="flex flex-col gap-2">
          {r.recommendations.map((rec, i) => (
            <li key={i} className="bg-muted/60 rounded-xl p-3 text-sm">
              <p className="font-medium">
                {i + 1}. {rec.title}
              </p>
              <p className="text-muted-foreground">{rec.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Cambios propuestos" className="flex flex-col gap-2">
        <h2 className="font-semibold">Cambios para esta semana</h2>
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hace falta cambiar nada: sigue con tu plan.
          </p>
        ) : (
          changes.map((c, i) => (
            <ChangeCard
              key={`${res.interactionId}-${i}`}
              userId={userId}
              interactionId={res.interactionId}
              index={i}
              change={c}
              response={res.responses[String(i)]}
              sex={sex}
              name={name}
            />
          ))
        )}
      </section>

      {error && <p className="bg-muted rounded-xl p-3 text-sm">{error}</p>}
      {status.data?.configured &&
        (confirming ? (
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            <p className="text-sm">
              ¿Regenerar la revisión? Gasta 1 consulta a la IA (te quedan {left ?? 0} hoy) y
              sustituye a esta.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={!left} onClick={() => void generate(true)}>
                Regenerar
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            <RefreshCw /> Regenerar
          </Button>
        ))}
      <p className="text-muted-foreground text-center text-xs">
        {res.cached ? 'Revisión guardada: volver a abrirla no gasta consultas.' : null}
        {left !== null && ` Consultas que te quedan hoy: ${left}.`}
      </p>
    </div>
  )
}
