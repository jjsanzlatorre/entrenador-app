import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Check, ClipboardCopy, X } from 'lucide-react'
import { BackLink } from '@/components/layout/back-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { feedbackQueryKey, setFeedbackStatus, useFeedbackList } from '@/lib/feedback/api'
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUS_LABEL,
  feedbackAsText,
  type FeedbackItem,
} from '@/lib/feedback/feedback'
import { notifyError, notifySaved } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { listUsers } from '@/server/admin.functions'
import type { FeedbackStatus } from '@/types/database'

export const Route = createFileRoute('/_app/admin/feedback')({
  beforeLoad: ({ context }) => {
    if (context.auth.profile.role !== 'admin') throw redirect({ to: '/' })
  },
  component: AdminFeedbackPage,
})

const FILTERS: { value: FeedbackStatus | 'all'; label: string }[] = [
  { value: 'new', label: 'Nuevos' },
  { value: 'done', label: 'Hechos' },
  { value: 'discarded', label: 'Descartados' },
  { value: 'all', label: 'Todos' },
]

function AdminFeedbackPage() {
  const queryClient = useQueryClient()
  const list = useFeedbackList()
  const listUsersFn = useServerFn(listUsers)
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => listUsersFn(), retry: 1 })
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('new')
  const [exporting, setExporting] = useState(false)

  const nameOf = (userId: string) => {
    const u = users.data?.find((x) => x.id === userId)
    return u?.displayName ?? u?.email ?? `usuario ${userId.slice(0, 8)}`
  }
  const items = (list.data ?? []).filter((f) => filter === 'all' || f.status === filter)
  const text = feedbackAsText(items, nameOf)

  const status = useMutation({
    mutationFn: ({ id, value }: { id: string; value: FeedbackStatus }) =>
      setFeedbackStatus(id, value),
    onSuccess: async (_d, v) => {
      notifySaved(`Marcado como ${FEEDBACK_STATUS_LABEL[v.value].toLowerCase()}`)
      await queryClient.invalidateQueries({ queryKey: feedbackQueryKey })
    },
    onError: (e) => notifyError(e, 'cambiar el estado'),
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      notifySaved('Copiado: pégalo en Claude Code')
    } catch {
      notifyError('el navegador no deja copiar; selecciona el texto a mano', 'copiar')
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="pr-10 text-2xl font-bold">Feedback recibido</h1>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="Estado">
        {FILTERS.map((f) => {
          const count =
            f.value === 'all'
              ? (list.data?.length ?? 0)
              : (list.data?.filter((x) => x.status === f.value).length ?? 0)
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'h-10 shrink-0 rounded-full border px-3 text-sm font-medium',
                filter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card',
              )}
            >
              {f.label} ({count})
            </button>
          )
        })}
      </div>
      <Button
        size="lg"
        variant="outline"
        disabled={items.length === 0}
        onClick={() => setExporting(true)}
      >
        <ClipboardCopy /> Exportar como texto
      </Button>

      {list.isPending && <p className="text-muted-foreground text-sm">Cargando…</p>}
      {list.isError && <p className="text-destructive text-sm">{list.error.message}</p>}
      {list.data && items.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
          No hay comentarios {filter === 'all' ? '' : FEEDBACK_STATUS_LABEL[filter].toLowerCase()}.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((f) => (
          <FeedbackCard
            key={f.id}
            item={f}
            author={nameOf(f.userId)}
            busy={status.isPending}
            onStatus={(value) => status.mutate({ id: f.id, value })}
          />
        ))}
      </ul>

      <Sheet
        open={exporting}
        onClose={() => setExporting(false)}
        title="Exportar como texto"
        footer={
          <Button size="lg" className="w-full" onClick={() => void copy()}>
            <ClipboardCopy /> Copiar
          </Button>
        }
      >
        <p className="text-muted-foreground pb-2 text-sm">
          {items.length} {items.length === 1 ? 'comentario' : 'comentarios'} (filtro actual). Pégalo
          en Claude Code.
        </p>
        <Textarea readOnly value={text} rows={14} className="font-mono text-xs" />
      </Sheet>
    </div>
  )
}

function FeedbackCard({
  item,
  author,
  busy,
  onStatus,
}: {
  item: FeedbackItem
  author: string
  busy: boolean
  onStatus: (value: FeedbackStatus) => void
}) {
  const kind = FEEDBACK_KINDS.find((k) => k.kind === item.kind)
  return (
    <li className="bg-card flex flex-col gap-2 rounded-2xl border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {kind?.emoji} {kind?.label}
        </span>
        <Badge variant={item.status === 'new' ? 'default' : 'secondary'}>
          {FEEDBACK_STATUS_LABEL[item.status]}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs">
          {new Date(item.createdAt).toLocaleString('es-ES', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{item.message}</p>
      <p className="text-muted-foreground text-xs">
        {author} · <code>{item.route ?? '—'}</code>
        <br />
        {item.device ?? '—'}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Button
          size="sm"
          variant={item.status === 'done' ? 'default' : 'outline'}
          disabled={busy || item.status === 'done'}
          onClick={() => onStatus('done')}
        >
          <Check /> Hecho
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || item.status === 'discarded'}
          onClick={() => onStatus('discarded')}
        >
          <X /> Descartar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || item.status === 'new'}
          onClick={() => onStatus('new')}
        >
          Nuevo
        </Button>
      </div>
    </li>
  )
}
