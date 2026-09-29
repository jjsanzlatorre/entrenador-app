import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Braces, Camera, FileSpreadsheet } from 'lucide-react'
import { BackLink } from '@/components/progress/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { notifyError, notifySaved, notifyWarning } from '@/lib/notify'
import {
  collectExport,
  csvZip,
  exerciseNames,
  exportFileName,
  photosZip,
} from '@/lib/export/collect'
import { downloadBlob } from '@/lib/export/files'

export const Route = createFileRoute('/_app/perfil/exportar')({
  component: ExportPage,
})

type Kind = 'csv' | 'json' | 'photos'

function ExportPage() {
  const { auth } = Route.useRouteContext()
  const [busy, setBusy] = useState<Kind | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  async function run(kind: Kind) {
    setBusy(kind)
    setProgress('Preparando…')
    try {
      const data = await collectExport(auth.userId, (done, total) =>
        setProgress(`Leyendo tus datos… ${Math.round((done / total) * 100)} %`),
      )
      if (kind === 'json') {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        downloadBlob(blob, exportFileName('copia', 'json'))
        notifySaved('Copia completa descargada (JSON)')
      } else if (kind === 'csv') {
        const names = await exerciseNames(auth.userId)
        downloadBlob(
          new Blob([csvZip(data, names) as BlobPart], { type: 'application/zip' }),
          exportFileName('csv', 'zip'),
        )
        notifySaved('CSV descargados (ZIP)')
      } else {
        const zip = await photosZip(data, (done, total) =>
          setProgress(`Descargando fotos… ${done} de ${total}`),
        )
        if (!zip) notifyWarning('No tienes fotos de progreso.')
        else {
          downloadBlob(
            new Blob([zip as BlobPart], { type: 'application/zip' }),
            exportFileName('fotos', 'zip'),
          )
          notifySaved('Fotos descargadas (ZIP)')
        }
      }
    } catch (error) {
      notifyError(error, 'exportar')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="text-2xl font-bold">Exportar mis datos</h1>
      <p className="text-muted-foreground text-sm">
        Descarga tus datos cuando quieras. Sirve también como copia de seguridad: guarda el JSON en
        un sitio seguro de vez en cuando (el plan gratuito de Supabase no guarda copias
        descargables). Solo se exportan tus datos, nunca los de las personas vinculadas.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" /> Hojas de cálculo (CSV)
          </CardTitle>
          <CardDescription>
            Un ZIP con sesiones, series (con el nombre del ejercicio), medidas, récords y
            compromisos. Se abre con Excel, Numbers o Google Sheets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void run('csv')}
          >
            Descargar CSV (ZIP)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Braces className="size-5" /> Copia completa (JSON)
          </CardTitle>
          <CardDescription>
            Todo lo tuyo: perfil, compromisos, sesiones con bloques y series, ejercicios propios,
            medidas, récords, check-ins, planes, conversaciones con la IA, vínculos, hitos y
            preferencias. Las fotos van aparte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void run('json')}
          >
            Descargar JSON
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-5" /> Fotos de progreso (opcional)
          </CardTitle>
          <CardDescription>
            Un ZIP aparte con tus fotos. Puede ocupar bastante: mejor con wifi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void run('photos')}
          >
            Descargar fotos (ZIP)
          </Button>
        </CardContent>
      </Card>

      {progress && (
        <p role="status" aria-live="polite" className="text-muted-foreground text-center text-sm">
          {progress}
        </p>
      )}
    </div>
  )
}
