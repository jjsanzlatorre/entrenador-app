import { competitionText, describeBlock } from '@/lib/plan/describe'
import type { PlanBlock } from '@/lib/plan/types'
import type { Sex } from '@/types/database'

// Prescripción de una sesión planificada: bloques, notas y estándares de competición (pesos
// según el sexo del perfil; sin sexo definido, los dos).
export function PlannedBlocks({
  blocks,
  name,
  sex,
}: {
  blocks: PlanBlock[]
  name: (id: string) => string
  sex: Sex | null | undefined
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {blocks.map((b, i) => {
        const d = describeBlock(b, name)
        return (
          <li key={i} className="rounded-lg border p-3">
            {d.title && <p className="font-semibold">{d.title}</p>}
            <ul>
              {d.lines.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
            {b.note && <p className="text-muted-foreground mt-1 text-xs">{b.note}</p>}
            {b.exercises
              .filter((e) => e.note || e.standard)
              .map((e, j) => (
                <p key={j} className="text-muted-foreground mt-1 text-xs">
                  {name(e.exercise_id)}:{' '}
                  {[e.note, e.standard ? competitionText(e.standard, sex) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ))}
          </li>
        )
      })}
    </ul>
  )
}
