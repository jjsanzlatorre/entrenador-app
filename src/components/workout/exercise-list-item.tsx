import type { ReactNode } from 'react'
import { CATEGORY_LABELS, muscleName } from '@/lib/workout/labels'
import type { Exercise } from '@/lib/workout/types'

export function primaryMusclesText(exercise: Exercise) {
  const primary = exercise.muscles
    .filter((m) => m.role === 'primary')
    .map((m) => muscleName(m.muscleId))
  if (primary.length > 0) return primary.join(', ')
  // Cardio y deportes: el mapa usará la aproximación por tipo de sesión (fase 4).
  return exercise.category === 'strength' || exercise.category === 'functional'
    ? 'Sin músculos asignados'
    : CATEGORY_LABELS[exercise.category]
}

export function ExerciseListItem({
  exercise,
  onClick,
  trailing,
}: {
  exercise: Exercise
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="hover:bg-accent active:bg-accent flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {exercise.name}
            {exercise.ownerId && <span className="text-primary ml-1.5 text-xs">propio</span>}
          </p>
          <p className="text-muted-foreground truncate text-sm">{primaryMusclesText(exercise)}</p>
        </div>
        {trailing}
      </button>
    </li>
  )
}
