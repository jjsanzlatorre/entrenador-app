import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, Download, MoreVertical, Share, SquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isIos, isStandalone } from '@/lib/notifications/push'
import { canPromptInstall, onInstallPromptChange, promptInstall } from '@/lib/pwa'

type Next = '/' | '/plan/elegir'

// Tras el onboarding de quien se acaba de unir: cómo instalar la PWA según el dispositivo.
export const Route = createFileRoute('/_app/instalar')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next?: Next } => ({
    next: search.next === '/plan/elegir' ? '/plan/elegir' : search.next === '/' ? '/' : undefined,
  }),
  component: InstallPage,
})

function InstallPage() {
  const { next = '/' } = Route.useSearch()
  const [installed, setInstalled] = useState(() => isStandalone())
  const [canPrompt, setCanPrompt] = useState(() => canPromptInstall())
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), [])
  const ios = isIos()
  const android = /android/i.test(navigator.userAgent)

  return (
    <div className="min-h-screen-safe pb-safe-6 flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Instala la app</h1>
      <p className="text-muted-foreground">
        Con la app en la pantalla de inicio se abre a pantalla completa, más rápido y funciona sin
        conexión en el gimnasio.
      </p>

      {installed ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="text-success size-5" /> Ya la tienes instalada
            </CardTitle>
          </CardHeader>
        </Card>
      ) : ios ? (
        <Card>
          <CardHeader>
            <CardTitle>iPhone o iPad</CardTitle>
            <CardDescription>
              Desde Safari (en otros navegadores no aparece la opción).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1}>
                Pulsa <Share className="inline size-4" aria-label="Compartir" />{' '}
                <strong>Compartir</strong> en la barra de Safari.
              </Step>
              <Step n={2}>
                Elige <SquarePlus className="inline size-4" aria-hidden />{' '}
                <strong>Añadir a pantalla de inicio</strong> (desliza hacia abajo si no la ves).
              </Step>
              <Step n={3}>
                Pulsa <strong>Añadir</strong> y abre Entrenador desde el icono. Tendrás que entrar
                otra vez con tu email y contraseña.
              </Step>
            </ol>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{android ? 'Android' : 'En este dispositivo'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {canPrompt && (
              <Button
                size="lg"
                onClick={() =>
                  void promptInstall().then((ok) => {
                    if (ok) setInstalled(true)
                  })
                }
              >
                <Download /> Instalar app
              </Button>
            )}
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1}>
                {canPrompt ? 'O abre' : 'Abre'} el menú{' '}
                <MoreVertical className="inline size-4" aria-label="menú" /> del navegador (Chrome).
              </Step>
              <Step n={2}>
                Pulsa <strong>Instalar app</strong> (o «Añadir a pantalla de inicio»).
              </Step>
              <Step n={3}>Confirma y abre Entrenador desde el icono.</Step>
            </ol>
          </CardContent>
        </Card>
      )}

      <Button size="lg" variant={installed ? 'default' : 'outline'} asChild className="mt-auto">
        <Link to={next} replace>
          {installed ? 'Continuar' : 'Ahora no, continuar'}
        </Link>
      </Button>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}
