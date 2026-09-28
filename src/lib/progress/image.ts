// Compresión de fotos en el navegador antes de subirlas (Supabase Free: 1 GB de Storage).
export const PHOTO_MAX_SIDE = 1600
export const PHOTO_QUALITY = 0.8

// Tamaño que cabe en un cuadrado de maxSide manteniendo la proporción (nunca amplía).
export function fitWithin(width: number, height: number, maxSide = PHOTO_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  // createImageBitmap respeta la orientación EXIF de las fotos del móvil.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, w: bitmap.width, h: bitmap.height }
    } catch {
      // formato no soportado por createImageBitmap (p. ej. HEIC en algunos navegadores)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, w: img.naturalWidth, h: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Redimensiona a ~1600 px y recodifica en JPEG ~80 %.
export async function compressPhoto(file: Blob): Promise<Blob> {
  const { source, w, h } = await decode(file)
  const size = fitWithin(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.drawImage(source, 0, 0, size.width, size.height)
  if ('close' in source && typeof source.close === 'function') source.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY),
  )
  if (!blob) throw new Error('No se pudo comprimir la imagen')
  return blob
}
