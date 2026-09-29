import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { ActivityEditorSheet } from '@/components/activities/activity-editor'
import { BackLink } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { updateCustomActivity } from '@/lib/activities/api'
import { addActivityTypes, customActivities, type ActivityType } from '@/lib/activities/catalog'
import { activityTypesQueryKey, useActivityTypes } from '@/lib/activities/hooks'
import { notifyError, notifySaved } from '@/lib/notify'
import { muscleName } from '@/lib/workout/labels'

// Perfil → «Mis actividades»: actividades y clases personalizadas (nombre, emoji y músculos
// aproximados). Se usan como las predefinidas en «Registrar actividad», actividades fijas,
// historial, resúmenes, logros, mapa muscular y cumplimiento.
export const Route = createFileRoute('/_app/perfil/actividades')({
  ssr: false,
  component: ActivitiesPage,
})

function ActivitiesPage() {
  const { auth } = Route.useRouteContext()
  const queryClient = useQueryClient()
  useActivityTypes(auth.userId)
  const list = customActivities(auth.userId, true)
  const [editing, setEditing] = useState<ActivityType | null | 'new'>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function setArchived(a: ActivityType, archived: boolean) {
    setBusy(a.id)
    try {
      addActivityTypes([await updateCustomActivity(a.id, { archived })])
      void queryClient.invalidateQueries({ queryKey: activityTypesQueryKey(auth.userId) })
      notifySaved(archived ? `«${a.name}» archivada` : `«${a.name}» recuperada`)
    } catch (error) {
      notifyError(error, archived ? 'archivar la actividad' : 'recuperar la actividad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="text-2xl font-bold">Mis actividades</h1>
      <p className="text-muted-foreground text-sm">
        Crea tus propias actividades o clases (body pump, escalada, baile…) con los músculos que
        trabajan. Salen en «Registrar actividad» y en las actividades fijas, y cuentan en el
        cumplimiento, los resúmenes y el mapa muscular (aproximado).
      </p>

      <Button size="lg" onClick={() => setEditing('new')}>
        <Plus /> Nueva actividad
      </Button>

      {list.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          Aún no has creado ninguna.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <span className="text-2xl" aria-hidden>
                {a.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {a.name}
                  {a.archived && (
                    <span className="text-muted-foreground text-xs font-normal"> · archivada</span>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {a.muscles.length > 0
                    ? a.muscles.map(muscleName).join(', ')
                    : 'Sin músculos (no suma en el mapa)'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Editar ${a.name}`}
                onClick={() => setEditing(a)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy === a.id}
                aria-label={a.archived ? `Recuperar ${a.name}` : `Archivar ${a.name}`}
                onClick={() => void setArchived(a, !a.archived)}
              >
                {a.archived ? <ArchiveRestore /> : <Archive />}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Archivar la quita de las listas; las sesiones que ya registraste la conservan.
      </p>

      <ActivityEditorSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        userId={auth.userId}
        activity={editing === 'new' ? null : editing}
      />
    </div>
  )
}
