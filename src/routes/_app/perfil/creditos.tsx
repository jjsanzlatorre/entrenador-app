import { createFileRoute } from '@tanstack/react-router'
import { BackLink } from '@/components/progress/common'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { exerciseImageMap, imageSources } from '@/lib/workout/exercise-images'

export const Route = createFileRoute('/_app/perfil/creditos')({
  component: CreditsPage,
})

function CreditsPage() {
  const count = Object.keys(exerciseImageMap.exercises).length
  return (
    <div className="flex flex-col gap-4 p-4">
      <BackLink to="/perfil" label="Perfil" />
      <h1 className="text-2xl font-bold">Créditos</h1>

      {imageSources().map((source) => (
        <Card key={source.url}>
          <CardHeader>
            <CardTitle>Imágenes de ejercicios: {source.name}</CardTitle>
            <CardDescription>
              {count} ejercicios de la biblioteca usan sus imágenes de posición inicial y final.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              Autoría: {source.author}.{' '}
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">
                {source.url.replace('https://', '')}
              </a>
            </p>
            <p>
              Licencia:{' '}
              <a
                href={source.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {source.license}
              </a>
              . No exige atribución; la indicamos igualmente. Las imágenes se han convertido a WebP
              y reducido de tamaño.
            </p>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Técnica y vídeos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>Los pasos clave y los errores típicos son textos propios de la app.</p>
          <p>
            «Ver técnica en vídeo» abre una búsqueda en YouTube; los vídeos son de sus autores y la
            app no los aloja ni los revisa.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
