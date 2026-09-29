import { useState } from 'react'
import { AlertTriangle, ExternalLink, ImageOff, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { exerciseImages, techniqueVideoUrl } from '@/lib/workout/exercise-images'
import type { Exercise } from '@/lib/workout/types'

// Técnica de un ejercicio: imágenes (solo se montan al abrir el detalle), pasos, errores
// típicos, búsqueda de vídeo y fuente de las imágenes. Se usa en la biblioteca y en la sesión.
export function ExerciseTechnique({ exercise }: { exercise: Exercise }) {
  const images = exercise.ownerId ? null : exerciseImages(exercise.id)
  const steps = exercise.techniqueSteps
  const mistakes = exercise.techniqueMistakes

  return (
    <div className="flex flex-col gap-3 text-sm" aria-label="Técnica">
      {images && (
        <figure className="flex flex-col gap-1.5">
          <div className={images.images.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid'}>
            {images.images.map((image) => (
              <TechniqueImage
                key={image.src}
                src={image.src}
                label={image.label}
                alt={`${exercise.name}: ${image.label.toLowerCase()}`}
              />
            ))}
          </div>
          {images.note && <p className="text-muted-foreground text-xs">{images.note}</p>}
        </figure>
      )}

      {steps.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Pasos clave</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {mistakes.length > 0 && (
        <section>
          <h3 className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" /> Errores típicos
          </h3>
          <ul className="list-disc space-y-1 pl-5">
            {mistakes.map((mistake) => (
              <li key={mistake}>{mistake}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Notas libres: las de los ejercicios propios o, si no hay pasos, el resumen. */}
      {exercise.techniqueNotes && (exercise.ownerId || steps.length === 0) && (
        <p className="bg-muted/50 rounded-lg p-3">{exercise.techniqueNotes}</p>
      )}

      <Button asChild variant="outline" size="lg">
        <a href={techniqueVideoUrl(exercise.name)} target="_blank" rel="noopener noreferrer">
          <PlayCircle /> Ver técnica en vídeo
          <ExternalLink className="size-4 opacity-60" />
        </a>
      </Button>

      {images && (
        <p className="text-muted-foreground text-xs">
          Imágenes:{' '}
          <a
            href={images.sourceExerciseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            «{images.sourceExerciseName}»
          </a>{' '}
          de {images.source.name} ({images.source.author}), {images.source.license}.
        </p>
      )}
    </div>
  )
}

function TechniqueImage({ src, label, alt }: { src: string; label: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      {failed ? (
        <div className="bg-muted text-muted-foreground flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-lg p-2 text-center text-xs">
          <ImageOff className="size-5" />
          Imagen no disponible sin conexión
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="bg-muted aspect-[3/2] w-full rounded-lg object-contain"
        />
      )}
      <span className="text-muted-foreground text-center text-xs">{label}</span>
    </div>
  )
}

// Hoja inferior con la técnica, para abrirla durante la sesión sin salir de ella
// (el temporizador sigue: su estado vive en la sesión, no en la hoja).
export function ExerciseTechniqueSheet({
  exercise,
  onClose,
}: {
  exercise: Exercise | null | undefined
  onClose: () => void
}) {
  return (
    <Sheet open={!!exercise} onClose={onClose} title={exercise?.name ?? ''}>
      {exercise && (
        <div className="pb-2">
          <ExerciseTechnique exercise={exercise} />
        </div>
      )}
    </Sheet>
  )
}
