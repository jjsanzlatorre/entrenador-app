import type { KeyboardEvent } from 'react'
import { BODY_SILHOUETTE, BODY_VIEWBOX, MUSCLE_PATHS, type BodyView } from '@/lib/progress/body-map'
import {
  formatSets,
  VOLUME_LEVEL_LABELS,
  volumeLevel,
  type VolumeLevel,
} from '@/lib/progress/muscle-volume'
import { muscleName } from '@/lib/workout/labels'
import { cn } from '@/lib/utils'

const LEVEL_FILL: Record<VolumeLevel, string> = {
  0: 'var(--mv-0)',
  1: 'var(--mv-1)',
  2: 'var(--mv-2)',
  3: 'var(--mv-3)',
  4: 'var(--mv-4)',
}

const VIEW_LABEL: Record<BodyView, string> = { front: 'Frente', back: 'Espalda' }

// Mapa corporal (frente y espalda). Color por series de la semana; al tocar un músculo se abre
// su detalle con el número exacto (el color nunca es la única pista).
export function BodyMap({
  sets,
  selected,
  onSelect,
  neglected,
  size = 'full',
  className,
}: {
  sets: (muscleId: string) => number
  selected?: string | null
  onSelect?: (muscleId: string) => void
  neglected?: ReadonlySet<string>
  size?: 'full' | 'mini'
  className?: string
}) {
  const interactive = Boolean(onSelect)
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2',
        size === 'mini' ? 'mx-auto max-w-[13rem]' : 'mx-auto max-w-sm',
        className,
      )}
    >
      {(['front', 'back'] as const).map((view) => (
        <figure key={view} className="flex flex-col items-center gap-1">
          <svg
            viewBox={`0 0 ${BODY_VIEWBOX.width} ${BODY_VIEWBOX.height}`}
            className="h-auto w-full"
            role={interactive ? 'group' : 'img'}
            aria-label={`${VIEW_LABEL[view]}: ${describe(view, sets)}`}
          >
            <path d={BODY_SILHOUETTE} fill="var(--mv-silhouette)" />
            {Object.entries(MUSCLE_PATHS[view]).map(([muscleId, d]) => {
              const value = sets(muscleId)
              const label = `${muscleName(muscleId)}: ${formatSets(value)} series`
              return (
                <path
                  key={muscleId}
                  d={d}
                  data-muscle={muscleId}
                  data-level={volumeLevel(value)}
                  fill={LEVEL_FILL[volumeLevel(value)]}
                  stroke="var(--mv-stroke)"
                  strokeWidth={size === 'mini' ? 1.5 : 1.2}
                  className={cn(interactive && 'cursor-pointer outline-none')}
                  {...(interactive
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': label,
                        'aria-pressed': selected === muscleId,
                        onClick: () => onSelect?.(muscleId),
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelect?.(muscleId)
                          }
                        },
                      }
                    : {})}
                >
                  <title>{label}</title>
                </path>
              )
            })}
            {/* Contornos por encima: descuidados (discontinuo) y seleccionado. */}
            {Object.entries(MUSCLE_PATHS[view]).map(([muscleId, d]) =>
              neglected?.has(muscleId) ? (
                <path
                  key={`n-${muscleId}`}
                  d={d}
                  fill="none"
                  stroke="var(--mv-neglected)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              ) : null,
            )}
            {selected && MUSCLE_PATHS[view][selected] ? (
              <path
                d={MUSCLE_PATHS[view][selected]}
                fill="none"
                stroke="var(--foreground)"
                strokeWidth={3}
                pointerEvents="none"
              />
            ) : null}
          </svg>
          <figcaption className="text-muted-foreground text-xs">{VIEW_LABEL[view]}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function describe(view: BodyView, sets: (muscleId: string) => number) {
  return Object.keys(MUSCLE_PATHS[view])
    .map((id) => `${muscleName(id)} ${formatSets(sets(id))}`)
    .join(', ')
}

// Leyenda de la escala (series por semana).
export function BodyMapLegend({
  showNeglected = false,
  unit = 'series',
}: {
  showNeglected?: boolean
  unit?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs">
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <li key={level} className="flex items-center gap-1">
            <span
              className="inline-block size-3.5 rounded-sm border"
              style={{ background: LEVEL_FILL[level] }}
              aria-hidden
            />
            <span className="tabular-nums">{VOLUME_LEVEL_LABELS[level]}</span>
          </li>
        ))}
        <li className="text-muted-foreground">{unit}</li>
      </ul>
      {showNeglected && (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <svg viewBox="0 0 16 10" className="h-2.5 w-4" aria-hidden>
            <rect
              x="1"
              y="1"
              width="14"
              height="8"
              rx="2"
              fill="none"
              stroke="var(--mv-neglected)"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </svg>
          Contorno discontinuo: descuidado (0 series en 2 semanas o más)
        </p>
      )}
    </div>
  )
}
