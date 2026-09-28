import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, Trophy } from 'lucide-react'
import { BackLink } from '@/components/progress/common'
import { Input } from '@/components/ui/input'
import { fetchRecords } from '@/lib/progress/api'
import {
  currentRecords,
  formatRecordValue,
  PR_LABELS,
  type PersonalRecord,
} from '@/lib/progress/records'
import { formatDateShort } from '@/lib/workout/format'
import { useCatalog } from '@/lib/workout/hooks'
import { normalizeText } from '@/lib/workout/search'

export const Route = createFileRoute('/_app/progreso/records')({
  ssr: false,
  component: RecordsPage,
})

const RECENT_MS = 7 * 24 * 3600 * 1000

function RecordsPage() {
  const { auth } = Route.useRouteContext()
  const catalog = useCatalog(auth.userId)
  const records = useQuery({
    queryKey: ['records', auth.userId],
    queryFn: () => fetchRecords(auth.userId),
  })
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const byExercise = new Map<string, PersonalRecord[]>()
    for (const r of records.data ?? []) {
      const list = byExercise.get(r.exerciseId) ?? []
      list.push(r)
      byExercise.set(r.exerciseId, list)
    }
    return [...byExercise.entries()]
      .map(([exerciseId, list]) => ({
        exerciseId,
        name: catalog.byId.get(exerciseId)?.name ?? exerciseId,
        last: list.reduce((a, r) => (r.achievedAt > a ? r.achievedAt : a), ''),
        lastImprovement: list
          .filter((r) => r.previousValue !== null)
          .reduce((a, r) => (r.achievedAt > a ? r.achievedAt : a), ''),
        current: currentRecords(list),
      }))
      .sort((a, b) => b.last.localeCompare(a.last))
  }, [records.data, catalog.byId])

  const q = normalizeText(query.trim())
  const visible = q ? groups.filter((g) => normalizeText(g.name).includes(q)) : groups
  // eslint-disable-next-line react-hooks/purity -- «reciente» se calcula al pintar
  const now = Date.now()

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Récords y gráficas</h1>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          className="pl-9"
          placeholder="Buscar ejercicio"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar ejercicio"
        />
      </div>
      {records.isPending && <p className="text-muted-foreground">Cargando…</p>}
      {records.isError && <p className="text-destructive text-sm">{records.error.message}</p>}
      {records.data && groups.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
          Termina alguna sesión y aquí verás tus marcas por ejercicio.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((g) => {
          const top = g.current.main[0] ?? g.current.reps[0]
          const recent =
            g.lastImprovement && now - new Date(g.lastImprovement).getTime() < RECENT_MS
          return (
            <li key={g.exerciseId}>
              <Link
                to="/progreso/ejercicio/$exerciseId"
                params={{ exerciseId: g.exerciseId }}
                className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {g.name}
                    {recent && (
                      <Trophy
                        className="size-4 shrink-0 text-amber-500"
                        aria-label="Récord reciente"
                      />
                    )}
                  </p>
                  {top && (
                    <p className="text-muted-foreground truncate text-xs">
                      {PR_LABELS[top.prType]}: {formatRecordValue(top)} ·{' '}
                      {formatDateShort(top.achievedAt)}
                    </p>
                  )}
                </div>
                <ChevronRight className="text-muted-foreground size-5" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
