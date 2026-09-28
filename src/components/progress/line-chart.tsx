import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type ChartPoint = { x: string; y: number }

// Gráfica de una sola serie (el título la nombra; sin leyenda ni doble eje).
// El eje Y invertido sirve para ritmos (menos es mejor: arriba).
export function SeriesChart({
  title,
  points,
  formatY,
  formatX,
  reversed = false,
  note,
}: {
  title: string
  points: ChartPoint[]
  formatY: (v: number) => string
  formatX: (x: string) => string
  reversed?: boolean
  note?: string
}) {
  const last = points.at(-1)
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span>{title}</span>
          {last && <span className="text-base tabular-nums">{formatY(last.y)}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        {points.length < 2 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            La gráfica aparece a partir de la segunda sesión.
          </p>
        ) : (
          <div className="h-44" role="img" aria-label={`${title}: ${points.length} sesiones`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="x"
                  tickFormatter={formatX}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={24}
                />
                <YAxis
                  width={48}
                  reversed={reversed}
                  domain={['auto', 'auto']}
                  tickFormatter={formatY}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(v) => [formatY(Number(v)), title]}
                  labelFormatter={(x) => formatX(String(x))}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                  cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
                />
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--card)', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {note && <p className="text-muted-foreground px-3 pt-1 text-xs">{note}</p>}
      </CardContent>
    </Card>
  )
}
