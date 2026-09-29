import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Avisos flotantes (arriba, para no tapar la navegación inferior). Colores del tema.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="top-center"
      richColors
      closeButton
      // Bajo la barra de estado / Dynamic Island y lejos del notch en horizontal.
      offset={TOAST_OFFSET}
      mobileOffset={TOAST_OFFSET}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

const TOAST_OFFSET = {
  top: 'calc(var(--safe-top) + 16px)',
  bottom: 'calc(var(--safe-bottom) + 16px)',
  left: 'calc(var(--safe-left) + 16px)',
  right: 'calc(var(--safe-right) + 16px)',
}
