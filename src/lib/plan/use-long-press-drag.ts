import { useEffect, useRef, useState } from 'react'
import { vibrate } from '@/lib/workout/alerts'

// Mantener pulsado y arrastrar una sesión a otro día del calendario semanal.
// - Táctil: eventos touch con un `touchmove` no pasivo en el documento, para poder cancelar el
//   scroll solo cuando el arrastre ya ha empezado (si el dedo se mueve antes, es scroll normal).
// - Ratón: eventos pointer (mismo gesto: mantener y mover).
// El destino es el elemento con `data-drop-date` bajo el dedo. El toque que suelta no abre la
// sesión (se anula el click siguiente).

export const LONG_PRESS_MS = 400
const MOVE_TOLERANCE_PX = 10
const EDGE_PX = 90

export type DragState = {
  id: string
  label: string
  x: number
  y: number
  overDate: string | null
}

// `target`: atributo data-* del destino ('drop-date' en el plan; 'drop-block' en la sesión para
// unir ejercicios en superserie). `overDate` es el valor de ese atributo bajo el dedo.
function dropTargetAt(x: number, y: number, target: string): string | null {
  const el = document.elementFromPoint(x, y)
  return el?.closest<HTMLElement>(`[data-${target}]`)?.getAttribute(`data-${target}`) ?? null
}

export function useLongPressDrag(onDrop: (id: string, date: string) => void, target = 'drop-date') {
  const dropDateAt = (x: number, y: number) => dropTargetAt(x, y, target)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  const onDropRef = useRef(onDrop)
  useEffect(() => {
    onDropRef.current = onDrop
  }, [onDrop])

  useEffect(() => () => cleanup.current?.(), [])

  // Desplaza la página si el dedo se acerca al borde (la semana no cabe entera en pantalla).
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const id = window.setInterval(() => {
      const d = dragRef.current
      if (!d) return
      const h = window.innerHeight
      const delta = d.y < EDGE_PX ? -14 : d.y > h - EDGE_PX ? 14 : 0
      if (!delta) return
      window.scrollBy(0, delta)
      const next = { ...d, overDate: dropTargetAt(d.x, d.y, target) }
      dragRef.current = next
      setDrag(next)
    }, 30)
    return () => window.clearInterval(id)
  }, [dragging, target])

  function update(x: number, y: number) {
    const d = dragRef.current
    if (!d) return
    const next = { ...d, x, y, overDate: dropDateAt(x, y) }
    dragRef.current = next
    setDrag(next)
  }

  function finish(commit: boolean) {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    cleanup.current?.()
    cleanup.current = null
    if (commit && d?.overDate) onDropRef.current(d.id, d.overDate)
  }

  function begin(id: string, label: string, x: number, y: number) {
    suppressClick.current = true
    vibrate(30)
    const d = { id, label, x, y, overDate: dropDateAt(x, y) }
    dragRef.current = d
    setDrag(d)
  }

  function press(id: string, label: string, startX: number, startY: number, touch: boolean) {
    cleanup.current?.()
    suppressClick.current = false
    let active = false
    let x = startX
    let y = startY
    const timer = window.setTimeout(() => {
      active = true
      begin(id, label, x, y)
    }, LONG_PRESS_MS)

    const move = (cx: number, cy: number, e: Event) => {
      x = cx
      y = cy
      if (!active) {
        if (Math.hypot(cx - startX, cy - startY) > MOVE_TOLERANCE_PX) finish(false)
        return
      }
      if (e.cancelable) e.preventDefault()
      update(cx, cy)
    }
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) move(t.clientX, t.clientY, e)
    }
    const onPointerMove = (e: PointerEvent) => move(e.clientX, e.clientY, e)
    const onEnd = () => finish(active)
    const onCancel = () => finish(false)

    if (touch) {
      document.addEventListener('touchmove', onTouchMove, { passive: false })
      document.addEventListener('touchend', onEnd)
      document.addEventListener('touchcancel', onCancel)
    } else {
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onEnd)
      document.addEventListener('pointercancel', onCancel)
    }
    cleanup.current = () => {
      window.clearTimeout(timer)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onEnd)
      document.removeEventListener('pointercancel', onCancel)
    }
  }

  // Props para el elemento arrastrable.
  function bind(id: string, label: string) {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0]
        if (t && e.touches.length === 1) press(id, label, t.clientX, t.clientY, true)
      },
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button === 0)
          press(id, label, e.clientX, e.clientY, false)
      },
      // Sin menú contextual ni selección de texto al mantener pulsado.
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClick.current) {
          suppressClick.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      },
    }
  }

  return { drag, bind }
}
