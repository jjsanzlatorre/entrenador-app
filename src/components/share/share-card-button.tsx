// Botón «Compartir» de una tarjeta (fase 7B): genera la imagen, la enseña y la comparte con la
// hoja nativa del móvil (o la descarga si el navegador no puede compartir archivos).
// Se genera al abrir la vista previa para que «Compartir» se llame directamente desde el toque
// (Safari no deja compartir si antes se ha esperado a otra cosa).
import { useEffect, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { notifyError, notifySaved } from '@/lib/notify'
import { downloadBlob } from '@/lib/export/files'
import { renderShareCard, shareFileName, shareOrDownload, type ShareCard } from '@/lib/share/card'
import { cn } from '@/lib/utils'

export function ShareCardButton({
  card,
  label = 'Compartir',
  variant = 'outline',
  size = 'sm',
  className,
}: {
  card: ShareCard
  label?: string
  variant?: 'outline' | 'ghost' | 'default' | 'secondary'
  size?: 'sm' | 'lg' | 'icon' | 'default'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn(className)}
        aria-label={size === 'icon' ? `${label}: ${card.headline}` : undefined}
        onClick={() => setOpen(true)}
      >
        <Share2 />
        {size !== 'icon' && label}
      </Button>
      {open && <SharePreview card={card} onClose={() => setOpen(false)} />}
    </>
  )
}

function SharePreview({ card: initial, onClose }: { card: ShareCard; onClose: () => void }) {
  // La tarjeta se fija al abrir (el padre puede recrear el objeto en cada render).
  const [card] = useState(initial)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    renderShareCard(card)
      .then((b) => {
        if (cancelled) return
        revoked = URL.createObjectURL(b)
        setBlob(b)
        setUrl(revoked)
      })
      .catch((e: unknown) => {
        console.error('[share]', e)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [card])

  async function share() {
    if (!blob) return
    try {
      const result = await shareOrDownload(blob, card)
      if (result === 'downloaded') notifySaved('Imagen descargada')
      if (result !== 'cancelled') onClose()
    } catch (e) {
      notifyError(e, 'compartir')
    }
  }

  return (
    <Sheet open onClose={onClose} title="Compartir">
      <div className="flex flex-col items-center gap-3 pb-2">
        {url ? (
          <img
            src={url}
            alt={`${card.eyebrow}: ${card.value}. ${card.headline}`}
            className="max-h-[55dvh] w-auto rounded-2xl shadow-lg"
          />
        ) : (
          <div className="bg-muted flex aspect-[9/16] h-[55dvh] items-center justify-center rounded-2xl text-sm">
            {error ? 'No se ha podido generar la imagen.' : 'Generando…'}
          </div>
        )}
        <p className="text-muted-foreground text-center text-xs">
          Solo lleva lo que ves: sin medidas, fotos ni notas.
        </p>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button size="lg" disabled={!blob} onClick={() => void share()}>
            <Share2 /> Compartir
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={!blob}
            onClick={() => {
              if (!blob) return
              downloadBlob(blob, shareFileName(card))
              notifySaved('Imagen descargada')
            }}
          >
            <Download /> Descargar
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
