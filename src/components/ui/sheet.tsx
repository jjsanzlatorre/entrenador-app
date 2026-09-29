import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Hoja inferior a pantalla casi completa (cómoda con una mano en el móvil).
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  // Portal al <body>: así una hoja puede abrir otra encima sin quedar atrapada en su transform.
  return createPortal(
    <div
      className="pt-safe px-safe fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="animate-in fade-in absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        className={cn(
          'bg-background animate-in slide-in-from-bottom max-h-sheet pb-safe relative mx-auto flex w-full max-w-lg flex-col rounded-t-2xl shadow-xl duration-200',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="hover:bg-accent -mr-2 rounded-full p-2.5"
          >
            <X className="size-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        {footer && <div className="border-t px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
