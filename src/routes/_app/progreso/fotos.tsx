import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Lock, Trash2 } from 'lucide-react'
import { BackLink } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deletePhoto, fetchPhotos, uploadPhoto, type ProgressPhoto } from '@/lib/progress/api'
import { formatDayMonth, localDateKey } from '@/lib/progress/dates'
import { compressPhoto } from '@/lib/progress/image'
import { cn } from '@/lib/utils'
import type { PhotoPose } from '@/types/database'
import { notifyError, notifySaved } from '@/lib/notify'

export const Route = createFileRoute('/_app/progreso/fotos')({
  ssr: false,
  component: PhotosPage,
})

const POSES: { pose: PhotoPose; label: string }[] = [
  { pose: 'front', label: 'Frente' },
  { pose: 'side', label: 'Perfil' },
  { pose: 'back', label: 'Espalda' },
]

function PhotosPage() {
  const { auth } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const key = ['photos', auth.userId]
  const photos = useQuery({
    queryKey: key,
    queryFn: () => fetchPhotos(auth.userId),
    // Las URLs firmadas caducan en 1 h.
    staleTime: 30 * 60_000,
  })
  const [pose, setPose] = useState<PhotoPose>('front')
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const ofPose = (photos.data ?? []).filter((p) => p.pose === pose)

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink />
      <h1 className="text-2xl font-bold">Fotos de progreso</h1>
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Lock className="size-4" /> Privadas: solo las ves tú. Nunca se comparten.
      </p>

      <UploadCard userId={auth.userId} onUploaded={refresh} />

      <div className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1" role="tablist">
        {POSES.map((p) => (
          <button
            key={p.pose}
            type="button"
            role="tab"
            aria-selected={pose === p.pose}
            onClick={() => setPose(p.pose)}
            className={cn(
              'h-10 rounded-lg text-sm font-semibold',
              pose === p.pose ? 'bg-background shadow' : 'text-muted-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {photos.isPending && <p className="text-muted-foreground">Cargando…</p>}
      {photos.isError && <p className="text-destructive text-sm">{photos.error.message}</p>}
      {photos.data && ofPose.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
          Aún no hay fotos de {POSES.find((p) => p.pose === pose)?.label.toLowerCase()}.
        </p>
      )}

      {ofPose.length >= 2 && <Compare key={pose} photos={ofPose} />}

      {ofPose.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {ofPose.map((p) => (
            <li key={p.id} className="relative">
              <Photo photo={p} className="aspect-[3/4]" />
              <div className="mt-0.5 flex items-center justify-between text-xs">
                <span>{formatDayMonth(p.date)}</span>
                <button
                  type="button"
                  aria-label={`Borrar la foto del ${formatDayMonth(p.date)}`}
                  className="text-muted-foreground p-1"
                  onClick={async () => {
                    if (!confirm('¿Borrar esta foto?')) return
                    try {
                      await deletePhoto(p)
                      notifySaved('Foto borrada')
                    } catch (error) {
                      notifyError(error, 'borrar la foto')
                    }
                    await refresh()
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Photo({ photo, className }: { photo: ProgressPhoto; className?: string }) {
  return photo.url ? (
    <img
      src={photo.url}
      alt={`Foto del ${formatDayMonth(photo.date)}`}
      loading="lazy"
      className={cn('bg-muted w-full rounded-lg object-cover', className)}
    />
  ) : (
    <div className={cn('bg-muted w-full rounded-lg', className)} />
  )
}

// Antes / después: por defecto la foto más antigua y la más reciente de la postura.
function Compare({ photos }: { photos: ProgressPhoto[] }) {
  const sorted = [...photos].sort((a, b) => a.date.localeCompare(b.date))
  const [beforeId, setBeforeId] = useState(sorted[0]!.id)
  const [afterId, setAfterId] = useState(sorted.at(-1)!.id)
  const before = sorted.find((p) => p.id === beforeId) ?? sorted[0]!
  const after = sorted.find((p) => p.id === afterId) ?? sorted.at(-1)!

  const picker = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <select
        className="bg-background h-10 rounded-md border px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {sorted.map((p) => (
          <option key={p.id} value={p.id}>
            {formatDayMonth(p.date)} {p.date.slice(0, 4)}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antes y después</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {picker('Antes', before.id, setBeforeId)}
          {picker('Después', after.id, setAfterId)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Photo photo={before} className="aspect-[3/4]" />
          <Photo photo={after} className="aspect-[3/4]" />
        </div>
      </CardContent>
    </Card>
  )
}

function UploadCard({ userId, onUploaded }: { userId: string; onUploaded: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [date, setDate] = useState(localDateKey(new Date()))
  const [pose, setPose] = useState<PhotoPose>('front')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setStatus({ ok: true, text: 'Comprimiendo…' })
    try {
      const blob = await compressPhoto(file)
      setStatus({ ok: true, text: `Subiendo (${Math.round(blob.size / 1024)} KB)…` })
      await uploadPhoto(userId, blob, date, pose)
      setStatus({ ok: true, text: 'Foto guardada' })
      notifySaved('Foto guardada')
      await onUploaded()
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      notifyError(error, 'subir la foto')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva foto</CardTitle>
        <CardDescription>
          Misma luz y postura cada vez. Se reduce a 1600 px antes de subirla.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="photo_date">Fecha</Label>
            <Input
              id="photo_date"
              type="date"
              value={date}
              max={localDateKey(new Date())}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Postura
            <select
              className="bg-background h-10 rounded-md border px-2"
              value={pose}
              onChange={(e) => setPose(e.target.value as PhotoPose)}
            >
              {POSES.map((p) => (
                <option key={p.pose} value={p.pose}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <Button size="lg" disabled={busy} onClick={() => input.current?.click()}>
          <Camera /> Hacer o elegir foto
        </Button>
        {status && (
          <p className={status.ok ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'}>
            {status.text}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
