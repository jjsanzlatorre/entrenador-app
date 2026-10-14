import { useRef, useState } from 'react'

// Deslizar una fila a la derecha o a la izquierda (usabilidad 3/3: completar o borrar una serie).
// Con `touch-action: pan-y` en la fila, el desplazamiento vertical sigue siendo del navegador y
// los movimientos horizontales llegan como eventos pointer. Solo cuenta si el gesto es claramente
// horizontal; al soltar pasado el umbral se llama a la acción y se anula el click siguiente.

export const SWIPE_THRESHOLD_PX = 80
const START_PX = 12

export function swipeDirection(dx: number, threshold = SWIPE_THRESHOLD_PX) {
  if (dx >= threshold) return 'right' as const
  if (dx <= -threshold) return 'left' as const
  return null
}

export function useSwipe({
  onRight,
  onLeft,
  disabled,
}: {
  onRight?: () => void
  onLeft?: () => void
  disabled?: boolean
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(
    null,
  )
  const suppressClick = useRef(false)

  function reset() {
    start.current = null
    setDx(0)
  }

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
      suppressClick.current = false
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      const mx = e.clientX - s.x
      const my = e.clientY - s.y
      if (s.horizontal === null) {
        if (Math.abs(mx) < START_PX && Math.abs(my) < START_PX) return
        s.horizontal = Math.abs(mx) > Math.abs(my) * 1.5
        if (!s.horizontal) {
          start.current = null
          return
        }
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // sin captura: el gesto sigue funcionando mientras el dedo esté sobre la fila
        }
      }
      if (!s.horizontal) return
      // Sin acción en ese sentido, el desplazamiento se frena.
      const allowed = (mx > 0 && onRight) || (mx < 0 && onLeft) ? mx : mx / 4
      setDx(Math.max(-160, Math.min(160, allowed)))
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current
      if (!s || s.id !== e.pointerId) return reset()
      const direction = s.horizontal ? swipeDirection(e.clientX - s.x) : null
      if (s.horizontal) suppressClick.current = true
      reset()
      if (direction === 'right' && onRight) onRight()
      if (direction === 'left' && onLeft) onLeft()
    },
    onPointerCancel: reset,
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false
        e.preventDefault()
        e.stopPropagation()
      }
    },
  }

  return { dx, handlers, swiping: dx !== 0 }
}
