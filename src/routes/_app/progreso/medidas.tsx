import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { BackLink } from '@/components/progress/common'
import { SeriesChart } from '@/components/progress/line-chart'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteBodyMetric,
  fetchBodyMetrics,
  saveBodyMetric,
  type BodyMetric,
  type BodyMetricInput,
} from '@/lib/progress/api'
import { formatDayMonth, localDateKey } from '@/lib/progress/dates'
import { formatKg, parseDecimal } from '@/lib/workout/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/progreso/medidas')({
  ssr: false,
  component: BodyMetricsPage,
})

type Field = Exclude<keyof BodyMetric, 'id' | 'date' | 'notes'>

const FIELDS: { key: Field; label: string; unit: string }[] = [
  { key: 'weightKg', label: 'Peso', unit: 'kg' },
  { key: 'bodyFatPct', label: 'Grasa', unit: '%' },
  { key: 'waistCm', label: 'Cintura', unit: 'cm' },
  { key: 'hipCm', label: 'Cadera', unit: 'cm' },
  { key: 'chestCm', label: 'Pecho', unit: 'cm' },
  { key: 'armCm', label: 'Brazo', unit: 'cm' },
  { key: 'thighCm', label: 'Muslo', unit: 'cm' },
]

function BodyMetricsPage() {
  const { auth } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const key = ['body-metrics', auth.userId]
  const metrics = useQuery({ queryKey: key, queryFn: () => fetchBodyMetrics(auth.userId) })
  const [chartField, setChartField] = useState<Field>('weightKg')
  const [editing, setEditing] = useState<BodyMetric | null>(null)

  const list = metrics.data ?? []
  const chartMeta = FIELDS.find((f) => f.key === chartField)!
  const points = list.flatMap((m) => {
    const v = m[chartField]
    return v === null ? [] : [{ x: m.date, y: v }]
  })
  const available = FIELDS.filter((f) => list.some((m) => m[f.key] !== null))

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: key })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Peso y medidas</h1>

      <MetricForm
        key={editing?.id ?? 'new'}
        userId={auth.userId}
        initial={editing}
        onSaved={async () => {
          setEditing(null)
          await refresh()
        }}
      />

      {metrics.isError && <p className="text-destructive text-sm">{metrics.error.message}</p>}

      {available.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Medida de la gráfica">
            {available.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={chartField === f.key}
                onClick={() => setChartField(f.key)}
                className={cn(
                  'h-9 rounded-full border px-3 text-sm font-medium',
                  chartField === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <SeriesChart
            title={`${chartMeta.label} (${chartMeta.unit})`}
            points={points}
            formatY={(v) => `${formatKg(v)} ${chartMeta.unit}`}
            formatX={formatDayMonth}
          />
        </>
      )}

      {list.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Registros</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {[...list].reverse().map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setEditing(m)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  >
                    <span className="font-medium">{formatDayMonth(m.date)}</span>
                    <span className="text-muted-foreground block truncate">
                      {FIELDS.filter((f) => m[f.key] !== null)
                        .map((f) => `${f.label} ${formatKg(m[f.key])} ${f.unit}`)
                        .join(' · ')}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Borrar el registro del ${formatDayMonth(m.date)}`}
                    onClick={async () => {
                      if (!confirm('¿Borrar este registro?')) return
                      await deleteBodyMetric(m.id)
                      await refresh()
                    }}
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricForm({
  userId,
  initial,
  onSaved,
}: {
  userId: string
  initial: BodyMetric | null
  onSaved: () => Promise<void>
}) {
  const [date, setDate] = useState(initial?.date ?? localDateKey(new Date()))
  const [values, setValues] = useState<Record<Field, string>>(
    () =>
      Object.fromEntries(
        FIELDS.map((f) => [
          f.key,
          initial?.[f.key] != null ? String(initial[f.key]).replace('.', ',') : '',
        ]),
      ) as Record<Field, string>,
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showAll, setShowAll] = useState(Boolean(initial))
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input: BodyMetricInput = {
      date,
      notes: notes.trim() || null,
      weightKg: null,
      bodyFatPct: null,
      waistCm: null,
      hipCm: null,
      chestCm: null,
      armCm: null,
      thighCm: null,
    }
    for (const f of FIELDS) {
      const raw = values[f.key].trim()
      if (!raw) continue
      const v = parseDecimal(raw)
      if (v === null || v <= 0) {
        setStatus(`${f.label}: valor no válido`)
        return
      }
      input[f.key] = v
    }
    if (FIELDS.every((f) => input[f.key] === null)) {
      setStatus('Escribe al menos un valor')
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      await saveBodyMetric(userId, input)
      await onSaved()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const shown = showAll ? FIELDS : FIELDS.slice(0, 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? 'Editar registro' : 'Nuevo registro'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="metric_date">Fecha</Label>
              <Input
                id="metric_date"
                type="date"
                required
                value={date}
                max={localDateKey(new Date())}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {shown.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`metric_${f.key}`}>
                  {f.label} ({f.unit})
                </Label>
                <Input
                  id={`metric_${f.key}`}
                  inputMode="decimal"
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          {showAll ? (
            <Textarea
              aria-label="Notas"
              placeholder="Notas (opcional)"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />
          ) : (
            <Button type="button" variant="ghost" onClick={() => setShowAll(true)}>
              Añadir medidas (cintura, cadera…)
            </Button>
          )}
          <p className="text-muted-foreground text-xs">
            Un registro por día: si ya hay uno en esa fecha, se sustituye.
          </p>
          {status && <p className="text-destructive text-sm">{status}</p>}
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
