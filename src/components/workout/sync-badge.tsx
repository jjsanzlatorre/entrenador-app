import { CloudCheck, CloudOff, CloudUpload, RefreshCw } from 'lucide-react'
import { syncNow } from '@/lib/offline/sync-engine'
import { useSyncStatus } from '@/lib/workout/hooks'
import { cn } from '@/lib/utils'

// Estado de la sincronización. Tocarlo fuerza un reintento.
export function SyncBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const status = useSyncStatus()
  const {
    icon: Icon,
    label,
    tone,
  } = !status.online
    ? {
        icon: CloudOff,
        label: compact ? 'Sin conexión' : 'Sin conexión · guardado en el móvil',
        tone: 'text-amber-600 dark:text-amber-400',
      }
    : status.syncing
      ? {
          icon: RefreshCw,
          label: compact ? 'Sincronizando' : 'Sincronizando…',
          tone: 'text-muted-foreground',
        }
      : status.pending > 0
        ? {
            icon: CloudUpload,
            label: compact ? 'Pendiente' : 'Pendiente de sincronizar',
            tone: 'text-amber-600 dark:text-amber-400',
          }
        : { icon: CloudCheck, label: 'Guardado', tone: 'text-emerald-600 dark:text-emerald-400' }

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium', tone, className)}
      aria-live="polite"
      title={status.lastError ?? undefined}
      aria-label={compact ? `Sincronización: ${label}` : undefined}
    >
      <Icon className={cn('size-4', status.syncing && 'animate-spin')} aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
