// Descarga las imágenes de src/data/exercise-images.json y las guarda en public/exercises/
// como WebP (máx. 480 px de ancho, ≤ 50 KB). Se ejecuta a mano cuando cambia el mapeo:
//   npm i --no-save sharp && node scripts/exercise-images.ts
// sharp no es dependencia del proyecto: solo hace falta para regenerar las imágenes.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExerciseImageMap } from '../src/lib/workout/exercise-images.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/exercises')
// Mismo límite y nombre de archivo que src/lib/workout/exercise-images.ts (lo comprueba un test).
const MAX_BYTES = 50 * 1024
const fileName = (exerciseId: string, role: string) => `${exerciseId}-${role}.webp`

type Sharp = (input: Buffer) => {
  resize: (o: { width: number; withoutEnlargement: boolean }) => {
    webp: (o: { quality: number; effort: number }) => { toBuffer: () => Promise<Buffer> }
  }
}

async function main() {
  const sharp = ((await import('sharp' as string)) as { default: Sharp }).default
  mkdirSync(outDir, { recursive: true })
  const { sources, exercises } = JSON.parse(
    readFileSync(join(root, 'src/data/exercise-images.json'), 'utf8'),
  ) as ExerciseImageMap
  for (const [exerciseId, entry] of Object.entries(exercises)) {
    const source = sources[entry.source]
    if (!source) throw new Error(`Fuente desconocida: ${entry.source}`)
    for (const image of entry.images) {
      const url = `${source.imageBaseUrl}${entry.sourceId}/${image.from}.jpg`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url}: ${response.status}`)
      const input = Buffer.from(await response.arrayBuffer())
      let output: Buffer | null = null
      const attempts: [number, number][] = [
        [480, 72],
        [480, 60],
        [420, 55],
        [360, 50],
      ]
      for (const [width, quality] of attempts) {
        output = await sharp(input)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality, effort: 6 })
          .toBuffer()
        if (output.length <= MAX_BYTES) break
      }
      const file = join(outDir, fileName(exerciseId, image.role))
      writeFileSync(file, output!)
      console.log(`${file} (${statSync(file).size} bytes)`)
    }
  }
}

await main()
