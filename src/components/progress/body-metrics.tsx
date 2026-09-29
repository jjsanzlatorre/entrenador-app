// Peso y medidas: gráfica por medida y lista (también en solo lectura para una persona
// vinculada que comparte sus medidas).
import { useState } from 'react'
import { SeriesChart } from '@/components/progress/line-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BodyMetric } from '@/lib/progress/api'
import { formatDayMonth } from '@/lib/progress/dates'
import { formatKg } from '@/lib/workout/format'
import { cn } from '@/lib/utils'

export type Field = Exclude<keyof BodyMetric, 'id' | 'date' | 'notes'>

export const FIELDS: { key: Field; label: string; unit: string }[] = [
  { key: 'weightKg', label: 'Peso', unit: 'kg' },
  { key: 'bodyFatPct', label: 'Grasa', unit: '%' },
  { key: 'waistCm', label: 'Cintura', unit: 'cm' },
  { key: 'hipCm', label: 'Cadera', unit: 'cm' },
  { key: 'chestCm', label: 'Pecho', unit: 'cm' },
  { key: 'armCm', label: 'Brazo', unit: 'cm' },
  { key: 'thighCm', label: 'Muslo', unit: 'cm' },
]

export function metricSummary(m: BodyMetric) {
  return FIELDS.filter((f) => m[f.key] !== null)
    .map((f) => `${f.label} ${formatKg(m[f.key])} ${f.unit}`)
    .join(' · ')
}

export function MetricsChart({ list }: { list: BodyMetric[] }) {
  const [chartField, setChartField] = useState<Field>('weightKg')
  const available = FIELDS.filter((f) => list.some((m) => m[f.key] !== null))
  const field = available.some((f) => f.key === chartField) ? chartField : available[0]?.key
  if (!field) return null
  const chartMeta = FIELDS.find((f) => f.key === field)!
  const points = list.flatMap((m) => {
    const v = m[field]
    return v === null ? [] : [{ x: m.date, y: v }]
  })
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Medida de la gráfica">
        {available.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={field === f.key}
            onClick={() => setChartField(f.key)}
            className={cn(
              'h-9 rounded-full border px-3 text-sm font-medium',
              field === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card',
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
  )
}

export function MetricsReadOnlyList({ list }: { list: BodyMetric[] }) {
  if (list.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registros</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {[...list].reverse().map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <span className="font-medium">{formatDayMonth(m.date)}</span>
              <span className="text-muted-foreground block">{metricSummary(m)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
