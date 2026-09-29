import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Chip } from '@/components/plan/chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import {
  createCustomActivity,
  updateCustomActivity,
  type CustomActivityInput,
} from '@/lib/activities/api'
import { addActivityTypes, type ActivityType } from '@/lib/activities/catalog'
import { activityTypesQueryKey } from '@/lib/activities/hooks'
import { notifyError, notifySaved } from '@/lib/notify'
import { MUSCLES } from '@/lib/workout/labels'

const EMOJIS = [
  '⭐',
  '🤸',
  '🥊',
  '🧗',
  '💃',
  '🏐',
  '⚽',
  '🏀',
  '🥋',
  '🛶',
  '⛷️',
  '🏇',
  '🤾',
  '🚣',
  '🏸',
  '🧘',
]

// Crear o editar una actividad personalizada: nombre, emoji y músculos aproximados (§6: cada
// 30 min suman 2 series equivalentes a cada músculo marcado).
export function ActivityEditorSheet({
  open,
  onClose,
  userId,
  activity,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  userId: string
  // null = crear una nueva.
  activity: ActivityType | null
  onSaved?: (activity: ActivityType) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={activity ? 'Editar actividad' : 'Nueva actividad'}>
      {open && (
        <ActivityForm
          key={activity?.id ?? 'new'}
          userId={userId}
          activity={activity}
          onDone={(saved) => {
            onSaved?.(saved)
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}

function ActivityForm({
  userId,
  activity,
  onDone,
}: {
  userId: string
  activity: ActivityType | null
  onDone: (activity: ActivityType) => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<CustomActivityInput>(() => ({
    name: activity?.name ?? '',
    emoji: activity?.emoji ?? '⭐',
    muscles: activity?.muscles ?? [],
  }))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const saved = activity
        ? await updateCustomActivity(activity.id, draft)
        : await createCustomActivity(userId, draft)
      addActivityTypes([saved])
      void queryClient.invalidateQueries({ queryKey: activityTypesQueryKey(userId) })
      notifySaved(activity ? 'Actividad guardada' : `«${saved.name}» creada`)
      onDone(saved)
    } catch (error) {
      notifyError(error, 'guardar la actividad')
    } finally {
      setSaving(false)
    }
  }

  const toggleMuscle = (id: string) =>
    setDraft((d) => ({
      ...d,
      muscles: d.muscles.includes(id) ? d.muscles.filter((m) => m !== id) : [...d.muscles, id],
    }))

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="activity-name">Nombre</Label>
        <Input
          id="activity-name"
          value={draft.name}
          maxLength={40}
          placeholder="Body pump, escalada, baile…"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Emoji</legend>
        <div className="grid grid-cols-8 gap-1.5">
          {EMOJIS.map((e) => (
            <Chip
              key={e}
              selected={draft.emoji === e}
              onClick={() => setDraft({ ...draft, emoji: e })}
              className="px-0 text-xl"
              label={`Emoji ${e}`}
            >
              {e}
            </Chip>
          ))}
        </div>
        <Input
          aria-label="Otro emoji"
          value={draft.emoji}
          maxLength={8}
          onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
          className="w-24 text-center text-xl"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Músculos que trabaja</legend>
        <p className="text-muted-foreground mb-1 text-xs">
          Para el mapa muscular (aproximado): cada 30 min suman 2 series a cada músculo marcado.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {MUSCLES.map((m) => (
            <Chip
              key={m.id}
              selected={draft.muscles.includes(m.id)}
              onClick={() => toggleMuscle(m.id)}
            >
              {m.name}
            </Chip>
          ))}
        </div>
      </fieldset>

      <Button size="lg" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
        {saving ? 'Guardando…' : activity ? 'Guardar cambios' : 'Crear actividad'}
      </Button>
    </div>
  )
}
