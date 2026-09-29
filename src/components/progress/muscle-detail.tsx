import { Sheet } from '@/components/ui/sheet'
import { formatSets, type MuscleVolume } from '@/lib/progress/muscle-volume'
import { muscleName } from '@/lib/workout/labels'
import { activityEmoji, activityLabel } from '@/lib/activities/catalog'

export function formatDiff(diff: number) {
  if (Math.abs(diff) < 0.05) return '='
  return `${diff > 0 ? '+' : '−'}${formatSets(Math.abs(diff))}`
}

// Detalle de un músculo: series de la semana y qué ejercicios o sesiones las aportan.
export function MuscleDetailSheet({
  muscleId,
  volume,
  previousSets,
  neglectedWeeks,
  exerciseName,
  onClose,
}: {
  muscleId: string | null
  volume: MuscleVolume | undefined
  previousSets: number | null
  neglectedWeeks?: { weeks: number; orMore: boolean } | null
  exerciseName: (id: string) => string
  onClose: () => void
}) {
  const sets = volume?.sets ?? 0
  return (
    <Sheet open={muscleId !== null} onClose={onClose} title={muscleId ? muscleName(muscleId) : ''}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-bold tabular-nums">{formatSets(sets)}</p>
            <p className="text-muted-foreground text-sm">
              series efectivas en la semana
              {volume && volume.approxSets > 0 && (
                <> (≈{formatSets(volume.approxSets)} aproximadas)</>
              )}
            </p>
          </div>
          {previousSets !== null && (
            <p className="text-right text-sm">
              <span className="font-semibold tabular-nums">{formatDiff(sets - previousSets)}</span>
              <span className="text-muted-foreground block text-xs">
                frente a {formatSets(previousSets)} la semana anterior
              </span>
            </p>
          )}
        </div>

        {neglectedWeeks && (
          <p className="rounded-lg border border-dashed border-[var(--mv-neglected)] p-3 text-sm">
            Sin series en {neglectedWeeks.orMore ? 'al menos ' : ''}
            {neglectedWeeks.weeks} semanas. Si encaja en tu plan, dale algo de trabajo.
          </p>
        )}

        {volume && volume.contributions.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Qué lo ha trabajado</h3>
            <ul className="flex flex-col divide-y rounded-xl border">
              {volume.contributions.map((c) =>
                c.kind === 'exercise' ? (
                  <li key={`e-${c.exerciseId}`} className="flex items-center gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{exerciseName(c.exerciseId)}</p>
                      <p className="text-muted-foreground text-xs">
                        {c.rawSets} {c.rawSets === 1 ? 'serie' : 'series'} ·{' '}
                        {c.role === 'primary' ? 'principal (×1)' : 'secundario (×0,5)'}
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums">{formatSets(c.sets)}</span>
                  </li>
                ) : (
                  <li key={`c-${c.activity}`} className="flex items-center gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        <span aria-hidden>{activityEmoji(c.activity)} </span>
                        {activityLabel(c.activity)}{' '}
                        <span className="text-muted-foreground text-xs font-normal">
                          (aproximado)
                        </span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {c.sessions} {c.sessions === 1 ? 'sesión' : 'sesiones'} · {c.minutes} min
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums">≈{formatSets(c.sets)}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Ninguna serie en esta semana.</p>
        )}

        <p className="text-muted-foreground text-xs">
          Serie efectiva: completada y sin calentamiento; cuenta 1 si el músculo es principal y 0,5
          si es secundario. Cardio, deportes y clases: ≈2 series por cada 30 min en sus músculos
          (yoga 0,5).
        </p>
      </div>
    </Sheet>
  )
}
