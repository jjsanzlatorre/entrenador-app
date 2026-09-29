import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stepper } from '@/components/ui/stepper'
import { committedSessions, currentCommitment } from '@/lib/progress/adherence'
import { deleteCommitment, endCommitment, saveCommitment } from '@/lib/progress/api'
import { formatDayMonth, localDateKey, weekStartOf } from '@/lib/progress/dates'
import { commitmentsKey, useCommitments } from '@/lib/progress/hooks'
import type { Commitment } from '@/lib/progress/types'
import { parseInteger } from '@/lib/workout/format'
import { notifyError, notifySaved } from '@/lib/notify'
import { planSessionsPerWeek } from '@/lib/plan/calendar'
import { useActivePlan } from '@/lib/plan/hooks'
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
  'functional_class',
  'gap',
  'oxfit',
  'yoga',
  'fronton',
  'padel',
  'tennis',
  'surf',
]

function CommitmentPage() {
  const { auth } = Route.useRouteContext()
  const commitments = useCommitments(auth.userId)
  const today = localDateKey(new Date())
  const current = commitments.data ? currentCommitment(commitments.data, today) : null
  const plan = useActivePlan(auth.userId)
  const fromPlan = plan.data
    ? { name: plan.data.name, perWeek: planSessionsPerWeek(plan.data.sessions) }
    : null

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
        <>
          {!current && (
            <p className="bg-muted rounded-xl p-3 text-sm">
              {commitments.data.length > 0
                ? 'Ahora mismo no tienes compromiso. Crea uno nuevo cuando quieras.'
                : 'Aún no tienes compromiso.'}
            </p>
          )}
          <CommitmentForm
            key={current?.id ?? current?.validFrom ?? 'new'}
            userId={auth.userId}
            current={current}
            weekStart={weekStartOf(today)}
            fromPlan={fromPlan && fromPlan.perWeek > 0 ? fromPlan : null}
          />
          {current && <EndCommitmentButton userId={auth.userId} today={today} />}
        </>
      )}
      {commitments.data && commitments.data.length > 0 && (
        <CommitmentHistory userId={auth.userId} commitments={commitments.data} today={today} />
      )}
    </div>
  )
}

function CommitmentForm({
  userId,
  current,
  weekStart,
  fromPlan,
}: {
  userId: string
  current: Commitment | null
  weekStart: string
  // Plan activo: se ofrece usar sus sesiones por semana como compromiso (§10A).
  fromPlan: { name: string; perWeek: number } | null
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
      notifyError('los minutos tienen que ser un número mayor que 0', 'guardar el compromiso')
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
      notifySaved('Compromiso guardado')
      await navigate({ to: '/progreso/cumplimiento' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      notifyError(err, 'guardar el compromiso')
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
          {fromPlan && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-auto w-full py-2 whitespace-normal"
              disabled={sessions === fromPlan.perWeek}
              onClick={() => setSessions(fromPlan.perWeek)}
            >
              {sessions === fromPlan.perWeek
                ? `Igual que tu plan «${fromPlan.name}»`
                : `Usar las de mi plan «${fromPlan.name}»: ${fromPlan.perWeek} por semana`}
            </Button>
          )}
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

// «Quitar compromiso»: cierra el vigente hoy y conserva el historial.
function EndCommitmentButton({ userId, today }: { userId: string; today: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function end() {
    if (
      !confirm(
        '¿Quitar tu compromiso? Dejarás de ver los porcentajes hasta que crees uno nuevo. El historial se conserva.',
      )
    )
      return
    setBusy(true)
    try {
      await endCommitment(today)
      await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
      notifySaved('Compromiso quitado')
    } catch (err) {
      notifyError(err, 'quitar el compromiso')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      className="text-destructive"
      disabled={busy}
      onClick={() => void end()}
    >
      Quitar compromiso
    </Button>
  )
}

// Historial con opción de borrar una entrada creada por error.
function CommitmentHistory({
  userId,
  commitments,
  today,
}: {
  userId: string
  commitments: Commitment[]
  today: string
}) {
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function remove(c: Commitment) {
    if (!c.id) return
    const range = c.validTo
      ? `del ${formatDayMonth(c.validFrom)} al ${formatDayMonth(c.validTo)}`
      : `desde el ${formatDayMonth(c.validFrom)}`
    if (
      !confirm(
        `¿Borrar el compromiso ${range} (${committedSessions(c)} / semana)? Esas semanas se quedarán sin compromiso. No se puede deshacer.`,
      )
    )
      return
    setBusyId(c.id)
    try {
      await deleteCommitment(c.id)
      await queryClient.invalidateQueries({ queryKey: commitmentsKey(userId) })
      notifySaved('Compromiso borrado')
    } catch (err) {
      notifyError(err, 'borrar el compromiso')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial</CardTitle>
        <CardDescription>
          Borra una entrada solo si la creaste por error: esas semanas se quedarán sin compromiso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          {[...commitments].reverse().map((c) => {
            const active = c.validTo === null || c.validTo > today
            return (
              <li key={c.id ?? c.validFrom} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  Desde el {formatDayMonth(c.validFrom)}
                  {c.validTo ? ` hasta el ${formatDayMonth(c.validTo)}` : ''}
                  {active ? ' (vigente)' : ''}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium">{committedSessions(c)} / semana</span>
                  {c.id && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-10"
                      aria-label={`Borrar el compromiso desde el ${formatDayMonth(c.validFrom)}`}
                      disabled={busyId !== null}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
