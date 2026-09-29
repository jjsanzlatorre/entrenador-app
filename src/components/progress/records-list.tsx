// Lista de récords por ejercicio con buscador (Progreso → Récords y, en solo lectura, la
// evolución de una persona que comparte sus entrenos).
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, Trophy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { ExerciseLinkRenderer } from '@/components/workout/session-view'
import { fetchRecords } from '@/lib/progress/api'
import {
  currentRecords,
  formatRecordValue,
  PR_LABELS,
  type PersonalRecord,
} from '@/lib/progress/records'
import { useOwnerCatalog, type DataOwner } from '@/lib/partners/hooks'
import { formatDateShort } from '@/lib/workout/format'
import { normalizeText } from '@/lib/workout/search'

const RECENT_MS = 7 * 24 * 3600 * 1000

export function RecordsList({
  owner,
  emptyText,
  renderLink,
}: {
  owner: DataOwner
  emptyText: string
  renderLink: ExerciseLinkRenderer
}) {
  const catalog = useOwnerCatalog(owner)
  const records = useQuery({
    queryKey: ['records', owner.userId],
    queryFn: () => fetchRecords(owner.userId),
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
    <>
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
          {emptyText}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((g) => {
          const top = g.current.main[0] ?? g.current.reps[0]
          const recent =
            g.lastImprovement && now - new Date(g.lastImprovement).getTime() < RECENT_MS
          return (
            <li key={g.exerciseId}>
              {renderLink(
                g.exerciseId,
                'bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3',
                <>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {g.name}
                      {recent && (
                        <Trophy
                          className="text-trophy size-4 shrink-0"
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
                </>,
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
