import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { committedSessions, commitmentForWeek } from '@/lib/progress/adherence'
import { saveCommitment } from '@/lib/progress/api'
import { formatDayMonth, localDateKey, weekStartOf } from '@/lib/progress/dates'
import { commitmentsKey, useCommitments } from '@/lib/progress/hooks'
import type { Commitment } from '@/lib/progress/types'
import { parseInteger } from '@/lib/workout/format'
import { sessionTypeEmoji, sessionTypeLabel } from '@/lib/workout/session-kinds'
import type { SessionType } from '@/types/database'

export const Route = createFileRoute('/_app/perfil/compromiso')({
  ssr: false,
  component: CommitmentPage,
})

const TYPES: SessionType[] = [
  'strength',
  'functional',
  'running',
  'swimming',
  'cycling',
  'spinning',
  'yoga',
  'padel_fronton',
  'surf',
]

function CommitmentPage() {
  const { auth } = Route.useRouteContext()
  const commitments = useCommitments(auth.userId)
  const today = localDateKey(new Date())
  const current = commitments.data ? commitmentForWeek(commitments.data, weekStartOf(today)) : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/perfil"
        className="text-primary -ml-1 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4" /> Perfil
      </Link>
      <h1 className="text-2xl font-bold">Mi compromiso</h1>
      <p className="text-muted-foreground text-sm">
        Lo que te comprometes a hacer cada semana (de lunes a domingo). Cuenta una sesión por día y
        tipo, de al menos 15 minutos. Si lo cambias, las semanas pasadas se siguen midiendo con el
        compromiso que tenías entonces.
      </p>
      {commitments.isPending ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : commitments.isError ? (
        <p className="text-destructive">{commitments.error.message}</p>
      ) : (
        <CommitmentForm
          key={current?.validFrom ?? 'new'}
          userId={auth.userId}
          current={current}
          weekStart={weekStartOf(today)}
        />
      )}
      {commitments.data && commitments.data.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {[...commitments.data].reverse().map((c) => (
                <li key={c.validFrom} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    Desde el {formatDayMonth(c.validFrom)}
                    {c.validTo ? ` hasta el ${formatDayMonth(c.validTo)}` : ''}
                  </span>
                  <span className="font-medium">{committedSessions(c)} / semana</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-11"
        aria-label={`Menos ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span className="w-8 text-center text-2xl font-bold tabular-nums">{value}</span>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-11"
        aria-label={`Más ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  )
}

function CommitmentForm({
  userId,
  current,
  weekStart,
}: {
  userId: string
  current: Commitment | null
  weekStart: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sessions, setSessions] = useState(current?.sessionsPerWeek ?? 3)
  const [minutes, setMinutes] = useState(current?.minutesPerWeek?.toString() ?? '')
  const [useByType, setUseByType] = useState(Boolean(current?.byType))
  const [byType, setByType] = useState<Partial<Record<SessionType, number>>>(current?.byType ?? {})
  const [countsFree, setCountsFree] = useState(current?.countsFreeActivities ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typedTotal = Object.values(byType).reduce((a, n) => a + (n ?? 0), 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const minutesValue = minutes.trim() ? parseInteger(minutes) : null
    if (minutes.trim() && (!minutesValue || minutesValue < 1)) {
      setError('Los minutos tienen que ser un número mayor que 0')
      return
    }
    const cleanByType = Object.fromEntries(
      Object.entries(byType).filter(([, n]) => (n ?? 0) > 0),
    ) as Partial<Record<SessionType, number>>
    setSaving(true)
    try {
      await saveCommitment({
        validFrom: weekStart,
        sessionsPerWeek: sessions,
        minutesPerWeek: minutesValue,
        byType: useByType && Object.keys(cleanByType).length > 0 ? cleanByType : null,
        countsFreeActivities: countsFree,
      })
      await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
      await navigate({ to: '/progreso/cumplimiento' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sesiones por semana</CardTitle>
        </CardHeader>
        <CardContent>
          <Stepper value={sessions} onChange={setSessions} min={1} max={14} label="sesiones" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Minutos por semana</CardTitle>
          <CardDescription>Opcional. Añade una segunda barra con los minutos.</CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="minutes" className="sr-only">
            Minutos por semana
          </Label>
          <Input
            id="minutes"
            inputMode="numeric"
            placeholder="p. ej. 180"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reparto por tipo</CardTitle>
          <CardDescription>
            Opcional, p. ej. 2 de fuerza + 1 de natación. Si suma menos que las sesiones por semana,
            el resto vale cualquier tipo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5"
              checked={useByType}
              onChange={(e) => setUseByType(e.target.checked)}
            />
            Repartir por tipo de sesión
          </label>
          {useByType && (
            <>
              <ul className="flex flex-col gap-2">
                {TYPES.map((t) => (
                  <li key={t} className="flex items-center justify-between gap-2">
                    <span>
                      <span aria-hidden>{sessionTypeEmoji(t)} </span>
                      {sessionTypeLabel(t)}
                    </span>
                    <Stepper
                      value={byType[t] ?? 0}
                      onChange={(v) => setByType((b) => ({ ...b, [t]: v }))}
                      min={0}
                      max={7}
                      label={sessionTypeLabel(t)}
                    />
                  </li>
                ))}
              </ul>
              {typedTotal > sessions && (
                <p className="text-muted-foreground text-sm">
                  El reparto suma {typedTotal}: tu objetivo semanal será de {typedTotal} sesiones.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <label className="bg-card flex items-start gap-3 rounded-xl border p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-5"
          checked={countsFree}
          onChange={(e) => setCountsFree(e.target.checked)}
        />
        <span>
          <span className="font-medium">Surf, frontón, yoga y otras actividades cuentan</span>
          <span className="text-muted-foreground block">
            Si lo desmarcas, solo cuentan fuerza, functional, carrera, natación y bici.
          </span>
        </span>
      </label>

      <p className="text-muted-foreground text-sm">
        Se aplica desde esta semana (lunes {formatDayMonth(weekStart)}).
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Guardando…' : 'Guardar compromiso'}
      </Button>
    </form>
  )
}
