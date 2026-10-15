// «Repetir último entreno», «Mis plantillas» y «Guardar como plantilla» (usabilidad 3/3).
import { useState } from 'react'
import { MoreVertical, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { formatDateShort } from '@/lib/workout/format'
import { useCatalog, useHistory } from '@/lib/workout/hooks'
import { sessionTypeEmoji } from '@/lib/workout/session-kinds'
import {
  defaultTemplateName,
  structureFromSession,
  structureSummary,
  type WorkoutTemplate,
} from '@/lib/workout/templates'
import {
  useStartFromStructure,
  useTemplateMutations,
  useTemplates,
} from '@/lib/workout/templates-api'
import type { LocalSession } from '@/lib/workout/types'
import type { SessionStart } from '@/lib/workout/active-session'

// Última sesión terminada con ejercicios (las actividades rápidas no se repiten).
export function useLastRepeatable(userId: string) {
  const history = useHistory(userId)
  return history.data?.items.find((i) => i.endedAt && i.exerciseIds.length > 0) ?? null
}

// Últimas sesiones terminadas con ejercicios (para «Repetir…» en «Registrar entreno pasado»).
function useRecentRepeatable(userId: string, limit: number) {
  const history = useHistory(userId)
  return (history.data?.items ?? [])
    .filter((i) => i.endedAt && i.exerciseIds.length > 0)
    .slice(0, limit)
}

// Bloque de «Empezar entreno»: repetir el último y las plantillas, antes de elegir tipo.
// Con `past` («Registrar entreno pasado») se ofrecen las últimas sesiones para repetir.
// `start` da la fecha y hora elegidas (null = no válidas: botones desactivados).
export function QuickStartOptions({
  userId,
  onStarted,
  start,
  past = false,
}: {
  userId: string
  onStarted?: () => void
  start?: () => SessionStart | null
  past?: boolean
}) {
  const lastOne = useLastRepeatable(userId)
  const recent = useRecentRepeatable(userId, past ? 4 : 1)
  const repeatables = past ? recent : lastOne ? [lastOne] : []
  const last = repeatables[0] ?? null
  const templates = useTemplates(userId)
  const catalog = useCatalog(userId)
  const starter = useStartFromStructure(userId)
  const [managing, setManaging] = useState<WorkoutTemplate | null>(null)
  const list = templates.data ?? []
  const nameOf = (id: string) => catalog.byId.get(id)?.name ?? id

  if (!last && list.length === 0) return null
  const when = () => (start ? start() : undefined)
  const blocked = start ? start() === null : false
  return (
    <div className="flex flex-col gap-2 pb-3">
      {repeatables.map((item, i) => (
        <Button
          key={item.id}
          size="lg"
          variant="secondary"
          disabled={starter.busy || blocked}
          className="h-auto justify-start py-3 text-left"
          onClick={() => {
            const at = when()
            if (at === null) return
            onStarted?.()
            void starter.repeat(item.id, at)
          }}
        >
          <RotateCcw className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {past ? `Repetir «${item.title}»` : i === 0 ? 'Repetir último entreno' : 'Repetir'}
            </span>
            <span className="text-muted-foreground block truncate text-xs font-normal">
              {sessionTypeEmoji(item.sessionType, item.activityTypeId)} {item.title} ·{' '}
              {formatDateShort(item.startedAt)} · con los pesos sugeridos
            </span>
          </span>
        </Button>
      ))}
      {list.length > 0 && (
        <section aria-label="Mis plantillas" className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Mis plantillas</h3>
          {list.map((t) => (
            <div key={t.id} className="bg-card flex items-center rounded-xl border">
              <button
                type="button"
                disabled={starter.busy || blocked}
                onClick={() => {
                  const at = when()
                  if (at === null) return
                  onStarted?.()
                  void starter.start(t.structure, {
                    title: t.name,
                    sessionType: t.sessionType,
                    activityTypeId: t.activityTypeId,
                    templateId: t.id,
                    start: at,
                  })
                }}
                className="flex min-h-14 min-w-0 flex-1 flex-col items-start px-3 py-2 text-left"
              >
                <span className="truncate font-medium">
                  {sessionTypeEmoji(t.sessionType, t.activityTypeId)} {t.name}
                </span>
                <span className="text-muted-foreground w-full truncate text-xs">
                  {structureSummary(t.structure, nameOf)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Opciones de la plantilla ${t.name}`}
                onClick={() => setManaging(t)}
                className="hover:bg-accent mr-1 rounded-full p-2.5"
              >
                <MoreVertical className="size-5" />
              </button>
            </div>
          ))}
        </section>
      )}
      <ManageTemplateSheet userId={userId} template={managing} onClose={() => setManaging(null)} />
      <h3 className="pt-2 text-sm font-semibold">O empieza uno nuevo</h3>
    </div>
  )
}

function ManageTemplateSheet({
  userId,
  template,
  onClose,
}: {
  userId: string
  template: WorkoutTemplate | null
  onClose: () => void
}) {
  const { rename, remove } = useTemplateMutations(userId)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  if (!template) return null
  return (
    <Sheet
      open
      onClose={() => {
        setEditing(false)
        onClose()
      }}
      title={template.name}
    >
      <div className="flex flex-col gap-2 pb-2">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              rename.mutate(
                { id: template.id, name },
                {
                  onSuccess: () => {
                    setEditing(false)
                    onClose()
                  },
                },
              )
            }}
          >
            <Label htmlFor="template-rename">Nombre</Label>
            <Input
              id="template-rename"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <Button size="lg" type="submit" disabled={rename.isPending || !name.trim()}>
              Guardar
            </Button>
          </form>
        ) : (
          <>
            <Button
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => {
                setName(template.name)
                setEditing(true)
              }}
            >
              <Pencil /> Cambiar nombre
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="text-destructive justify-start"
              disabled={remove.isPending}
              onClick={() => {
                if (!confirm(`¿Borrar la plantilla «${template.name}»?`)) return
                remove.mutate(template.id, { onSuccess: onClose })
              }}
            >
              <Trash2 /> Borrar plantilla
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}

// «Guardar como plantilla» desde una sesión terminada (detalle o resumen).
export function SaveTemplateButton({
  userId,
  session,
  className,
}: {
  userId: string
  session: LocalSession
  className?: string
}) {
  const { create } = useTemplateMutations(userId)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const structure = structureFromSession(session)
  if (!structure) return null
  return (
    <>
      <Button
        variant="outline"
        size="lg"
        className={className}
        onClick={() => {
          setName(defaultTemplateName(session.title, new Date(session.startedAt)))
          setOpen(true)
        }}
      >
        <Save /> Guardar como plantilla
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Guardar como plantilla">
        <form
          className="flex flex-col gap-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            create.mutate(
              {
                name,
                sessionType: session.sessionType,
                activityTypeId: session.activityTypeId ?? null,
                structure,
              },
              { onSuccess: () => setOpen(false) },
            )
          }}
        >
          <p className="text-muted-foreground text-sm">
            Se guardan los ejercicios, las series y las reps (no los pesos: al empezar se usan los
            sugeridos). La tendrás en «Empezar entreno» → «Mis plantillas».
          </p>
          <Label htmlFor="template-name">Nombre</Label>
          <Input
            id="template-name"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="lg" type="submit" disabled={create.isPending || !name.trim()}>
            Guardar plantilla
          </Button>
        </form>
      </Sheet>
    </>
  )
}
